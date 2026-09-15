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
    semantic_subject_key: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Create the (at most one) durable blocker for a governing REQUIRE_USER
    policy decision.

    Idempotent on policy_decision_id -- application_blockers.policy_decision_id
    is UNIQUE, so a retried call for the same policy decision (itself
    idempotent, since save_policy_decision always returns the same id for a
    retried applicability key) is a safe no-op that returns the
    already-persisted blocker rather than raising or duplicating a row.

    semantic_subject_key (Phase 4C spec §3) is a nullable classification
    drawn only from product/semantic_subject_registry.py's closed
    vocabulary -- validated here the same way ANSWER_SCOPES/
    BLOCKER_STATUSES are already enforced as closed sets, so an unknown
    value is a programming error, never silently accepted as a new
    subject.
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
    if semantic_subject_key is not None:
        from product.semantic_subject_registry import is_valid_semantic_subject

        if not is_valid_semantic_subject(semantic_subject_key):
            raise ValueError(f"unknown semantic_subject_key: {semantic_subject_key!r}")

    blocker_id = f"block_{uuid.uuid4().hex[:20]}"
    conn.execute(
        "INSERT OR IGNORE INTO application_blockers "
        "(id, workspace_id, policy_decision_id, source_artifact_id, stage, "
        "blocker_type, subject_key, question, context, resume_stage, "
        "allowed_scopes, status, created_at, resolved_at, semantic_subject_key) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?)",
        (
            blocker_id, workspace_id, policy_decision_id, source_artifact_id, stage,
            blocker_type, subject_key, question, json.dumps(context or {}), resume_stage,
            json.dumps(allowed_scopes), _now(), semantic_subject_key,
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
    request_id: str,
    answer_value: Any,
    answer_scope: str,
    resolved_by: str,
    promoted_evidence_id: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Answer (or correct a prior answer to) one blocker.

    Append-only history, one effective answer: every call creates a new
    immutable blocker_resolutions row (never updates or deletes a prior
    one), and the EFFECTIVE resolution for a blocker is simply the most
    recently created row for that blocker_id (see
    get_effective_resolution) -- there is no separate "is_current" flag to
    keep in sync.

    Idempotent on (blocker_id, request_id): a retried call with the same
    request_id is a safe no-op that returns the already-persisted
    resolution rather than creating a second row for what was actually
    one logical answer. A genuinely new correction must supply a new
    request_id -- that is what actually creates a new history row and
    changes the effective answer.

    Allowed while the blocker is 'open' (the first answer) or already
    'resolved' (a correction) -- never while 'superseded', since a
    superseded blocker no longer governs and accepting a new answer for
    it would be meaningless. Never mutates the originating
    policy_decisions row, and never touches any other blocker.
    """

    if answer_scope not in ANSWER_SCOPES:
        raise ValueError(f"unknown answer_scope: {answer_scope!r}")
    if not resolved_by:
        raise ValueError("resolved_by is required and must not be empty")
    if not request_id:
        raise ValueError("request_id is required and must not be empty")

    blocker = get_application_blocker(conn, blocker_id)
    if blocker is None:
        raise ValueError(f"unknown blocker_id: {blocker_id!r}")
    if blocker["status"] not in ("open", "resolved"):
        raise ValueError(
            f"blocker {blocker_id!r} cannot accept an answer (status={blocker['status']!r})"
        )
    if answer_scope not in blocker["allowed_scopes"]:
        raise ValueError(
            f"answer_scope {answer_scope!r} is not permitted for this blocker "
            f"(allowed: {blocker['allowed_scopes']!r})"
        )

    resolution_id = f"blockres_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT OR IGNORE INTO blocker_resolutions "
        "(id, blocker_id, request_id, workspace_id, policy_decision_id, answer_value, "
        "answer_scope, resolved_by, promoted_evidence_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            resolution_id, blocker_id, request_id, blocker["workspace_id"],
            blocker["policy_decision_id"], json.dumps(answer_value), answer_scope,
            resolved_by, promoted_evidence_id, now,
        ),
    )
    if blocker["status"] == "open":
        conn.execute(
            "UPDATE application_blockers SET status = 'resolved', resolved_at = ? WHERE id = ?",
            (now, blocker_id),
        )
    if commit:
        conn.commit()
    existing = conn.execute(
        "SELECT * FROM blocker_resolutions WHERE blocker_id = ? AND request_id = ?",
        (blocker_id, request_id),
    ).fetchone()
    return _row_to_resolution(existing)


def get_blocker_resolution(conn: sqlite3.Connection, resolution_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM blocker_resolutions WHERE id = ?", (resolution_id,)
    ).fetchone()
    return _row_to_resolution(row) if row else None


def get_effective_resolution(
    conn: sqlite3.Connection, blocker_id: str,
) -> dict[str, Any] | None:
    """The current answer for a blocker: the most recently created
    blocker_resolutions row for it, or None if never answered. Derived,
    not stored -- see resolve_application_blocker's docstring."""

    row = conn.execute(
        "SELECT * FROM blocker_resolutions WHERE blocker_id = ? "
        "ORDER BY created_at DESC, id DESC LIMIT 1",
        (blocker_id,),
    ).fetchone()
    return _row_to_resolution(row) if row else None


def list_blocker_resolution_history(
    conn: sqlite3.Connection, blocker_id: str,
) -> list[dict[str, Any]]:
    """Every answer ever given to this blocker, oldest first -- the full
    corrected-answer audit trail, distinct from get_effective_resolution's
    single current answer."""

    rows = conn.execute(
        "SELECT * FROM blocker_resolutions WHERE blocker_id = ? ORDER BY created_at",
        (blocker_id,),
    ).fetchall()
    return [_row_to_resolution(row) for row in rows]


def list_blocker_resolutions(
    conn: sqlite3.Connection, workspace_id: str,
) -> list[dict[str, Any]]:
    """Every resolution row (all history, all blockers) for a workspace.
    Use get_effective_resolution for "what is the current answer to this
    one blocker" -- this function intentionally returns every historical
    row, including superseded-by-correction ones."""

    rows = conn.execute(
        "SELECT * FROM blocker_resolutions WHERE workspace_id = ? ORDER BY created_at",
        (workspace_id,),
    ).fetchall()
    return [_row_to_resolution(row) for row in rows]


def supersede_open_blockers(
    conn: sqlite3.Connection,
    *,
    workspace_id: str,
    stage: str,
    current_source_artifact_id: str,
    commit: bool = True,
) -> list[dict[str, Any]]:
    """Mark every OPEN blocker for this workspace/stage that is not tied
    to current_source_artifact_id as 'superseded'.

    Called only from the mutation boundary immediately after a new stage
    artifact becomes current (never from workspace_view.py or a GET
    path) -- see webapp.services.decision_policy.execute_job_fit_policy.
    Only 'open' blockers are superseded; an already-'resolved' blocker
    from a prior artifact is left exactly as it is (its answer remains
    valid audit history, and it already correctly stopped governing via
    the source_artifact_id comparison other governing queries use).
    Superseding never touches blocker_resolutions, the originating
    policy_decisions row, or any blocker belonging to a different stage
    or workspace.
    """

    now = _now()
    candidates = conn.execute(
        "SELECT id FROM application_blockers WHERE workspace_id = ? AND stage = ? "
        "AND status = 'open' AND source_artifact_id != ?",
        (workspace_id, stage, current_source_artifact_id),
    ).fetchall()
    for row in candidates:
        conn.execute(
            "UPDATE application_blockers SET status = 'superseded', superseded_at = ? WHERE id = ?",
            (now, row["id"]),
        )
    if commit:
        conn.commit()
    return [get_application_blocker(conn, row["id"]) for row in candidates]
