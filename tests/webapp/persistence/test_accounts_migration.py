from __future__ import annotations

import json
import sqlite3

import pytest

from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID, create_account
from webapp.persistence.db import SCHEMA_PATH, connect, init_db
from webapp.persistence.migrations import (
    PROFILE_MANAGER_MIGRATION_ID,
    SEARCH_WORKSPACES_MIGRATION_ID,
    _migrate_evidence_profile_manager,
    _migrate_search_workspaces,
)


def _post_002_database(path) -> None:
    conn = connect(path)
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.execute(
        "CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("BEGIN IMMEDIATE")
    _migrate_search_workspaces(conn)
    conn.execute(
        "INSERT INTO schema_migrations VALUES (?, '2026-08-24T10:00:00+00:00')",
        (SEARCH_WORKSPACES_MIGRATION_ID,),
    )
    _migrate_evidence_profile_manager(conn)
    conn.execute(
        "INSERT INTO schema_migrations VALUES (?, '2026-08-24T10:01:00+00:00')",
        (PROFILE_MANAGER_MIGRATION_ID,),
    )
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")

    now = "2026-08-24T11:00:00+00:00"
    conn.execute(
        "INSERT INTO workspaces VALUES ('profile', 'profile', '', '', NULL, ?, ?)",
        (now, now),
    )
    conn.execute(
        "INSERT INTO workspaces VALUES ('ws_existing', 'job', 'Existing Co', "
        "'Engineer', 'drafted', ?, ?)",
        (now, now),
    )
    conn.execute(
        "INSERT INTO artifacts VALUES "
        "('art_profile', 'profile', 'profile_snapshot', 'profile-content', ?, ?)",
        (json.dumps({"claims": []}), now),
    )
    conn.execute(
        "INSERT INTO artifacts VALUES "
        "('art_job', 'ws_existing', 'job_posting_snapshot', 'job-content', ?, ?)",
        (json.dumps({"company": "Existing Co", "title": "Engineer"}), now),
    )
    conn.executemany(
        "INSERT INTO current_artifacts VALUES (?, ?, ?)",
        [
            ("profile", "profile_snapshot", "art_profile"),
            ("ws_existing", "job_posting_snapshot", "art_job"),
        ],
    )
    conn.execute(
        "INSERT INTO review_decisions VALUES "
        "('review_existing', 'ws_existing', 'profile_conflict', 'art_profile', "
        "'claim-1', 'omit_from_positioning', NULL, ?)",
        (now,),
    )
    conn.execute(
        "INSERT INTO workflow_events VALUES "
        "('event_existing', 'ws_existing', NULL, 'drafted', '2026-08-24', "
        "NULL, NULL, ?)",
        (now,),
    )
    conn.execute(
        "INSERT INTO provider_audits VALUES "
        "('audit_existing', 'ws_existing', 'job_fit', NULL, '{}', ?)",
        (now,),
    )
    conn.execute(
        "INSERT INTO profile_source_settings VALUES ('cv/main_example.tex', 0, ?)",
        (now,),
    )
    conn.execute(
        "INSERT INTO profile_source_entries VALUES "
        "('profile-entry-existing00001', "
        "'.claude/skills/job-application-assistant/01-candidate-profile.md', "
        "'identity', 'fingerprint', 0, ?, ?)",
        (now, now),
    )
    conn.execute(
        "INSERT INTO application_workspace_job_identities VALUES "
        "('identity_existing', 'ws_existing', 'source:portal:job-1', NULL, "
        "'fallback:existing co:engineer:', ?, ?)",
        (json.dumps({"source": "portal", "source_record_id": "job-1"}), now),
    )
    conn.execute(
        "INSERT INTO user_profile_versions VALUES "
        "('prefs_existing', 'prefs-content', '{}', ?)",
        (now,),
    )
    conn.execute(
        "INSERT INTO search_workspace_user_profiles VALUES "
        "('search_default', 'prefs_existing', 1, ?)",
        (now,),
    )
    conn.execute(
        "INSERT INTO search_workspace_user_profile_history VALUES "
        "('prefs_history', 'search_default', 'prefs_existing', NULL, ?)",
        (now,),
    )
    conn.execute(
        "INSERT INTO discovery_runs VALUES "
        "('run_existing', 'search_default', 'prefs_existing', 'prefs-content', "
        "'{}', '{}', 'completed', ?, ?)",
        (now, now),
    )
    conn.execute(
        "INSERT INTO discovery_candidates VALUES "
        "('candidate_existing', 'search_default', 'Existing Co', 'Engineer', "
        "'London', 'promoted', NULL, 'ws_existing', ?, ?, ?)",
        (now, now, now),
    )
    source_record = json.dumps(
        {
            "source": "portal",
            "source_record_id": "job-1",
            "company": "Existing Co",
            "title": "Engineer",
        }
    )
    conn.execute(
        "INSERT INTO discovery_occurrences VALUES "
        "('occurrence_existing', 'search_default', 'candidate_existing', "
        "'run_existing', 'portal', 'job-1', NULL, ?, ?, ?)",
        (source_record, now, now),
    )
    conn.execute(
        "UPDATE discovery_candidates SET canonical_occurrence_id='occurrence_existing' "
        "WHERE id='candidate_existing'"
    )
    conn.execute(
        "INSERT INTO discovery_candidate_keys VALUES "
        "('search_default', 'source:portal:job-1', 'candidate_existing', 'source_record')"
    )
    conn.execute(
        "INSERT INTO discovery_fit_results VALUES "
        "('fit_existing', 'search_default', 'candidate_existing', "
        "'occurrence_existing', '{}', '{}', '{}', ?)",
        (now,),
    )
    conn.execute(
        "INSERT INTO current_discovery_fits VALUES "
        "('search_default', 'candidate_existing', 'fit_existing')"
    )
    conn.execute(
        "INSERT INTO application_workspace_origins VALUES "
        "('origin_existing', 'ws_existing', 'search_default', "
        "'candidate_existing', 'occurrence_existing', 'run_existing', ?)",
        (now,),
    )
    conn.commit()
    conn.close()


def test_post_002_upgrade_backfills_default_owner_without_data_loss(tmp_path):
    path = tmp_path / "post-002.sqlite3"
    _post_002_database(path)

    init_db(path)
    init_db(path)

    conn = connect(path)
    account = conn.execute(
        "SELECT * FROM accounts WHERE id = ?", (DEFAULT_ACCOUNT_ID,)
    ).fetchone()
    assert account["display_name"] == "Local user"
    assert {
        row["account_id"] for row in conn.execute("SELECT account_id FROM workspaces")
    } == {DEFAULT_ACCOUNT_ID}
    assert {
        row["account_id"]
        for row in conn.execute("SELECT account_id FROM search_workspaces")
    } == {DEFAULT_ACCOUNT_ID}
    assert dict(
        conn.execute("SELECT * FROM account_profiles").fetchone()
    )["workspace_id"] == "profile"
    assert conn.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM review_decisions").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM workflow_events").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM provider_audits").fetchone()[0] == 1
    assert conn.execute(
        "SELECT account_id FROM profile_source_entries"
    ).fetchone()[0] == DEFAULT_ACCOUNT_ID
    assert conn.execute(
        "SELECT account_id FROM profile_source_settings"
    ).fetchone()[0] == DEFAULT_ACCOUNT_ID
    assert conn.execute(
        "SELECT COUNT(*) FROM application_workspace_job_identities"
    ).fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM discovery_runs").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM discovery_candidates").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM discovery_occurrences").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM discovery_fit_results").fetchone()[0] == 1
    assert conn.execute(
        "SELECT COUNT(*) FROM application_workspace_origins"
    ).fetchone()[0] == 1
    assert {
        row["id"] for row in conn.execute("SELECT id FROM schema_migrations")
    } == {
        "001_search_workspaces",
        "002_evidence_profile_manager",
        "003_accounts_ownership",
        "004_application_documents",
        "005_handoff_sessions",
    }
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    create_account(
        conn,
        account_id="account_transfer_target",
        display_name="Transfer target",
    )
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("UPDATE workspaces SET company='Uncommitted' WHERE id='ws_existing'")
    with pytest.raises(sqlite3.IntegrityError, match="workspace ownership is immutable"):
        conn.execute(
            "UPDATE workspaces SET account_id='account_transfer_target' "
            "WHERE id='ws_existing'"
        )
    conn.rollback()
    workspace = conn.execute(
        "SELECT company, account_id FROM workspaces WHERE id='ws_existing'"
    ).fetchone()
    assert dict(workspace) == {
        "company": "Existing Co",
        "account_id": DEFAULT_ACCOUNT_ID,
    }
    assert conn.execute(
        "SELECT COUNT(*) FROM artifacts WHERE workspace_id='ws_existing'"
    ).fetchone()[0] == 1

    conn.execute("BEGIN IMMEDIATE")
    with pytest.raises(
        sqlite3.IntegrityError, match="search workspace ownership is immutable"
    ):
        conn.execute(
            "UPDATE search_workspaces SET account_id='account_transfer_target' "
            "WHERE id='search_default'"
        )
    conn.rollback()
    assert conn.execute(
        "SELECT account_id FROM search_workspaces WHERE id='search_default'"
    ).fetchone()[0] == DEFAULT_ACCOUNT_ID
    assert conn.execute(
        "SELECT COUNT(*) FROM discovery_runs WHERE search_workspace_id='search_default'"
    ).fetchone()[0] == 1

    with pytest.raises(sqlite3.IntegrityError, match="account does not exist"):
        conn.execute(
            "INSERT INTO workspaces "
            "(id, kind, company, title, created_at, updated_at, account_id) "
            "VALUES ('ws_orphan', 'job', '', '', 'now', 'now', 'missing')"
        )
    with pytest.raises(sqlite3.IntegrityError, match="account owns application data"):
        conn.execute(
            "DELETE FROM accounts WHERE id = ?", (DEFAULT_ACCOUNT_ID,)
        )
    conn.close()

    restarted = connect(path)
    assert restarted.execute(
        "SELECT COUNT(*) FROM accounts WHERE id = ?", (DEFAULT_ACCOUNT_ID,)
    ).fetchone()[0] == 1


def test_failed_accounts_migration_rolls_back_and_preserves_prior_history(
    tmp_path, monkeypatch
):
    path = tmp_path / "failed-003.sqlite3"
    _post_002_database(path)

    def fail_after_partial_ddl(conn):
        conn.execute("CREATE TABLE accounts (id TEXT PRIMARY KEY)")
        raise sqlite3.OperationalError("simulated 003 failure")

    monkeypatch.setattr(
        "webapp.persistence.migrations._migrate_accounts_ownership",
        fail_after_partial_ddl,
    )
    with pytest.raises(sqlite3.OperationalError, match="simulated 003 failure"):
        init_db(path)

    conn = connect(path)
    assert conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='accounts'"
    ).fetchone()[0] == 0
    assert {
        row["id"] for row in conn.execute("SELECT id FROM schema_migrations")
    } == {"001_search_workspaces", "002_evidence_profile_manager"}
    assert conn.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] == 2
    assert conn.execute("PRAGMA table_info(workspaces)").fetchall()[-1][1] != "account_id"
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
