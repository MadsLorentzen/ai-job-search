from __future__ import annotations

import sqlite3

import pytest

from webapp.persistence.db import connect, init_db
import webapp.persistence.migrations as migrations
from webapp.persistence.migrations import POLICY_DECISIONS_MIGRATION_ID
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.review import save_review_decision


def test_fresh_bootstrap_creates_policy_decisions_table(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    assert conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?",
        (POLICY_DECISIONS_MIGRATION_ID,),
    ).fetchone()
    tables = {
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    assert "policy_decisions" in tables
    assert conn.execute("SELECT count(*) FROM policy_decisions").fetchone()[0] == 0
    conn.close()


def test_fresh_bootstrap_and_idempotent_restart(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    init_db(path)
    conn = connect(path)
    count = conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE id = ?",
        (POLICY_DECISIONS_MIGRATION_ID,),
    ).fetchone()[0]
    assert count == 1
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()


def _return_to_009(conn):
    conn.execute("DROP TRIGGER policy_decisions_immutable_update")
    conn.execute("DROP TRIGGER policy_decisions_immutable_delete")
    conn.execute("DROP TABLE policy_decisions")
    # SQLite 3.35+ supports DROP COLUMN directly.
    conn.execute("ALTER TABLE review_decisions DROP COLUMN policy_decision_id")
    conn.execute("ALTER TABLE review_decisions DROP COLUMN resolved_by")
    conn.execute("DELETE FROM schema_migrations WHERE id = ?", (POLICY_DECISIONS_MIGRATION_ID,))
    conn.commit()


def test_upgrade_preserves_existing_review_decisions_unchanged(tmp_path):
    """Migration upgrades an existing pre-Phase-3 database: existing
    review_decisions rows, created before resolved_by/policy_decision_id
    existed, must survive the upgrade with their original columns intact
    and the two new columns present but NULL (no backfill, no
    reinterpretation)."""
    path = tmp_path / "upgrade.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Existing Co", title="Engineer")
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    legacy_decision = save_review_decision(
        conn, workspace_id=workspace["id"], review_item_type="gate_flag",
        source_artifact_id=artifact["id"], domain_item_id="gate:eligibility",
        disposition="acknowledged_and_proceed", note="Pre-Phase-3 human decision",
    )

    _return_to_009(conn)
    migrations.apply_migrations(conn)

    row = conn.execute(
        "SELECT * FROM review_decisions WHERE id = ?", (legacy_decision["id"],)
    ).fetchone()
    assert row is not None
    assert row["disposition"] == "acknowledged_and_proceed"
    assert row["domain_item_id"] == "gate:eligibility"
    assert row["note"] == "Pre-Phase-3 human decision"
    assert row["resolved_by"] is None
    assert row["policy_decision_id"] is None
    assert conn.execute("SELECT count(*) FROM policy_decisions").fetchone()[0] == 0
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()


def test_failed_010_rolls_back_every_table_and_migration_marker(tmp_path, monkeypatch):
    path = tmp_path / "rollback.sqlite3"
    init_db(path)
    conn = connect(path)
    _return_to_009(conn)
    original = migrations._migrate_policy_decisions

    def fail_after_ddl(connection):
        original(connection)
        raise RuntimeError("injected 010 failure")

    monkeypatch.setattr(migrations, "_migrate_policy_decisions", fail_after_ddl)
    with pytest.raises(RuntimeError, match="injected"):
        migrations.apply_migrations(conn)
    assert conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?", (POLICY_DECISIONS_MIGRATION_ID,)
    ).fetchone() is None
    assert conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'policy_decisions'"
    ).fetchone() is None
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_policy_decisions_are_immutable(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Acme", title="Role")
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    conn.execute(
        "INSERT INTO policy_decisions "
        "(id, workspace_id, stage, source_artifact_id, review_item_type, subject_key, "
        "domain_item_id, outcome, policy_version, policy_fingerprint, evidence_ids, "
        "supported_facts, recorded_gaps, reason_code, reason, confidence, blocking, created_at) "
        "VALUES ('pdec_1', ?, 'fit', ?, 'gate_flag', 'gate:eligibility', NULL, "
        "'AUTO_PROCEED', 'application-decision-policy.v0', 'appdecpolicy_x', '[]', '[]', "
        "'[]', 'gate_material_supportive', 'reason', NULL, 0, 'now')",
        (workspace["id"], artifact["id"]),
    )
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("UPDATE policy_decisions SET outcome = 'AUTO_REJECT' WHERE id = 'pdec_1'")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("DELETE FROM policy_decisions WHERE id = 'pdec_1'")
    conn.close()


def test_policy_decisions_outcome_check_constraint(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Acme", title="Role")
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO policy_decisions "
            "(id, workspace_id, stage, source_artifact_id, review_item_type, subject_key, "
            "domain_item_id, outcome, policy_version, policy_fingerprint, evidence_ids, "
            "supported_facts, recorded_gaps, reason_code, reason, confidence, blocking, created_at) "
            "VALUES ('pdec_bad', ?, 'fit', ?, 'gate_flag', 'gate:eligibility', NULL, "
            "'NOT_A_REAL_OUTCOME', 'application-decision-policy.v0', 'appdecpolicy_x', '[]', '[]', "
            "'[]', 'reason_code', 'reason', NULL, 0, 'now')",
            (workspace["id"], artifact["id"]),
        )
    conn.close()


def test_policy_decisions_subject_key_not_null_constraint(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Acme", title="Role")
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO policy_decisions "
            "(id, workspace_id, stage, source_artifact_id, review_item_type, subject_key, "
            "domain_item_id, outcome, policy_version, policy_fingerprint, evidence_ids, "
            "supported_facts, recorded_gaps, reason_code, reason, confidence, blocking, created_at) "
            "VALUES ('pdec_null_subject', ?, 'fit', ?, 'gate_flag', NULL, NULL, "
            "'AUTO_PROCEED', 'application-decision-policy.v0', 'appdecpolicy_x', '[]', '[]', "
            "'[]', 'reason_code', 'reason', NULL, 0, 'now')",
            (workspace["id"], artifact["id"]),
        )
    conn.close()
