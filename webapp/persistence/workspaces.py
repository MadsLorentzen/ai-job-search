from __future__ import annotations

import sqlite3
import uuid
import hashlib
from datetime import datetime, timezone
from typing import Any

from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID

PROFILE_WORKSPACE_ID = "profile"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_profile_workspace(
    conn: sqlite3.Connection,
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    commit: bool = True,
) -> dict[str, Any]:
    mapped = conn.execute(
        "SELECT workspace_id FROM account_profiles WHERE account_id = ?",
        (account_id,),
    ).fetchone()
    if mapped is not None:
        return get_workspace(conn, mapped["workspace_id"], account_id=account_id)
    workspace_id = (
        PROFILE_WORKSPACE_ID
        if account_id == DEFAULT_ACCOUNT_ID
        else "profile_" + hashlib.sha256(account_id.encode("utf-8")).hexdigest()[:20]
    )
    existing = get_workspace(conn, workspace_id, account_id=account_id)
    if existing is not None:
        conn.execute(
            "INSERT INTO account_profiles (account_id, workspace_id, created_at) "
            "VALUES (?, ?, ?)",
            (account_id, workspace_id, _now()),
        )
        if commit:
            conn.commit()
        return existing
    now = _now()
    try:
        conn.execute(
            "INSERT INTO workspaces "
            "(id, kind, company, title, workflow_status, created_at, updated_at, account_id) "
            "VALUES (?, 'profile', '', '', NULL, ?, ?, ?)",
            (workspace_id, now, now, account_id),
        )
        conn.execute(
            "INSERT INTO account_profiles (account_id, workspace_id, created_at) "
            "VALUES (?, ?, ?)",
            (account_id, workspace_id, now),
        )
        if commit:
            conn.commit()
    except sqlite3.IntegrityError:
        # A concurrent caller won the race and already inserted the single
        # profile-workspace row (primary-key conflict on PROFILE_WORKSPACE_ID).
        # ensure_profile_workspace() is documented as idempotent, so resolve
        # to the existing row instead of propagating the conflict.
        if commit:
            conn.rollback()
        mapped = conn.execute(
            "SELECT workspace_id FROM account_profiles WHERE account_id = ?",
            (account_id,),
        ).fetchone()
        return (
            get_workspace(conn, mapped["workspace_id"], account_id=account_id)
            if mapped
            else None
        )
    return get_workspace(conn, workspace_id, account_id=account_id)


def get_profile_workspace_id(
    conn: sqlite3.Connection, account_id: str = DEFAULT_ACCOUNT_ID
) -> str | None:
    row = conn.execute(
        "SELECT workspace_id FROM account_profiles WHERE account_id = ?",
        (account_id,),
    ).fetchone()
    return row["workspace_id"] if row else None

def create_workspace(
    conn: sqlite3.Connection, *, company: str, title: str,
    workspace_id: str | None = None, account_id: str = DEFAULT_ACCOUNT_ID,
    commit: bool = True,
) -> dict[str, Any]:
    workspace_id = workspace_id or f"ws_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO workspaces "
        "(id, kind, company, title, workflow_status, created_at, updated_at, account_id) "
        "VALUES (?, 'job', ?, ?, NULL, ?, ?, ?)",
        (workspace_id, company, title, now, now, account_id),
    )
    if commit:
        conn.commit()
    return get_workspace(conn, workspace_id, account_id=account_id)


def get_workspace(
    conn: sqlite3.Connection,
    workspace_id: str,
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM workspaces WHERE id = ? AND account_id = ?",
        (workspace_id, account_id),
    ).fetchone()
    return dict(row) if row else None


def list_workspaces(
    conn: sqlite3.Connection, *, account_id: str = DEFAULT_ACCOUNT_ID
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM workspaces WHERE kind = 'job' AND account_id = ? "
        "ORDER BY updated_at DESC",
        (account_id,),
    ).fetchall()
    return [dict(row) for row in rows]
