from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from product.user_profile import normalize_user_profile, user_profile_content_id


CURRENT_USER_PROFILE_ID = "current"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_record(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    record = dict(row)
    record["payload"] = json.loads(record.pop("payload_json"))
    return record


def get_current_user_profile(conn: sqlite3.Connection) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT v.* FROM current_user_profile c "
        "JOIN user_profile_versions v ON v.id = c.version_id "
        "WHERE c.id = ?",
        (CURRENT_USER_PROFILE_ID,),
    ).fetchone()
    return _row_to_record(row)


def save_user_profile(conn: sqlite3.Connection, profile: dict[str, Any]) -> dict[str, Any]:
    payload = normalize_user_profile(profile)
    content_id = user_profile_content_id(payload)
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
    conn.execute(
        "INSERT INTO current_user_profile (id, version_id, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET version_id=excluded.version_id, updated_at=excluded.updated_at",
        (CURRENT_USER_PROFILE_ID, version_id, _now()),
    )
    conn.commit()
    return get_current_user_profile(conn)


def list_user_profile_versions(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM user_profile_versions ORDER BY created_at DESC, id DESC"
    ).fetchall()
    return [_row_to_record(row) for row in rows]
