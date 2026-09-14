from __future__ import annotations

import sqlite3

import pytest

from webapp.persistence.db import connect, init_db
import webapp.persistence.migrations as migrations
from webapp.persistence.migrations import (
    APPLICATION_BLOCKERS_MIGRATION_ID,
    BLOCKER_RESOLUTION_HISTORY_MIGRATION_ID,
)
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.policy_decisions import save_policy_decision


def test_fresh_bootstrap_has_request_id_and_superseded_at_columns(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    assert conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?",
        (BLOCKER_RESOLUTION_HISTORY_MIGRATION_ID,),
    ).fetchone()
    resolution_cols = {row["name"] for row in conn.execute("PRAGMA table_info(blocker_resolutions)").fetchall()}
    assert "request_id" in resolution_cols
    blocker_cols = {row["name"] for row in conn.execute("PRAGMA table_info(application_blockers)").fetchall()}
    assert "superseded_at" in blocker_cols
    conn.close()


def test_fresh_bootstrap_and_idempotent_restart(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    init_db(path)
    conn = connect(path)
    count = conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE id = ?",
        (BLOCKER_RESOLUTION_HISTORY_MIGRATION_ID,),
    ).fetchone()[0]
    assert count == 1
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()


def _return_to_011(conn):
    conn.execute("DROP TRIGGER blocker_resolutions_no_delete")
    conn.execute("DROP TRIGGER blocker_resolutions_immutable_update")
    conn.execute("DROP TABLE blocker_resolutions")
    conn.execute(
        "CREATE TABLE blocker_resolutions ("
        "id TEXT PRIMARY KEY, blocker_id TEXT NOT NULL UNIQUE REFERENCES application_blockers(id), "
        "workspace_id TEXT NOT NULL REFERENCES workspaces(id), "
        "policy_decision_id TEXT NOT NULL REFERENCES policy_decisions(id), "
        "answer_value TEXT NOT NULL, "
        "answer_scope TEXT NOT NULL CHECK (answer_scope IN ('APPLICATION_ONLY', 'SEARCH_WORKSPACE', 'CANDIDATE_FACT')), "
        "resolved_by TEXT NOT NULL, promoted_evidence_id TEXT, created_at TEXT NOT NULL)"
    )
    conn.execute("CREATE INDEX idx_blocker_resolutions_workspace ON blocker_resolutions(workspace_id)")
    conn.execute(
        "CREATE TRIGGER blocker_resolutions_immutable_update "
        "BEFORE UPDATE ON blocker_resolutions "
        "BEGIN SELECT RAISE(ABORT, 'blocker resolutions are immutable, append-only audit history'); END"
    )
    conn.execute(
        "CREATE TRIGGER blocker_resolutions_no_delete "
        "BEFORE DELETE ON blocker_resolutions "
        "BEGIN SELECT RAISE(ABORT, 'blocker resolutions are permanent audit history'); END"
    )
    conn.execute("ALTER TABLE application_blockers DROP COLUMN superseded_at")
    conn.execute("DELETE FROM schema_migrations WHERE id = ?", (BLOCKER_RESOLUTION_HISTORY_MIGRATION_ID,))
    conn.commit()


def test_upgrade_preserves_existing_single_resolution_with_request_id_backfilled(tmp_path):
    """Migration upgrade: a pre-012 blocker_resolutions row (one per
    blocker, no request_id) must survive with its data intact and a
    request_id populated (backfilled from its own id, so it is unique per
    blocker without inventing a fictitious client request)."""
    path = tmp_path / "upgrade.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Existing Co", title="Engineer")
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    decision = save_policy_decision(
        conn, workspace_id=workspace["id"], stage="fit", source_artifact_id=artifact["id"],
        review_item_type="gate_flag", subject_key="gate:eligibility", outcome="REQUIRE_USER",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_absent", reason="reason", blocking=True,
    )
    conn.execute(
        "INSERT INTO application_blockers "
        "(id, workspace_id, policy_decision_id, source_artifact_id, stage, blocker_type, "
        "subject_key, question, context, resume_stage, allowed_scopes, status, created_at, resolved_at) "
        "VALUES ('block_legacy', ?, ?, ?, 'fit', 'gate_flag', 'gate:eligibility', 'Q?', '{}', 'fit', "
        "'[\"APPLICATION_ONLY\"]', 'resolved', 'now', 'now')",
        (workspace["id"], decision["id"], artifact["id"]),
    )
    conn.commit()

    # Rewind to the pre-012 shape (no request_id column, blocker_id
    # UNIQUE) FIRST, then insert the legacy row using that old shape --
    # exactly what a real pre-012 database would already contain before
    # ever seeing this migration.
    _return_to_011(conn)
    conn.execute(
        "INSERT INTO blocker_resolutions "
        "(id, blocker_id, workspace_id, policy_decision_id, answer_value, answer_scope, "
        "resolved_by, promoted_evidence_id, created_at) "
        "VALUES ('blockres_legacy', 'block_legacy', ?, ?, '\"yes\"', 'APPLICATION_ONLY', "
        "'human', NULL, 'now')",
        (workspace["id"], decision["id"]),
    )
    conn.commit()

    migrations.apply_migrations(conn)

    row = dict(conn.execute("SELECT * FROM blocker_resolutions WHERE id = 'blockres_legacy'").fetchone())
    assert row["answer_value"] == '"yes"'
    assert row["request_id"] == "blockres_legacy"
    blocker_row = dict(conn.execute("SELECT * FROM application_blockers WHERE id = 'block_legacy'").fetchone())
    assert blocker_row["superseded_at"] is None
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()


