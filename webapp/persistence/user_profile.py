from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from product.user_profile import normalize_user_profile, user_profile_content_id
from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID
from webapp.persistence.search_workspaces import (
    DEFAULT_SEARCH_WORKSPACE_ID,
    SearchWorkspaceConflictError,
    SearchWorkspaceError,
    get_search_workspace,
)


CURRENT_USER_PROFILE_ID = "current"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_record(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    record = dict(row)
    record["payload"] = json.loads(record.pop("payload_json"))
    return record


def get_current_user_profile(
    conn: sqlite3.Connection,
    search_workspace_id: str = DEFAULT_SEARCH_WORKSPACE_ID,
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT v.*, p.revision AS profile_revision, p.updated_at AS profile_updated_at "
        "FROM search_workspace_user_profiles p "
        "JOIN user_profile_versions v ON v.id = p.current_version_id "
        "JOIN search_workspaces s ON s.id = p.search_workspace_id "
        "WHERE p.search_workspace_id = ? AND s.account_id = ?",
        (search_workspace_id, account_id),
    ).fetchone()
    return _row_to_record(row)


def save_user_profile(
    conn: sqlite3.Connection,
    profile: dict[str, Any],
    *,
    search_workspace_id: str = DEFAULT_SEARCH_WORKSPACE_ID,
    expected_revision: int | None = None,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    workspace = get_search_workspace(
        conn, search_workspace_id, account_id=account_id
    )
    if workspace is None:
        raise SearchWorkspaceError(f"unknown search workspace {search_workspace_id!r}")
    if workspace["status"] != "active":
        raise SearchWorkspaceError("archived search workspaces are read-only")
    payload = normalize_user_profile(profile)
    content_id = user_profile_content_id(payload)
    current = get_current_user_profile(
        conn, search_workspace_id, account_id=account_id
    )
    if expected_revision is not None:
        current_revision = current["profile_revision"] if current else 0
        if current_revision != expected_revision:
            raise SearchWorkspaceConflictError(
                "search preferences changed after this page was loaded"
            )
    if current is not None and current["content_id"] == content_id:
        return current
    existing = conn.execute(
        "SELECT * FROM user_profile_versions WHERE content_id = ?", (content_id,)
    ).fetchone()
    if existing is None:
        version_id = f"usrprof_{uuid.uuid4().hex[:20]}"
        conn.execute(
            "INSERT INTO user_profile_versions "
            "(id, content_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
            (
                version_id,
                content_id,
                json.dumps(payload, ensure_ascii=False, sort_keys=True),
                _now(),
            ),
        )
    else:
        version_id = existing["id"]
    now = _now()
    previous_version_id = current["id"] if current else None
    if current is None:
        conn.execute(
            "INSERT INTO search_workspace_user_profiles "
            "(search_workspace_id, current_version_id, revision, updated_at) "
            "VALUES (?, ?, 1, ?)",
            (search_workspace_id, version_id, now),
        )
    else:
        cursor = conn.execute(
            "UPDATE search_workspace_user_profiles "
            "SET current_version_id = ?, revision = revision + 1, updated_at = ? "
            "WHERE search_workspace_id = ? AND revision = ?",
            (
                version_id,
                now,
                search_workspace_id,
                current["profile_revision"],
            ),
        )
        if cursor.rowcount != 1:
            conn.rollback()
            raise SearchWorkspaceConflictError(
                "search preferences changed after this page was loaded"
            )
    conn.execute(
        "INSERT INTO search_workspace_user_profile_history "
        "(id, search_workspace_id, version_id, previous_version_id, assigned_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (
            f"swuph_{uuid.uuid4().hex[:20]}",
            search_workspace_id,
            version_id,
            previous_version_id,
            now,
        ),
    )
    conn.commit()
    return get_current_user_profile(
        conn, search_workspace_id, account_id=account_id
    )


def list_user_profile_versions(
    conn: sqlite3.Connection, *, account_id: str = DEFAULT_ACCOUNT_ID
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT DISTINCT v.* FROM user_profile_versions v "
        "JOIN search_workspace_user_profile_history h ON h.version_id = v.id "
        "JOIN search_workspaces s ON s.id = h.search_workspace_id "
        "WHERE s.account_id = ? ORDER BY v.created_at DESC, v.id DESC",
        (account_id,),
    ).fetchall()
    return [_row_to_record(row) for row in rows]
