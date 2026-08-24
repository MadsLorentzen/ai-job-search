from __future__ import annotations

import json
import sqlite3

import pytest

from product.job_ingestion import normalize_job_source_record
from webapp.persistence.db import SCHEMA_PATH, connect, init_db
from webapp.persistence.search_workspaces import DEFAULT_SEARCH_WORKSPACE_ID


def _legacy_database(path):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.execute(
        "INSERT INTO user_profile_versions (id, content_id, payload_json, created_at) "
        "VALUES ('usrprof_old', 'usrprofcontent_old', ?, '2026-08-20T10:00:00+00:00')",
        (json.dumps({"target_roles": ["Planner"]}),),
    )
    conn.execute(
        "INSERT INTO current_user_profile (id, version_id, updated_at) "
        "VALUES ('current', 'usrprof_old', '2026-08-20T10:00:00+00:00')"
    )
    conn.execute(
        "INSERT INTO discovery_runs "
        "(id, user_profile_version_id, user_profile_content_id, request_json, "
        "source_status_json, status, created_at, completed_at) "
        "VALUES ('run_old', 'usrprof_old', 'usrprofcontent_old', '{}', '{}', "
        "'completed', '2026-08-20T11:00:00+00:00', '2026-08-20T11:01:00+00:00')"
    )
    conn.execute(
        "INSERT INTO discovery_candidates "
        "(id, company, title, location, lifecycle_status, canonical_occurrence_id, "
        "promoted_workspace_id, first_seen_at, last_seen_at, updated_at) "
        "VALUES ('disc_old', 'Example', 'Planner', 'London', 'saved', 'occ_old', NULL, "
        "'2026-08-20T11:00:00+00:00', '2026-08-20T11:00:00+00:00', "
        "'2026-08-20T11:00:00+00:00')"
    )
    source_record = {
        "schema_version": "job-source-record.v0",
        "source": "portal-a",
        "source_record_id": "job-old",
        "captured_at": "2026-08-20T11:00:00+00:00",
        "company": "Example",
        "title": "Planner",
    }
    conn.execute(
        "INSERT INTO discovery_occurrences "
        "(id, candidate_id, run_id, source, source_record_id, source_url, "
        "source_record_json, captured_at, created_at) "
        "VALUES ('occ_old', 'disc_old', 'run_old', 'portal-a', 'job-old', NULL, ?, "
        "'2026-08-20T11:00:00+00:00', '2026-08-20T11:00:00+00:00')",
        (json.dumps(source_record),),
    )
    conn.execute(
        "INSERT INTO discovery_candidate_keys (identity_key, candidate_id, key_type) "
        "VALUES ('source:portal-a:job-old', 'disc_old', 'source_record')"
    )
    conn.commit()
    conn.close()


def test_new_database_has_one_deterministic_default_search_workspace(tmp_path):
    path = tmp_path / "new.sqlite3"

    init_db(path)
    init_db(path)

    conn = connect(path)
    workspace = conn.execute(
        "SELECT * FROM search_workspaces WHERE id = ?", (DEFAULT_SEARCH_WORKSPACE_ID,)
    ).fetchone()
    assert dict(workspace)["name"] == "Default search"
    assert conn.execute("SELECT COUNT(*) FROM search_workspaces").fetchone()[0] == 1
    assert {
        row["id"] for row in conn.execute("SELECT id FROM schema_migrations")
    } == {"001_search_workspaces", "002_evidence_profile_manager"}
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_existing_001_database_upgrades_to_profile_manager_002_idempotently(tmp_path):
    path = tmp_path / "existing-001.sqlite3"
    init_db(path)
    conn = connect(path)
    conn.execute("DROP TABLE profile_source_entries")
    conn.execute("DROP TABLE profile_source_settings")
    conn.execute(
        "DELETE FROM schema_migrations WHERE id = '002_evidence_profile_manager'"
    )
    conn.commit()
    conn.close()

    init_db(path)
    init_db(path)

    upgraded = connect(path)
    assert {
        row["name"] for row in upgraded.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'profile_source_%'"
        )
    } == {"profile_source_entries", "profile_source_settings"}
    assert {
        row["id"] for row in upgraded.execute("SELECT id FROM schema_migrations")
    } == {"001_search_workspaces", "002_evidence_profile_manager"}
    assert upgraded.execute("PRAGMA foreign_key_check").fetchall() == []


