"""Sanitized provider-call audit storage, separate from domain artifacts."""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any


def save_provider_audit(
    conn: sqlite3.Connection, *, workspace_id: str, stage: str,
    metadata: dict[str, Any], request_artifact_id: str | None = None,
) -> dict[str, Any]:
    audit_id = f"audit_{uuid.uuid4().hex[:20]}"
    created_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO provider_audits "
        "(id, workspace_id, stage, request_artifact_id, metadata_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (audit_id, workspace_id, stage, request_artifact_id,
         json.dumps(metadata, sort_keys=True, separators=(",", ":")), created_at),
    )
    conn.commit()
    row = dict(conn.execute("SELECT * FROM provider_audits WHERE id = ?", (audit_id,)).fetchone())
    row["metadata"] = json.loads(row.pop("metadata_json"))
    return row


def list_provider_audits(
    conn: sqlite3.Connection, workspace_id: str, stage: str | None = None,
) -> list[dict[str, Any]]:
    if stage is None:
        rows = conn.execute(
            "SELECT * FROM provider_audits WHERE workspace_id = ? ORDER BY created_at DESC",
            (workspace_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM provider_audits WHERE workspace_id = ? AND stage = ? ORDER BY created_at DESC",
            (workspace_id, stage),
        ).fetchall()
    result = []
    for raw in rows:
        row = dict(raw)
        row["metadata"] = json.loads(row.pop("metadata_json"))
        result.append(row)
    return result
