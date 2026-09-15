"""Migration 013: application_blockers.semantic_subject_key, nullable,
no backfill (Phase 4C spec §3, §18)."""

from __future__ import annotations

from webapp.persistence.db import connect, init_db
from webapp.persistence.migrations import SEMANTIC_SUBJECT_KEY_MIGRATION_ID


def test_migration_is_recorded(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    row = conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?",
        (SEMANTIC_SUBJECT_KEY_MIGRATION_ID,),
    ).fetchone()
    assert row is not None
    conn.close()


def test_column_exists_and_is_nullable(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    columns = {
        row["name"]: row["notnull"]
        for row in conn.execute("PRAGMA table_info(application_blockers)").fetchall()
    }
    assert "semantic_subject_key" in columns
    assert columns["semantic_subject_key"] == 0  # 0 == nullable in PRAGMA table_info
    conn.close()


def test_running_migrations_twice_is_idempotent(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    init_db(path)  # second call must not raise (column already exists)
    conn = connect(path)
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(application_blockers)").fetchall()}
    assert "semantic_subject_key" in columns
    conn.close()
