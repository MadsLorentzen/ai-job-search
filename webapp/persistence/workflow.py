from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from webapp.persistence.workspaces import get_workspace

TRACKER_STATUSES = (
    "drafted", "applied", "interview", "offer",
    "hired", "rejected", "no_response", "offer_declined", "withdrawn",
)

FINAL_STATUSES = frozenset({"hired", "rejected", "no_response", "offer_declined", "withdrawn"})


def is_final(status: str) -> bool:
    return status in FINAL_STATUSES


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_status_change(
    conn: sqlite3.Connection, *, workspace_id: str, new_status: str, effective_date: str,
    note: str | None = None, submitted_pack_artifact_id: str | None = None,
    _allow_drafted: bool = False, commit: bool = True,
) -> dict[str, Any]:
    if new_status not in TRACKER_STATUSES:
        raise ValueError(f"unknown tracker status: {new_status!r}")
    if new_status == "drafted" and not _allow_drafted:
        raise ValueError(
            "drafted may only be set via the application-pack confirmation flow (Gate 4), "
            "not the general status endpoint"
        )

    workspace = get_workspace(conn, workspace_id)
    previous_status = workspace["workflow_status"] if workspace else None

    if new_status == "applied":
        if previous_status != "drafted":
            raise ValueError(
                "applied requires the workspace to currently be 'drafted' — an application "
                "cannot be marked applied without first completing Gate 4 (application-pack "
                "confirmation), which is the only path to 'drafted'"
            )
        if submitted_pack_artifact_id is None:
            raise ValueError(
                "applied requires submitted_pack_artifact_id: the event must identify exactly "
                "which reviewed application pack was submitted, since multiple Gate-4 "
                "confirmations may have occurred while the workspace was still 'drafted'"
            )

    event_id = f"evt_{uuid.uuid4().hex[:20]}"

    # Single transaction: event insert and workspace update commit together or
    # not at all, so the audit log and workflow_status can never disagree.
    try:
        conn.execute(
            "INSERT INTO workflow_events "
            "(id, workspace_id, previous_status, new_status, effective_date, note, submitted_pack_artifact_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (event_id, workspace_id, previous_status, new_status, effective_date, note,
             submitted_pack_artifact_id, _now()),
        )
        conn.execute(
            "UPDATE workspaces SET workflow_status = ?, updated_at = ? WHERE id = ?",
            (new_status, _now(), workspace_id),
        )
        if commit:
            conn.commit()
    except Exception:
        if commit:
            conn.rollback()
        raise

    return dict(conn.execute("SELECT * FROM workflow_events WHERE id = ?", (event_id,)).fetchone())


def list_workflow_events(conn: sqlite3.Connection, workspace_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM workflow_events WHERE workspace_id = ? ORDER BY created_at DESC", (workspace_id,)
    ).fetchall()
    return [dict(row) for row in rows]
