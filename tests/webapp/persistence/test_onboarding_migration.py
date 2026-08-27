from __future__ import annotations

import sqlite3

import pytest

from webapp.persistence.db import connect, init_db
from webapp.persistence.migrations import (
    ONBOARDING_WALKTHROUGHS_MIGRATION_ID,
    apply_migrations,
)


def test_migration_006_creates_onboarding_progress_table(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    applied = conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?",
        (ONBOARDING_WALKTHROUGHS_MIGRATION_ID,),
    ).fetchone()
    assert applied is not None

    tables = {
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    assert "onboarding_progress" in tables
    conn.close()


def test_migration_006_is_idempotent(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    apply_migrations(conn)  # second call must not raise or duplicate
    count = conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE id = ?",
        (ONBOARDING_WALKTHROUGHS_MIGRATION_ID,),
    ).fetchone()[0]
    assert count == 1
    conn.close()


def test_onboarding_progress_status_check_constraint(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)

    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO onboarding_progress "
            "(account_id, walkthrough_id, walkthrough_version, status, "
            "current_step_index, dismissal_reason, started_at, "
            "last_interacted_at, completed_at, times_completed, "
            "times_started, updated_at) "
            "VALUES ('account_local', 'dashboard_intro', 1, 'not_a_status', "
            "0, NULL, NULL, 'now', NULL, 0, 0, 'now')"
        )
    conn.close()
