from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from product.application_material_contract import COMPLETION_CONTRACT_VERSION
from webapp.application_material import application_material_completion
from webapp.persistence.artifacts import get_artifact
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

    if new_status == "drafted":
        if submitted_pack_artifact_id is None:
            raise ValueError("drafted requires a reviewed application pack binding")
        pack = get_artifact(conn, submitted_pack_artifact_id)
        completion = (
            application_material_completion(pack["payload"])
            if pack is not None
            and pack["workspace_id"] == workspace_id
            and pack["artifact_type"] == "application_pack"
            else None
        )
        contract_is_current = (
            pack is not None
            and pack["payload"].get("completion_contract_version")
            == COMPLETION_CONTRACT_VERSION
        )
        if (
            pack is None
            or pack["workspace_id"] != workspace_id
            or pack["artifact_type"] != "application_pack"
            or not contract_is_current
            or completion["status"] != "READY"
        ):
            raise ValueError(
                "drafted requires an application pack validated under the current "
                "substantive-completion contract with reviewed usable application material"
                + (f": {', '.join(completion['issues'])}" if completion else "")
            )

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
        pack = get_artifact(conn, submitted_pack_artifact_id)
        completion = (
            application_material_completion(pack["payload"])
            if pack is not None
            and pack["workspace_id"] == workspace_id
            and pack["artifact_type"] == "application_pack"
            else None
        )
        contract_is_current = (
            pack is not None
            and pack["payload"].get("completion_contract_version")
            == COMPLETION_CONTRACT_VERSION
        )
        if (
            pack is None
            or pack["workspace_id"] != workspace_id
            or pack["artifact_type"] != "application_pack"
            or not contract_is_current
            or completion["status"] != "READY"
        ):
            raise ValueError(
                "applied is blocked because the bound application pack has no reviewed "
                "usable application material validated under the current "
                "substantive-completion contract"
                + (f": {', '.join(completion['issues'])}" if completion else "")
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
