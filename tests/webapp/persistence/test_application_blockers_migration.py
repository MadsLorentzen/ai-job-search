from __future__ import annotations

import sqlite3

import pytest

from webapp.persistence.db import connect, init_db
import webapp.persistence.migrations as migrations
from webapp.persistence.migrations import (
    APPLICATION_BLOCKERS_MIGRATION_ID,
    POLICY_DECISIONS_MIGRATION_ID,
)
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.policy_decisions import save_policy_decision


def test_fresh_bootstrap_creates_blocker_tables(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    assert conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?",
        (APPLICATION_BLOCKERS_MIGRATION_ID,),
    ).fetchone()
    tables = {
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    assert "application_blockers" in tables
    assert "blocker_resolutions" in tables
    assert conn.execute("SELECT count(*) FROM application_blockers").fetchone()[0] == 0
    conn.close()


def test_fresh_bootstrap_and_idempotent_restart(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    init_db(path)
    conn = connect(path)
    count = conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE id = ?",
        (APPLICATION_BLOCKERS_MIGRATION_ID,),
    ).fetchone()[0]
    assert count == 1
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()


def _return_to_010(conn):
    conn.execute("DROP TRIGGER blocker_resolutions_no_delete")
    conn.execute("DROP TRIGGER blocker_resolutions_immutable_update")
    conn.execute("DROP TRIGGER application_blockers_no_delete")
    conn.execute("DROP TRIGGER application_blockers_status_immutable_once_resolved")
    conn.execute("DROP TABLE blocker_resolutions")
    conn.execute("DROP TABLE application_blockers")
    conn.execute("DELETE FROM schema_migrations WHERE id = ?", (APPLICATION_BLOCKERS_MIGRATION_ID,))
    conn.commit()


def test_upgrade_preserves_existing_policy_decisions_unchanged(tmp_path):
    path = tmp_path / "upgrade.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Existing Co", title="Engineer")
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    legacy_decision = save_policy_decision(
        conn, workspace_id=workspace["id"], stage="fit", source_artifact_id=artifact["id"],
        review_item_type="gate_flag", subject_key="gate:eligibility", outcome="REQUIRE_USER",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_absent", reason="Pre-Phase-4B decision.", blocking=True,
    )

    _return_to_010(conn)
    migrations.apply_migrations(conn)

    row = conn.execute(
        "SELECT * FROM policy_decisions WHERE id = ?", (legacy_decision["id"],)
    ).fetchone()
    assert row is not None
    assert row["outcome"] == "REQUIRE_USER"
    assert conn.execute("SELECT count(*) FROM application_blockers").fetchone()[0] == 0
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()


def test_failed_011_rolls_back_every_table_and_migration_marker(tmp_path, monkeypatch):
    path = tmp_path / "rollback.sqlite3"
    init_db(path)
    conn = connect(path)
    _return_to_010(conn)
    original = migrations._migrate_application_blockers

    def fail_after_ddl(connection):
        original(connection)
        raise RuntimeError("injected 011 failure")

    monkeypatch.setattr(migrations, "_migrate_application_blockers", fail_after_ddl)
    with pytest.raises(RuntimeError, match="injected"):
        migrations.apply_migrations(conn)
    assert conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?", (APPLICATION_BLOCKERS_MIGRATION_ID,)
    ).fetchone() is None
    assert conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'application_blockers'"
    ).fetchone() is None
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_blocker_resolutions_are_append_only(tmp_path):
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
    conn.execute(
        "INSERT INTO blocker_resolutions "
        "(id, blocker_id, workspace_id, policy_decision_id, answer_value, answer_scope, "
        "resolved_by, promoted_evidence_id, created_at) "
        "VALUES ('blockres_1', 'block_1', ?, ?, '\"yes\"', 'APPLICATION_ONLY', 'human', NULL, 'now')",
        (workspace["id"], decision["id"]),
    )
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute(
            "UPDATE blocker_resolutions SET answer_value = '\"no\"' WHERE id = 'blockres_1'"
        )
    with pytest.raises(sqlite3.IntegrityError, match="permanent"):
        conn.execute("DELETE FROM blocker_resolutions WHERE id = 'blockres_1'")
    with pytest.raises(sqlite3.IntegrityError, match="permanent"):
        conn.execute("DELETE FROM application_blockers WHERE id = 'block_1'")
    conn.close()


def test_application_blocker_identity_fields_are_immutable_once_created(tmp_path):
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
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("UPDATE application_blockers SET question = 'changed' WHERE id = 'block_1'")
    # status and resolved_at remain updatable -- the open -> resolved transition.
    conn.execute(
        "UPDATE application_blockers SET status = 'resolved', resolved_at = 'now2' WHERE id = 'block_1'"
    )
    row = conn.execute("SELECT status FROM application_blockers WHERE id = 'block_1'").fetchone()
    assert row["status"] == "resolved"
    conn.close()


def test_application_blockers_status_check_constraint(tmp_path):
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
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO application_blockers "
            "(id, workspace_id, policy_decision_id, source_artifact_id, stage, blocker_type, "
            "subject_key, question, context, resume_stage, allowed_scopes, status, created_at, resolved_at) "
            "VALUES ('block_bad', ?, ?, ?, 'fit', 'gate_flag', 'gate:eligibility', 'Q?', '{}', 'fit', "
            "'[\"APPLICATION_ONLY\"]', 'not_a_status', 'now', NULL)",
            (workspace["id"], decision["id"], artifact["id"]),
        )
    conn.close()


def test_one_blocker_per_policy_decision_unique_constraint(tmp_path):
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
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO application_blockers "
            "(id, workspace_id, policy_decision_id, source_artifact_id, stage, blocker_type, "
            "subject_key, question, context, resume_stage, allowed_scopes, status, created_at, resolved_at) "
            "VALUES ('block_2', ?, ?, ?, 'fit', 'gate_flag', 'gate:eligibility', 'Q?', '{}', 'fit', "
            "'[\"APPLICATION_ONLY\"]', 'open', 'now', NULL)",
            (workspace["id"], decision["id"], artifact["id"]),
        )
    conn.close()
