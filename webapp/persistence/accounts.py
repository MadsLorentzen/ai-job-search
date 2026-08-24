from __future__ import annotations

import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any


DEFAULT_ACCOUNT_ID = "account_local"
DEFAULT_ACCOUNT_DISPLAY_NAME = "Local user"
_ACCOUNT_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_account_id(account_id: str) -> str:
    if not _ACCOUNT_ID_PATTERN.fullmatch(account_id):
        raise ValueError("account id must be a safe opaque identifier")
    return account_id


def get_account(
    conn: sqlite3.Connection, account_id: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM accounts WHERE id = ?", (account_id,)
    ).fetchone()
    return dict(row) if row else None


def create_account(
    conn: sqlite3.Connection,
    *,
    display_name: str,
    account_id: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    normalized_name = " ".join(display_name.split())
    if not normalized_name:
        raise ValueError("account display name is required")
    account_id = validate_account_id(
        account_id or f"account_{uuid.uuid4().hex[:20]}"
    )
    conn.execute(
        "INSERT INTO accounts (id, display_name, created_at) VALUES (?, ?, ?)",
        (account_id, normalized_name, _now()),
    )
    # New accounts start with only their canonical Markdown source enabled.
    # Supplemental files may be enabled after they are explicitly provisioned
    # inside that account's isolated profile root.
    from product.profile_snapshot import SOURCE_PATHS
    from webapp.persistence.profile_sources import CANDIDATE_SOURCE

    now = _now()
    conn.executemany(
        "INSERT INTO profile_source_settings "
        "(account_id, source_path, included, updated_at) VALUES (?, ?, ?, ?)",
        [
            (account_id, source_path, int(source_path == CANDIDATE_SOURCE), now)
            for source_path in SOURCE_PATHS
            if source_path != CANDIDATE_SOURCE
        ],
    )
    if commit:
        conn.commit()
    return get_account(conn, account_id)


def list_accounts(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM accounts ORDER BY created_at, id"
    ).fetchall()
    return [dict(row) for row in rows]
