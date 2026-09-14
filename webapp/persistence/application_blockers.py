from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

STAGES = ("understanding", "fit", "application_intelligence", "content")
BLOCKER_STATUSES = ("open", "resolved", "superseded")
ANSWER_SCOPES = ("APPLICATION_ONLY", "SEARCH_WORKSPACE", "CANDIDATE_FACT")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_blocker(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["context"] = json.loads(data["context"])
    data["allowed_scopes"] = json.loads(data["allowed_scopes"])
    return data


def _row_to_resolution(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["answer_value"] = json.loads(data["answer_value"])
    return data


def save_application_blocker(
    conn: sqlite3.Connection,
    *,
    workspace_id: str,
    policy_decision_id: str,
    source_artifact_id: str,
    stage: str,
    blocker_type: str,
    subject_key: str,
    question: str,
    resume_stage: str,
    allowed_scopes: list[str],
    context: dict[str, Any] | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Create the (at most one) durable blocker for a governing REQUIRE_USER
    policy decision.

    Idempotent on policy_decision_id -- application_blockers.policy_decision_id
    is UNIQUE, so a retried call for the same policy decision (itself
    idempotent, since save_policy_decision always returns the same id for a
    retried applicability key) is a safe no-op that returns the
    already-persisted blocker rather than raising or duplicating a row.
    """

    if stage not in STAGES:
        raise ValueError(f"unknown stage: {stage!r}")
    if resume_stage not in STAGES:
        raise ValueError(f"unknown resume_stage: {resume_stage!r}")
    if not subject_key:
        raise ValueError("subject_key is required and must not be empty")
    if not blocker_type:
        raise ValueError("blocker_type is required and must not be empty")
    if not question:
        raise ValueError("question is required and must not be empty")
    invalid_scopes = set(allowed_scopes) - set(ANSWER_SCOPES)
    if not allowed_scopes or invalid_scopes:
        raise ValueError(f"allowed_scopes contains unknown values: {invalid_scopes or 'empty'}")

    blocker_id = f"block_{uuid.uuid4().hex[:20]}"
    conn.execute(
        "INSERT OR IGNORE INTO application_blockers "
        "(id, workspace_id, policy_decision_id, source_artifact_id, stage, "
        "blocker_type, subject_key, question, context, resume_stage, "
        "allowed_scopes, status, created_at, resolved_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)",
        (
            blocker_id, workspace_id, policy_decision_id, source_artifact_id, stage,
            blocker_type, subject_key, question, json.dumps(context or {}), resume_stage,
            json.dumps(allowed_scopes), _now(),
        ),
    )
    if commit:
        conn.commit()
    existing = conn.execute(
        "SELECT * FROM application_blockers WHERE policy_decision_id = ?",
        (policy_decision_id,),
    ).fetchone()
    return _row_to_blocker(existing)


def get_application_blocker(conn: sqlite3.Connection, blocker_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM application_blockers WHERE id = ?", (blocker_id,)
    ).fetchone()
    return _row_to_blocker(row) if row else None


def list_application_blockers(
    conn: sqlite3.Connection,
    workspace_id: str,
    *,
    status: str | None = None,
    source_artifact_id: str | None = None,
) -> list[dict[str, Any]]:
    query = "SELECT * FROM application_blockers WHERE workspace_id = ?"
    params: list[Any] = [workspace_id]
    if status is not None:
        query += " AND status = ?"
        params.append(status)
    if source_artifact_id is not None:
        query += " AND source_artifact_id = ?"
        params.append(source_artifact_id)
    query += " ORDER BY created_at"
    rows = conn.execute(query, params).fetchall()
    return [_row_to_blocker(row) for row in rows]


def resolve_application_blocker(
    conn: sqlite3.Connection,
    *,
    blocker_id: str,
    answer_value: Any,
    answer_scope: str,
    resolved_by: str,
    promoted_evidence_id: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Resolve exactly one blocker: create its immutable resolution and
    mark that blocker (and only that blocker) resolved.

    Never mutates the originating policy_decisions row, and never touches
    any other blocker -- each resolution is scoped to blocker_id alone via
    blocker_resolutions.blocker_id's UNIQUE constraint, so a blocker can be
    resolved at most once.
    """

    if answer_scope not in ANSWER_SCOPES:
        raise ValueError(f"unknown answer_scope: {answer_scope!r}")
    if not resolved_by:
        raise ValueError("resolved_by is required and must not be empty")

    blocker = get_application_blocker(conn, blocker_id)
    if blocker is None:
        raise ValueError(f"unknown blocker_id: {blocker_id!r}")
    if blocker["status"] != "open":
        raise ValueError(
            f"blocker {blocker_id!r} is not open (status={blocker['status']!r})"
        )
    if answer_scope not in blocker["allowed_scopes"]:
        raise ValueError(
            f"answer_scope {answer_scope!r} is not permitted for this blocker "
            f"(allowed: {blocker['allowed_scopes']!r})"
        )

    resolution_id = f"blockres_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO blocker_resolutions "
        "(id, blocker_id, workspace_id, policy_decision_id, answer_value, "
        "answer_scope, resolved_by, promoted_evidence_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            resolution_id, blocker_id, blocker["workspace_id"], blocker["policy_decision_id"],
            json.dumps(answer_value), answer_scope, resolved_by, promoted_evidence_id, now,
        ),
    )
    conn.execute(
        "UPDATE application_blockers SET status = 'resolved', resolved_at = ? WHERE id = ?",
        (now, blocker_id),
    )
    if commit:
        conn.commit()
    return get_blocker_resolution(conn, resolution_id)


def get_blocker_resolution(conn: sqlite3.Connection, resolution_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM blocker_resolutions WHERE id = ?", (resolution_id,)
    ).fetchone()
    return _row_to_resolution(row) if row else None


def list_blocker_resolutions(
    conn: sqlite3.Connection, workspace_id: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM blocker_resolutions WHERE workspace_id = ? ORDER BY created_at",
        (workspace_id,),
    ).fetchall()
    return [_row_to_resolution(row) for row in rows]
