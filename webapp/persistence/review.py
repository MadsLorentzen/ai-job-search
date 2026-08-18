from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

DISPOSITIONS = (
    "acknowledged_and_proceed",
    "omit_from_positioning",
    "requires_upstream_change",
    "resolved_by_rerun",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_review_decision(
    conn: sqlite3.Connection, *, workspace_id: str, review_item_type: str, source_artifact_id: str,
    domain_item_id: str | None, disposition: str, note: str | None = None,
) -> dict[str, Any]:
    if disposition not in DISPOSITIONS:
        raise ValueError(f"unknown disposition: {disposition!r}")
    decision_id = f"rev_{uuid.uuid4().hex[:20]}"
    conn.execute(
        "INSERT INTO review_decisions "
        "(id, workspace_id, review_item_type, source_artifact_id, domain_item_id, disposition, note, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (decision_id, workspace_id, review_item_type, source_artifact_id, domain_item_id, disposition, note, _now()),
    )
    conn.commit()
    return dict(conn.execute("SELECT * FROM review_decisions WHERE id = ?", (decision_id,)).fetchone())


def list_review_decisions(
    conn: sqlite3.Connection, workspace_id: str, source_artifact_id: str | None = None
) -> list[dict[str, Any]]:
    if source_artifact_id is None:
        rows = conn.execute(
            "SELECT * FROM review_decisions WHERE workspace_id = ? ORDER BY created_at DESC", (workspace_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM review_decisions WHERE workspace_id = ? AND source_artifact_id = ? ORDER BY created_at DESC",
            (workspace_id, source_artifact_id),
        ).fetchall()
    return [dict(row) for row in rows]
