from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

ARTIFACT_TYPES = (
    "profile_snapshot",
    "job_posting_snapshot",
    "job_understanding_request",
    "job_understanding_result",
    "resolved_job_evidence",
    "job_fit_request",
    "job_fit_result",
    "application_intelligence_request",
    "application_intelligence_result",
    "application_pack",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_artifact(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["payload"] = json.loads(data.pop("payload_json"))
    return data


def save_artifact(
    conn: sqlite3.Connection, *, workspace_id: str, artifact_type: str,
    payload: dict[str, Any], content_id: str | None = None,
) -> dict[str, Any]:
    if artifact_type not in ARTIFACT_TYPES:
        raise ValueError(f"unknown artifact_type: {artifact_type!r}")
    artifact_id = f"art_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO artifacts (id, workspace_id, artifact_type, content_id, payload_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (artifact_id, workspace_id, artifact_type, content_id, json.dumps(payload), now),
    )
    conn.execute(
        "INSERT INTO current_artifacts (workspace_id, artifact_type, artifact_id) VALUES (?, ?, ?) "
        "ON CONFLICT(workspace_id, artifact_type) DO UPDATE SET artifact_id = excluded.artifact_id",
        (workspace_id, artifact_type, artifact_id),
    )
    conn.commit()
    return get_artifact(conn, artifact_id)


def get_artifact(conn: sqlite3.Connection, artifact_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()
    return _row_to_artifact(row) if row else None


def get_current_artifact(conn: sqlite3.Connection, workspace_id: str, artifact_type: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT a.* FROM current_artifacts c JOIN artifacts a ON a.id = c.artifact_id "
        "WHERE c.workspace_id = ? AND c.artifact_type = ?",
        (workspace_id, artifact_type),
    ).fetchone()
    return _row_to_artifact(row) if row else None


def list_artifact_history(conn: sqlite3.Connection, workspace_id: str, artifact_type: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM artifacts WHERE workspace_id = ? AND artifact_type = ? ORDER BY created_at DESC",
        (workspace_id, artifact_type),
    ).fetchall()
    return [_row_to_artifact(row) for row in rows]