def test_failed_profile_manager_002_migration_rolls_back_without_harming_001(
    tmp_path, monkeypatch
):
    path = tmp_path / "failed-002.sqlite3"
    init_db(path)
    conn = connect(path)
    conn.execute("DROP TABLE profile_source_entries")
    conn.execute("DROP TABLE profile_source_settings")
    conn.execute(
        "DELETE FROM schema_migrations WHERE id = '002_evidence_profile_manager'"
    )
    conn.commit()
    conn.close()

    def fail_after_partial_ddl(conn):
        conn.execute("CREATE TABLE profile_source_settings (source_path TEXT PRIMARY KEY)")
        raise sqlite3.OperationalError("simulated 002 failure")

    monkeypatch.setattr(
        "webapp.persistence.migrations._migrate_evidence_profile_manager",
        fail_after_partial_ddl,
    )
    with pytest.raises(sqlite3.OperationalError, match="simulated 002 failure"):
        init_db(path)

    inspected = connect(path)
    assert inspected.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE id='001_search_workspaces'"
    ).fetchone()[0] == 1
    assert inspected.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE id='002_evidence_profile_manager'"
    ).fetchone()[0] == 0
    assert inspected.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
        "AND name='profile_source_settings'"
    ).fetchone()[0] == 0
    assert inspected.execute("PRAGMA foreign_key_check").fetchall() == []


def test_legacy_singleton_profile_and_discovery_are_attached_without_data_loss(tmp_path):
    path = tmp_path / "legacy.sqlite3"
    _legacy_database(path)

    init_db(path)

    conn = connect(path)
    pointer = conn.execute(
        "SELECT * FROM search_workspace_user_profiles WHERE search_workspace_id = ?",
        (DEFAULT_SEARCH_WORKSPACE_ID,),
    ).fetchone()
    assert pointer["current_version_id"] == "usrprof_old"
    assert conn.execute("SELECT COUNT(*) FROM user_profile_versions").fetchone()[0] == 1
    assert conn.execute(
        "SELECT search_workspace_id FROM discovery_runs WHERE id = 'run_old'"
    ).fetchone()[0] == DEFAULT_SEARCH_WORKSPACE_ID
    assert conn.execute(
        "SELECT search_workspace_id FROM discovery_candidates WHERE id = 'disc_old'"
    ).fetchone()[0] == DEFAULT_SEARCH_WORKSPACE_ID
    assert conn.execute(
        "SELECT search_workspace_id FROM discovery_occurrences WHERE id = 'occ_old'"
    ).fetchone()[0] == DEFAULT_SEARCH_WORKSPACE_ID
    assert conn.execute(
        "SELECT search_workspace_id FROM discovery_candidate_keys "
        "WHERE identity_key = 'source:portal-a:job-old'"
    ).fetchone()[0] == DEFAULT_SEARCH_WORKSPACE_ID
    assert conn.execute(
        "SELECT COUNT(*) FROM search_workspace_user_profile_history"
    ).fetchone()[0] == 1


