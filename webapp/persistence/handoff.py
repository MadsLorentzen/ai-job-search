from __future__ import annotations

import hashlib
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_pairing_secret(secret: str) -> str:
    return f"sha256:{hashlib.sha256(secret.encode('utf-8')).hexdigest()}"


def create_extension_credential(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    secret_hash: str,
    credential_id: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    credential_id = credential_id or f"extcred_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO extension_credentials "
        "(id, account_id, secret_hash, created_at, revoked_at) "
        "VALUES (?, ?, ?, ?, NULL)",
        (credential_id, account_id, secret_hash, now),
    )
    if commit:
        conn.commit()
    row = conn.execute(
        "SELECT * FROM extension_credentials WHERE id = ?", (credential_id,)
    ).fetchone()
    return dict(row)


def get_extension_credential_by_hash(
    conn: sqlite3.Connection, secret_hash: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM extension_credentials "
        "WHERE secret_hash = ? AND revoked_at IS NULL",
        (secret_hash,),
    ).fetchone()
    return dict(row) if row else None


def revoke_extension_credential(
    conn: sqlite3.Connection, credential_id: str, *, commit: bool = True
) -> None:
    conn.execute(
        "UPDATE extension_credentials SET revoked_at = ? "
        "WHERE id = ? AND revoked_at IS NULL",
        (_now(), credential_id),
    )
    if commit:
        conn.commit()


_TERMINAL_STATUSES = frozenset({"abandoned", "expired", "user_confirmed_submitted"})


def create_handoff_session(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    workspace_id: str,
    pack_artifact_id: str,
    target_url: str,
    target_domain: str,
    ats_adapter_id: str,
    ats_adapter_version: str,
    session_id: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    session_id = session_id or f"hs_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO handoff_sessions "
        "(id, account_id, workspace_id, pack_artifact_id, target_url, "
        "target_domain, ats_adapter_id, ats_adapter_version, started_at, "
        "status, user_confirmed_submitted_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', NULL)",
        (
            session_id, account_id, workspace_id, pack_artifact_id,
            target_url, target_domain, ats_adapter_id, ats_adapter_version,
            now,
        ),
    )
    if commit:
        conn.commit()
    return get_handoff_session(conn, session_id)


def get_handoff_session(
    conn: sqlite3.Connection, session_id: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM handoff_sessions WHERE id = ?", (session_id,)
    ).fetchone()
    return dict(row) if row else None


def find_in_progress_handoff_sessions(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    workspace_id: str,
    target_domain: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM handoff_sessions "
        "WHERE account_id = ? AND workspace_id = ? AND target_domain = ? "
        "AND status = 'in_progress' ORDER BY started_at DESC",
        (account_id, workspace_id, target_domain),
    ).fetchall()
    return [dict(row) for row in rows]


def set_handoff_session_status(
    conn: sqlite3.Connection,
    session_id: str,
    *,
    status: str,
    user_confirmed_submitted_at: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    conn.execute(
        "UPDATE handoff_sessions SET status = ?, "
        "user_confirmed_submitted_at = COALESCE(?, user_confirmed_submitted_at) "
        "WHERE id = ?",
        (status, user_confirmed_submitted_at, session_id),
    )
    if commit:
        conn.commit()
    return get_handoff_session(conn, session_id)
