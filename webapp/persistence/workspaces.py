from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

PROFILE_WORKSPACE_ID = "profile"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_profile_workspace(conn: sqlite3.Connection) -> dict[str, Any]:
    existing = get_workspace(conn, PROFILE_WORKSPACE_ID)
    if existing is not None:
        return existing
    now = _now()
    try:
        conn.execute(
            "INSERT INTO workspaces (id, kind, company, title, workflow_status, created_at, updated_at) "
            "VALUES (?, 'profile', '', '', NULL, ?, ?)",
            (PROFILE_WORKSPACE_ID, now, now),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        # A concurrent caller won the race and already inserted the single
        # profile-workspace row (primary-key conflict on PROFILE_WORKSPACE_ID).
        # ensure_profile_workspace() is documented as idempotent, so resolve
        # to the existing row instead of propagating the conflict.
        conn.rollback()
        return get_workspace(conn, PROFILE_WORKSPACE_ID)
    return get_workspace(conn, PROFILE_WORKSPACE_ID)


def create_workspace(conn: sqlite3.Connection, *, company: str, title: str) -> dict[str, Any]:
    workspace_id = f"ws_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO workspaces (id, kind, company, title, workflow_status, created_at, updated_at) "
        "VALUES (?, 'job', ?, ?, NULL, ?, ?)",
        (workspace_id, company, title, now, now),
    )
    conn.commit()
    return get_workspace(conn, workspace_id)


def get_workspace(conn: sqlite3.Connection, workspace_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()
    return dict(row) if row else None


def list_workspaces(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM workspaces WHERE kind = 'job' ORDER BY updated_at DESC"
    ).fetchall()
    return [dict(row) for row in rows]


def set_workflow_status(conn: sqlite3.Connection, workspace_id: str, status: str) -> None:
    conn.execute(
        "UPDATE workspaces SET workflow_status = ?, updated_at = ? WHERE id = ?",
        (status, _now(), workspace_id),
    )
    conn.commit()
