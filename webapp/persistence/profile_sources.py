from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from product.profile_snapshot import SOURCE_PATHS


CANDIDATE_SOURCE = ".claude/skills/job-application-assistant/01-candidate-profile.md"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_profile_source_settings(conn: sqlite3.Connection) -> list[dict]:
    rows = {
        row["source_path"]: bool(row["included"])
        for row in conn.execute("SELECT source_path, included FROM profile_source_settings")
    }
    return [
        {
            "source_path": source_path,
            "included": True if source_path == CANDIDATE_SOURCE else rows.get(source_path, True),
            "editable": source_path == CANDIDATE_SOURCE,
            "required": source_path == CANDIDATE_SOURCE,
        }
        for source_path in SOURCE_PATHS
    ]


def included_profile_sources(conn: sqlite3.Connection) -> tuple[str, ...]:
    return tuple(
        source["source_path"]
        for source in list_profile_source_settings(conn)
        if source["included"]
    )


def set_supplemental_source_included(
    conn: sqlite3.Connection, source_path: str, included: bool
) -> None:
    if source_path not in SOURCE_PATHS:
        raise ValueError(f"unknown profile source {source_path!r}")
    if source_path == CANDIDATE_SOURCE:
        raise ValueError("the canonical candidate profile source cannot be disabled")
    conn.execute(
        "INSERT INTO profile_source_settings (source_path, included, updated_at) "
        "VALUES (?, ?, ?) ON CONFLICT(source_path) DO UPDATE SET "
        "included=excluded.included, updated_at=excluded.updated_at",
        (source_path, int(included), _now()),
    )
