from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from product.application_decision_policy import OUTCOMES

STAGES = ("understanding", "fit", "application_intelligence", "content")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_policy_decision(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["evidence_ids"] = json.loads(data["evidence_ids"])
    data["supported_facts"] = json.loads(data["supported_facts"])
    data["recorded_gaps"] = json.loads(data["recorded_gaps"])
    data["blocking"] = bool(data["blocking"])
    return data


def save_policy_decision(
    conn: sqlite3.Connection,
    *,
    workspace_id: str,
    stage: str,
    source_artifact_id: str,
    review_item_type: str,
    subject_key: str,
    outcome: str,
    policy_version: str,
    policy_fingerprint: str,
    reason_code: str,
    reason: str,
    blocking: bool,
    domain_item_id: str | None = None,
    evidence_ids: list[str] | None = None,
    supported_facts: list[str] | None = None,
    recorded_gaps: list[str] | None = None,
    confidence: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Insert one durable, append-only policy-decision record.

    Idempotent on the applicability key (workspace_id, stage,
    source_artifact_id, review_item_type, subject_key, policy_fingerprint):
    a second insert with the identical key is a safe no-op that returns the
    already-persisted record rather than raising or duplicating a row. The
    database's own UNIQUE constraint (see migration 010_policy_decisions)
    is the actual guarantee here -- this function's INSERT OR IGNORE is
    just the corresponding read-after-write convenience, not the source of
    the guarantee.

    subject_key must not be empty: for a stage-level decision with no
    natural per-item identity, callers must supply a stable explicit value
    (e.g. "stage") rather than an empty/placeholder string, matching the
    table's NOT NULL contract.
    """

    if stage not in STAGES:
        raise ValueError(f"unknown stage: {stage!r}")
    if outcome not in OUTCOMES:
        raise ValueError(f"unknown outcome: {outcome!r}")
    if not subject_key:
        raise ValueError("subject_key is required and must not be empty")
    if not review_item_type:
        raise ValueError("review_item_type is required and must not be empty")
    if not policy_version:
        raise ValueError("policy_version is required and must not be empty")
    if not policy_fingerprint:
        raise ValueError("policy_fingerprint is required and must not be empty")
    if not reason_code:
        raise ValueError("reason_code is required and must not be empty")
    if not reason:
        raise ValueError("reason is required and must not be empty")

    decision_id = f"pdec_{uuid.uuid4().hex[:20]}"
    conn.execute(
        "INSERT OR IGNORE INTO policy_decisions "
        "(id, workspace_id, stage, source_artifact_id, review_item_type, "
        "subject_key, domain_item_id, outcome, policy_version, policy_fingerprint, "
        "evidence_ids, supported_facts, recorded_gaps, reason_code, reason, "
        "confidence, blocking, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            decision_id, workspace_id, stage, source_artifact_id, review_item_type,
            subject_key, domain_item_id, outcome, policy_version, policy_fingerprint,
            json.dumps(evidence_ids or []), json.dumps(supported_facts or []),
            json.dumps(recorded_gaps or []), reason_code, reason,
            confidence, int(blocking), _now(),
        ),
    )
    if commit:
        conn.commit()
    existing = conn.execute(
        "SELECT * FROM policy_decisions WHERE "
        "workspace_id = ? AND stage = ? AND source_artifact_id = ? AND "
        "review_item_type = ? AND subject_key = ? AND policy_fingerprint = ?",
        (workspace_id, stage, source_artifact_id, review_item_type, subject_key, policy_fingerprint),
    ).fetchone()
    return _row_to_policy_decision(existing)


def get_policy_decision(conn: sqlite3.Connection, decision_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM policy_decisions WHERE id = ?", (decision_id,)
    ).fetchone()
    return _row_to_policy_decision(row) if row else None


def list_policy_decisions(
    conn: sqlite3.Connection,
    workspace_id: str,
    *,
    source_artifact_id: str | None = None,
    stage: str | None = None,
) -> list[dict[str, Any]]:
    query = "SELECT * FROM policy_decisions WHERE workspace_id = ?"
    params: list[Any] = [workspace_id]
    if source_artifact_id is not None:
        query += " AND source_artifact_id = ?"
        params.append(source_artifact_id)
    if stage is not None:
        query += " AND stage = ?"
        params.append(stage)
    query += " ORDER BY created_at"
    rows = conn.execute(query, params).fetchall()
    return [_row_to_policy_decision(row) for row in rows]
