from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_progress(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM onboarding_progress "
        "WHERE account_id = ? AND walkthrough_id = ?",
        (account_id, walkthrough_id),
    ).fetchone()
    return dict(row) if row else None


def upsert_progress(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    walkthrough_id: str,
    walkthrough_version: int,
    status: str,
    current_step_index: int,
    dismissal_reason: str | None,
    started_at: str | None,
    last_interacted_at: str,
    completed_at: str | None,
    times_completed: int,
    times_started: int,
    commit: bool = True,
) -> dict[str, Any]:
    now = _now()
    conn.execute(
        "INSERT INTO onboarding_progress "
        "(account_id, walkthrough_id, walkthrough_version, status, "
        "current_step_index, dismissal_reason, started_at, "
        "last_interacted_at, completed_at, times_completed, times_started, "
        "updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (account_id, walkthrough_id) DO UPDATE SET "
        "walkthrough_version = excluded.walkthrough_version, "
        "status = excluded.status, "
        "current_step_index = excluded.current_step_index, "
        "dismissal_reason = excluded.dismissal_reason, "
        "started_at = COALESCE(excluded.started_at, onboarding_progress.started_at), "
        "last_interacted_at = excluded.last_interacted_at, "
        "completed_at = excluded.completed_at, "
        "times_completed = excluded.times_completed, "
        "times_started = excluded.times_started, "
        "updated_at = excluded.updated_at",
        (
            account_id, walkthrough_id, walkthrough_version, status,
            current_step_index, dismissal_reason, started_at,
            last_interacted_at, completed_at, times_completed, times_started,
            now,
        ),
    )
    if commit:
        conn.commit()
    return get_progress(conn, account_id=account_id, walkthrough_id=walkthrough_id)


def list_progress_for_account(
    conn: sqlite3.Connection, *, account_id: str
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM onboarding_progress WHERE account_id = ? "
        "ORDER BY walkthrough_id",
        (account_id,),
    ).fetchall()
    return [dict(row) for row in rows]
