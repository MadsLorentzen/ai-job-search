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