def test_failed_012_rolls_back_every_table_and_migration_marker(tmp_path, monkeypatch):
    path = tmp_path / "rollback.sqlite3"
    init_db(path)
    conn = connect(path)
    _return_to_011(conn)
    original = migrations._migrate_blocker_resolution_history

    def fail_after_ddl(connection):
        original(connection)
        raise RuntimeError("injected 012 failure")

    monkeypatch.setattr(migrations, "_migrate_blocker_resolution_history", fail_after_ddl)
    with pytest.raises(RuntimeError, match="injected"):
        migrations.apply_migrations(conn)
    assert conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?", (BLOCKER_RESOLUTION_HISTORY_MIGRATION_ID,)
    ).fetchone() is None
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_multiple_resolutions_per_blocker_now_permitted(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Acme", title="Role")
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    decision = save_policy_decision(
        conn, workspace_id=workspace["id"], stage="fit", source_artifact_id=artifact["id"],
        review_item_type="gate_flag", subject_key="gate:eligibility", outcome="REQUIRE_USER",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_absent", reason="reason", blocking=True,
    )
    conn.execute(
        "INSERT INTO application_blockers "
        "(id, workspace_id, policy_decision_id, source_artifact_id, stage, blocker_type, "
        "subject_key, question, context, resume_stage, allowed_scopes, status, created_at, resolved_at) "
        "VALUES ('block_1', ?, ?, ?, 'fit', 'gate_flag', 'gate:eligibility', 'Q?', '{}', 'fit', "
        "'[\"APPLICATION_ONLY\"]', 'resolved', 'now', 'now')",
        (workspace["id"], decision["id"], artifact["id"]),
    )
    conn.execute(
        "INSERT INTO blocker_resolutions "
        "(id, blocker_id, request_id, workspace_id, policy_decision_id, answer_value, "
        "answer_scope, resolved_by, promoted_evidence_id, created_at) "
        "VALUES ('blockres_1', 'block_1', 'req_1', ?, ?, '\"55000\"', 'APPLICATION_ONLY', "
        "'human', NULL, 'now')",
        (workspace["id"], decision["id"]),
    )
    conn.execute(
        "INSERT INTO blocker_resolutions "
        "(id, blocker_id, request_id, workspace_id, policy_decision_id, answer_value, "
        "answer_scope, resolved_by, promoted_evidence_id, created_at) "
        "VALUES ('blockres_2', 'block_1', 'req_2', ?, ?, '\"58000\"', 'APPLICATION_ONLY', "
        "'human', NULL, 'now2')",
        (workspace["id"], decision["id"]),
    )
    conn.commit()
    count = conn.execute(
        "SELECT COUNT(*) FROM blocker_resolutions WHERE blocker_id = 'block_1'"
    ).fetchone()[0]
    assert count == 2
    conn.close()


def test_duplicate_request_id_for_same_blocker_rejected(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Acme", title="Role")
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    decision = save_policy_decision(
        conn, workspace_id=workspace["id"], stage="fit", source_artifact_id=artifact["id"],
        review_item_type="gate_flag", subject_key="gate:eligibility", outcome="REQUIRE_USER",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_absent", reason="reason", blocking=True,
    )
    conn.execute(
        "INSERT INTO application_blockers "
        "(id, workspace_id, policy_decision_id, source_artifact_id, stage, blocker_type, "
        "subject_key, question, context, resume_stage, allowed_scopes, status, created_at, resolved_at) "
        "VALUES ('block_1', ?, ?, ?, 'fit', 'gate_flag', 'gate:eligibility', 'Q?', '{}', 'fit', "
        "'[\"APPLICATION_ONLY\"]', 'resolved', 'now', 'now')",
        (workspace["id"], decision["id"], artifact["id"]),
    )
    conn.execute(
        "INSERT INTO blocker_resolutions "
        "(id, blocker_id, request_id, workspace_id, policy_decision_id, answer_value, "
        "answer_scope, resolved_by, promoted_evidence_id, created_at) "
        "VALUES ('blockres_1', 'block_1', 'req_1', ?, ?, '\"55000\"', 'APPLICATION_ONLY', "
        "'human', NULL, 'now')",
        (workspace["id"], decision["id"]),
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO blocker_resolutions "
            "(id, blocker_id, request_id, workspace_id, policy_decision_id, answer_value, "
            "answer_scope, resolved_by, promoted_evidence_id, created_at) "
            "VALUES ('blockres_2', 'block_1', 'req_1', ?, ?, '\"58000\"', 'APPLICATION_ONLY', "
            "'human', NULL, 'now2')",
            (workspace["id"], decision["id"]),
        )
    conn.close()


def test_application_blockers_can_be_marked_superseded(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Acme", title="Role")
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    decision = save_policy_decision(
        conn, workspace_id=workspace["id"], stage="fit", source_artifact_id=artifact["id"],
        review_item_type="gate_flag", subject_key="gate:eligibility", outcome="REQUIRE_USER",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_absent", reason="reason", blocking=True,
    )
    conn.execute(
        "INSERT INTO application_blockers "
        "(id, workspace_id, policy_decision_id, source_artifact_id, stage, blocker_type, "
        "subject_key, question, context, resume_stage, allowed_scopes, status, created_at, resolved_at) "
        "VALUES ('block_1', ?, ?, ?, 'fit', 'gate_flag', 'gate:eligibility', 'Q?', '{}', 'fit', "
        "'[\"APPLICATION_ONLY\"]', 'open', 'now', NULL)",
        (workspace["id"], decision["id"], artifact["id"]),
    )
    conn.commit()
    conn.execute(
        "UPDATE application_blockers SET status = 'superseded', superseded_at = 'now2' WHERE id = 'block_1'"
    )
    row = conn.execute("SELECT status, superseded_at FROM application_blockers WHERE id = 'block_1'").fetchone()
    assert row["status"] == "superseded"
    assert row["superseded_at"] == "now2"
    conn.close()
