from __future__ import annotations

from webapp.persistence.db import connect, init_db
from webapp.persistence.onboarding import (
    get_progress,
    list_progress_for_account,
    upsert_progress,
)


def _db(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    return connect(db_path)


def test_get_progress_returns_none_when_absent(tmp_path):
    conn = _db(tmp_path)
    assert get_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro"
    ) is None
    conn.close()


def test_upsert_progress_creates_then_updates_same_row(tmp_path):
    conn = _db(tmp_path)
    created = upsert_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="in_progress", current_step_index=0,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:00:00+00:00", completed_at=None,
        times_completed=0, times_started=1,
    )
    assert created["status"] == "in_progress"
    assert created["current_step_index"] == 0

    updated = upsert_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="in_progress", current_step_index=1,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:01:00+00:00", completed_at=None,
        times_completed=0, times_started=1,
    )
    assert updated["current_step_index"] == 1

    fetched = get_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro"
    )
    assert fetched["current_step_index"] == 1

    rows = conn.execute(
        "SELECT COUNT(*) FROM onboarding_progress "
        "WHERE account_id = 'account_local' AND walkthrough_id = 'dashboard_intro'"
    ).fetchone()[0]
    assert rows == 1
    conn.close()


def test_progress_is_isolated_per_walkthrough_id(tmp_path):
    conn = _db(tmp_path)
    upsert_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="completed", current_step_index=2,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:02:00+00:00",
        completed_at="2026-08-27T00:02:00+00:00", times_completed=1,
        times_started=1,
    )
    other = get_progress(
        conn, account_id="account_local", walkthrough_id="profile_intro"
    )
    assert other is None
    conn.close()


def test_list_progress_for_account_returns_only_that_account(tmp_path):
    conn = _db(tmp_path)
    from webapp.persistence.accounts import create_account

    create_account(conn, display_name="Second user", account_id="account_second")
    upsert_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="completed", current_step_index=2,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:02:00+00:00",
        completed_at="2026-08-27T00:02:00+00:00", times_completed=1,
        times_started=1,
    )
    upsert_progress(
        conn, account_id="account_second", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="in_progress", current_step_index=0,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:00:00+00:00", completed_at=None,
        times_completed=0, times_started=1,
    )

    local_rows = list_progress_for_account(conn, account_id="account_local")
    assert len(local_rows) == 1
    assert local_rows[0]["status"] == "completed"
    conn.close()