def test_migrated_candidate_keys_are_unique_per_search_workspace(tmp_path):
    path = tmp_path / "legacy.sqlite3"
    _legacy_database(path)
    init_db(path)
    conn = connect(path)
    conn.execute(
        "INSERT INTO search_workspaces "
        "(id, name, status, revision, created_at, updated_at, archived_at) "
        "VALUES ('search_other', 'Other', 'active', 1, '2026-08-21', '2026-08-21', NULL)"
    )
    conn.execute(
        "INSERT INTO discovery_candidates "
        "(id, search_workspace_id, company, title, location, lifecycle_status, "
        "canonical_occurrence_id, promoted_workspace_id, first_seen_at, last_seen_at, updated_at) "
        "VALUES ('disc_other', 'search_other', 'Example', 'Planner', 'London', 'new', "
        "NULL, NULL, '2026-08-21', '2026-08-21', '2026-08-21')"
    )

    conn.execute(
        "INSERT INTO discovery_candidate_keys "
        "(search_workspace_id, identity_key, candidate_id, key_type) "
        "VALUES ('search_other', 'source:portal-a:job-old', 'disc_other', 'source_record')"
    )
    conn.commit()

    assert conn.execute(
        "SELECT COUNT(*) FROM discovery_candidate_keys "
        "WHERE identity_key = 'source:portal-a:job-old'"
    ).fetchone()[0] == 2


def test_legacy_application_identity_and_promotion_origin_are_backfilled(tmp_path):
    path = tmp_path / "legacy.sqlite3"
    _legacy_database(path)
    conn = sqlite3.connect(path)
    source_record = {
        "schema_version": "job-source-record.v0",
        "source": "portal-a",
        "source_record_id": "job-old",
        "source_url": "https://jobs.example/job-old",
        "captured_at": "2026-08-20T11:00:00+00:00",
        "company": "Example",
        "title": "Planner",
        "location": "London",
        "description": "Plan complex delivery programmes.",
        "employment_type": "full_time",
    }
    snapshot = normalize_job_source_record(source_record)
    conn.execute(
        "INSERT INTO workspaces "
        "(id, kind, company, title, workflow_status, created_at, updated_at) "
        "VALUES ('ws_old', 'job', 'Example', 'Planner', NULL, '2026-08-20', '2026-08-20')"
    )
    conn.execute(
        "INSERT INTO artifacts "
        "(id, workspace_id, artifact_type, content_id, payload_json, created_at) "
        "VALUES ('art_old', 'ws_old', 'job_posting_snapshot', 'jobsnap_old', ?, '2026-08-20')",
        (json.dumps(snapshot),),
    )
    conn.execute(
        "INSERT INTO current_artifacts (workspace_id, artifact_type, artifact_id) "
        "VALUES ('ws_old', 'job_posting_snapshot', 'art_old')"
    )
    conn.execute(
        "UPDATE discovery_candidates SET lifecycle_status = 'promoted', "
        "promoted_workspace_id = 'ws_old' WHERE id = 'disc_old'"
    )
    conn.commit()
    conn.close()

    init_db(path)
    migrated = connect(path)

    identity = migrated.execute(
        "SELECT * FROM application_workspace_job_identities "
        "WHERE application_workspace_id = 'ws_old'"
    ).fetchone()
    assert identity["source_record_key"] == "source:portal-a:job-old"
    migrated_source = json.loads(identity["source_record_json"])
    assert migrated_source["description"] == "Plan complex delivery programmes."
    assert migrated_source["employment_type"] == "full_time"
    origin = migrated.execute(
        "SELECT * FROM application_workspace_origins "
        "WHERE discovery_candidate_id = 'disc_old'"
    ).fetchone()
    assert origin["application_workspace_id"] == "ws_old"
    assert origin["search_workspace_id"] == DEFAULT_SEARCH_WORKSPACE_ID


def test_failed_migration_rolls_back_all_domain_schema_changes(tmp_path):
    path = tmp_path / "invalid-legacy.sqlite3"
    _legacy_database(path)
    conn = sqlite3.connect(path)
    conn.execute(
        "UPDATE discovery_candidates SET promoted_workspace_id = 'missing-workspace' "
        "WHERE id = 'disc_old'"
    )
    conn.commit()
    conn.close()

    with pytest.raises(sqlite3.IntegrityError, match="foreign-key violations"):
        init_db(path)

    inspected = sqlite3.connect(path)
    assert inspected.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == 0
    assert inspected.execute(
        "SELECT COUNT(*) FROM sqlite_master "
        "WHERE type = 'table' AND name = 'search_workspaces'"
    ).fetchone()[0] == 0
