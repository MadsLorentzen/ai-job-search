from __future__ import annotations

import sqlite3

from webapp.persistence.db import connect, init_db
from webapp.persistence.migrations import HANDOFF_SESSIONS_MIGRATION_ID


def test_migration_004_creates_all_four_handoff_tables(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    applied = conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?",
        (HANDOFF_SESSIONS_MIGRATION_ID,),
    ).fetchone()
    assert applied is not None

    tables = {
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    assert "extension_credentials" in tables
    assert "handoff_sessions" in tables
    assert "handoff_events" in tables
    assert "submission_confirmations" in tables
    conn.close()


def test_migration_004_is_idempotent(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    from webapp.persistence.migrations import apply_migrations

    apply_migrations(conn)  # second call must not raise or duplicate
    count = conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE id = ?",
        (HANDOFF_SESSIONS_MIGRATION_ID,),
    ).fetchone()[0]
    assert count == 1
    conn.close()
