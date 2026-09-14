"""Mutation-boundary orchestration for the Application Decision Policy.

Called only from stage mutation functions in webapp/services/http_api.py,
immediately after a new Understanding/Job Fit/Application Intelligence
artifact becomes current -- never from a GET path, never from
workspace_view.py. This module's only job is: read the artifact payload,
call the pure classifier in product/application_decision_policy.py for
each review item it currently knows how to classify, and persist the
result via webapp/persistence/policy_decisions.py. It does not reimplement
any classification rule itself.

Phase 4A scope: only Job Fit's gate_assessments and dimension_assessments
are classified, because those are the only two classifiers Phase 1/2 built
and tested (evaluate_gate_assessment, evaluate_dimension_assessment).
Understanding suggestions/ambiguous statements and Application
Intelligence content units have no tested classifier yet (deferred to a
later phase per the design) -- calling execute_stage_policy for those
stages today persists zero decisions, which is honest: there is nothing
yet to classify, not a silent placeholder pretending otherwise.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from product.application_decision_policy import (
    DEFAULT_POLICY,
    ENGINE_VERSION,
    DecisionRecord,
    application_decision_policy_fingerprint,
    evaluate_dimension_assessment,
    evaluate_gate_assessment,
)
from webapp.persistence.application_blockers import save_application_blocker
from webapp.persistence.policy_decisions import save_policy_decision

# Outcomes that stop this workspace from progressing automatically.
# AUTO_REJECT -> DECLINED_BY_POLICY (policy declined the application).
# REQUIRE_USER -> BLOCKED_FOR_USER (a human question, not a failure).
# Both are recorded blocking=True in the ledger: "this decision was
# capable of stopping automatic progression," regardless of which of the
# two distinct derived states it produces. Deriving DECLINED_BY_POLICY /
# BLOCKED_FOR_USER themselves from these rows is Phase 4A read logic (see
# derive_workspace_policy_state below), not something this module decides
# by writing a workflow_status -- workflow_status keeps its existing,
# narrower, post-submission-outcome meaning untouched.
_BLOCKING_OUTCOMES = frozenset({"REQUIRE_USER", "AUTO_REJECT"})

_POLICY_VERSION = DEFAULT_POLICY["schema_version"]
_POLICY_FINGERPRINT = application_decision_policy_fingerprint(
    DEFAULT_POLICY, engine_version=ENGINE_VERSION
)


def _persist(
    conn: sqlite3.Connection,
    *,
    workspace_id: str,
    stage: str,
    source_artifact_id: str,
    decision: DecisionRecord,
    commit: bool,
) -> dict[str, Any]:
    evidence_ids = list(decision.job_evidence_ids) + list(decision.profile_evidence_ids)
    return save_policy_decision(
        conn,
        workspace_id=workspace_id,
        stage=stage,
        source_artifact_id=source_artifact_id,
        review_item_type=decision.review_item_type,
        subject_key=decision.subject_key,
        domain_item_id=decision.subject_key,
        outcome=decision.outcome,
        policy_version=_POLICY_VERSION,
        policy_fingerprint=_POLICY_FINGERPRINT,
        evidence_ids=evidence_ids,
        supported_facts=[],
        recorded_gaps=list(decision.unmatched_job_requirement_ids),
        reason_code=decision.reason_code,
        reason=decision.reason,
        confidence=None,
        blocking=decision.outcome in _BLOCKING_OUTCOMES,
        commit=commit,
    )


# Restricted to APPLICATION_ONLY: sensitive, legal, or eligibility-adjacent
# subject keys where an answer for one application must never silently
# apply to another job or be promoted to a reusable candidate fact without
# a deliberate later workflow. Everything else defaults to the full scope
# set (APPLICATION_ONLY, SEARCH_WORKSPACE, CANDIDATE_FACT) -- a stable
# factual/preference gap the candidate can reasonably answer once and
# reuse. Not exhaustive by design (see this module's docstring on not
# hard-coding every future question type); extend as new blocker_type/
# subject_key combinations are introduced.
_APPLICATION_ONLY_SUBJECT_KEYS = frozenset({"gate:eligibility"})
_FULL_SCOPES = ("APPLICATION_ONLY", "SEARCH_WORKSPACE", "CANDIDATE_FACT")
_RESTRICTED_SCOPES = ("APPLICATION_ONLY",)


def _blocker_question(decision: DecisionRecord) -> str:
    if decision.review_item_type == "gate_flag":
        gate_id = decision.subject_key.split(":", 1)[-1]
        return f"This posting has a {gate_id.replace('_', ' ')} requirement your evidence doesn't address. {decision.reason}"
    dimension_id = decision.subject_key.split(":", 1)[-1]
    return f"{dimension_id.replace('_', ' ')} needs your input before scoring can continue. {decision.reason}"


def _blocker_allowed_scopes(decision: DecisionRecord) -> list[str]:
    return list(
        _RESTRICTED_SCOPES
        if decision.subject_key in _APPLICATION_ONLY_SUBJECT_KEYS
        else _FULL_SCOPES
    )


def _maybe_create_blocker(
    conn: sqlite3.Connection,
    *,
    workspace_id: str,
    stage: str,
    source_artifact_id: str,
    policy_decision: dict[str, Any],
    decision: DecisionRecord,
    commit: bool,
) -> dict[str, Any] | None:
    """A blocker is created only for REQUIRE_USER -- never for
    AUTO_PROCEED, AUTO_OMIT, NOT_APPLICABLE, AUTO_PROCEED_WITH_GAPS, or
    AUTO_REJECT (a hard decline has no question to ask; it derives
    DECLINED_BY_POLICY directly from the policy decision, no blocker
    involved)."""

    if decision.outcome != "REQUIRE_USER":
        return None
    return save_application_blocker(
        conn,
        workspace_id=workspace_id,
        policy_decision_id=policy_decision["id"],
        source_artifact_id=source_artifact_id,
        stage=stage,
        blocker_type=decision.review_item_type,
        subject_key=decision.subject_key,
        question=_blocker_question(decision),
        resume_stage=stage,
        allowed_scopes=_blocker_allowed_scopes(decision),
        context={
            "reason_code": decision.reason_code,
            "reason": decision.reason,
            "job_evidence_ids": list(decision.job_evidence_ids),
            "profile_evidence_ids": list(decision.profile_evidence_ids),
        },
        commit=commit,
    )


def execute_job_fit_policy(
    conn: sqlite3.Connection, *, workspace_id: str, fit_artifact: dict[str, Any],
) -> list[dict[str, Any]]:
    """Classify every gate and dimension assessment on a just-persisted
    job_fit_result artifact, durably record each decision, and create the
    corresponding blocker for any REQUIRE_USER outcome.

    Idempotent: calling this again for the same artifact (e.g. a retried
    request) writes no duplicate policy_decisions or application_blockers
    rows -- both are keyed so a retry is a safe no-op enforced by the
    database itself (policy_decisions on its applicability tuple,
    application_blockers on policy_decision_id).
    """

    payload = fit_artifact["payload"]
    source_artifact_id = fit_artifact["id"]
    persisted: list[dict[str, Any]] = []

    def handle(decision: DecisionRecord) -> None:
        saved = _persist(
            conn, workspace_id=workspace_id, stage="fit",
            source_artifact_id=source_artifact_id, decision=decision, commit=False,
        )
        persisted.append(saved)
        _maybe_create_blocker(
            conn, workspace_id=workspace_id, stage="fit",
            source_artifact_id=source_artifact_id, policy_decision=saved,
            decision=decision, commit=False,
        )

    for gate in payload.get("gate_assessments", []):
        handle(evaluate_gate_assessment(gate))

    for dimension in payload.get("dimension_assessments", []):
        handle(
            evaluate_dimension_assessment(
                dimension,
                relevant_job_ids=dimension.get("job_evidence_ids", []),
                matched_job_ids=dimension.get("matched_job_requirement_ids", []),
                supporting_profile_evidence_ids=dimension.get(
                    "supporting_profile_evidence_ids", []
                ),
            )
        )

    conn.commit()
    return persisted


def execute_understanding_policy(
    conn: sqlite3.Connection, *, workspace_id: str, understanding_artifact: dict[str, Any],
) -> list[dict[str, Any]]:
    """No classifier exists yet for job_understanding_result's suggestions/
    ambiguous_statements/warnings (see this module's docstring). Present
    as a real, callable mutation-boundary hook so the wiring pattern is
    consistent across all three stages, but it persists zero decisions
    today -- there is nothing here to classify yet, honestly."""

    return []


def execute_application_intelligence_policy(
    conn: sqlite3.Connection, *, workspace_id: str, intelligence_artifact: dict[str, Any],
) -> list[dict[str, Any]]:
    """No classifier exists yet for application_intelligence_result's
    content units (cv_content/cover_letter_content) -- content-unit
    AUTO_REVISE is deferred to a later phase per the design. Present as a
    real, callable mutation-boundary hook; persists zero decisions today."""

    return []


def current_policy_decisions(
    conn: sqlite3.Connection, workspace_id: str, source_artifact_id: str,
) -> list[dict[str, Any]]:
    """The decisions that govern this workspace right now: every
    policy_decisions row tied to this exact (current) source artifact.
    Decisions tied to a prior, superseded artifact are never returned here
    -- they remain permanently queryable via
    webapp.persistence.policy_decisions.list_policy_decisions for audit
    history, but this function is what "governs" means in Phase 4A."""

    from webapp.persistence.policy_decisions import list_policy_decisions

    return list_policy_decisions(conn, workspace_id, source_artifact_id=source_artifact_id)


def derive_workspace_policy_state(decisions: list[dict[str, Any]]) -> str:
    """Derived, read-only state from a set of governing policy decisions.
    Never written to workflow_status -- that column keeps its existing,
    narrower, post-submission-outcome meaning (e.g. "rejected" means an
    employer's real-world rejection, never a policy decision not to
    pursue a vacancy).

    PROCEEDING        -- no blocking decision among the given set.
    BLOCKED_FOR_USER   -- at least one REQUIRE_USER, and no AUTO_REJECT.
    DECLINED_BY_POLICY  -- at least one AUTO_REJECT (checked first: a hard,
                           supported disqualification is definitive even if
                           an unrelated REQUIRE_USER is also present).
    """

    if any(d["outcome"] == "AUTO_REJECT" for d in decisions):
        return "DECLINED_BY_POLICY"
    if any(d["outcome"] == "REQUIRE_USER" for d in decisions):
        return "BLOCKED_FOR_USER"
    return "PROCEEDING"


def current_application_blockers(
    conn: sqlite3.Connection, workspace_id: str, source_artifact_id: str,
) -> list[dict[str, Any]]:
    """Blockers that govern this workspace right now: every
    application_blockers row tied to this exact (current) source artifact,
    regardless of status. A blocker tied to a prior, no-longer-current
    artifact is never returned here -- it remains permanently queryable via
    webapp.persistence.application_blockers.list_application_blockers for
    audit history, but "governs" means "tied to the current artifact",
    exactly mirroring current_policy_decisions above. Re-running an
    upstream stage never deletes or actively marks the old row
    superseded; it simply stops being returned by this function once a
    newer artifact is current."""

    from webapp.persistence.application_blockers import list_application_blockers

    all_for_workspace = list_application_blockers(conn, workspace_id)
    return [b for b in all_for_workspace if b["source_artifact_id"] == source_artifact_id]


def has_unresolved_governing_blockers(
    conn: sqlite3.Connection, workspace_id: str, source_artifact_id: str,
) -> bool:
    """Answers exactly: are there any current unresolved governing
    blockers? Phase 4B exposes only this question -- actual downstream
    resume/re-evaluation when the answer flips to False is later work."""

    return any(
        blocker["status"] == "open"
        for blocker in current_application_blockers(conn, workspace_id, source_artifact_id)
    )


def validate_answer_scope(
    conn: sqlite3.Connection, *, workspace_id: str, answer_scope: str,
) -> None:
    """Raises ValueError if answer_scope is not valid for this workspace.

    APPLICATION_ONLY  -- always valid.
    SEARCH_WORKSPACE  -- valid only when this application actually belongs
                         to a search workspace (a real
                         application_workspace_origins row). A manually
                         created application (e.g. via the Add Job form,
                         with no discovery origin) never fabricates one to
                         support this scope -- it is simply rejected.
    CANDIDATE_FACT     -- always valid to record as an explicit user
                         choice; Phase 4B never mutates the Evidence
                         Profile on this scope alone (see
                         webapp.persistence.application_blockers.
                         resolve_application_blocker's promoted_evidence_id,
                         which stays NULL unless a later, explicit
                         promotion workflow sets it).
    """

    if answer_scope == "APPLICATION_ONLY":
        return
    if answer_scope == "CANDIDATE_FACT":
        return
    if answer_scope == "SEARCH_WORKSPACE":
        from webapp.persistence.application_identity import (
            get_search_workspace_for_application,
        )

        if get_search_workspace_for_application(conn, workspace_id) is None:
            raise ValueError(
                f"workspace {workspace_id!r} has no search-workspace origin; "
                "SEARCH_WORKSPACE scope is not valid for a manually-created application"
            )
        return
    raise ValueError(f"unknown answer_scope: {answer_scope!r}")


def find_reusable_answer(
    conn: sqlite3.Connection,
    *,
    workspace_id: str,
    subject_key: str,
    blocker_type: str,
) -> dict[str, Any] | None:
    """Design-only in Phase 4B: answers this question, "do we already have
    an approved answer for this question at an applicable scope?", with
    precedence application-specific -> applicable search-workspace ->
    approved candidate fact. Returns the resolution dict (or None), but
    Phase 4B deliberately never calls this automatically from any mutation
    path -- nothing currently applies a found answer without the user
    re-confirming it on the new application. Wiring that in is later work.
    """

    from webapp.persistence.application_identity import get_search_workspace_for_application

    # APPLICATION_ONLY precedence: an answer already recorded on this
    # exact workspace for this exact question.
    rows = conn.execute(
        "SELECT r.* FROM blocker_resolutions r "
        "JOIN application_blockers b ON b.id = r.blocker_id "
        "WHERE r.workspace_id = ? AND b.subject_key = ? AND b.blocker_type = ? "
        "AND r.answer_scope = 'APPLICATION_ONLY' "
        "ORDER BY r.created_at DESC LIMIT 1",
        (workspace_id, subject_key, blocker_type),
    ).fetchall()
    if rows:
        return _row_to_resolution_with_scope_source(rows[0], "APPLICATION_ONLY")

    # SEARCH_WORKSPACE precedence: an answer recorded under any workspace
    # sharing this application's search-workspace origin, if one exists.
    search_workspace_id = get_search_workspace_for_application(conn, workspace_id)
    if search_workspace_id is not None:
        rows = conn.execute(
            "SELECT r.* FROM blocker_resolutions r "
            "JOIN application_blockers b ON b.id = r.blocker_id "
            "JOIN application_workspace_origins o ON o.application_workspace_id = r.workspace_id "
            "WHERE o.search_workspace_id = ? AND b.subject_key = ? AND b.blocker_type = ? "
            "AND r.answer_scope = 'SEARCH_WORKSPACE' "
            "ORDER BY r.created_at DESC LIMIT 1",
            (search_workspace_id, subject_key, blocker_type),
        ).fetchall()
        if rows:
            return _row_to_resolution_with_scope_source(rows[0], "SEARCH_WORKSPACE")

    # CANDIDATE_FACT precedence: an approved, promoted candidate fact
    # answer to this same question from any workspace.
    rows = conn.execute(
        "SELECT r.* FROM blocker_resolutions r "
        "JOIN application_blockers b ON b.id = r.blocker_id "
        "WHERE b.subject_key = ? AND b.blocker_type = ? AND r.answer_scope = 'CANDIDATE_FACT' "
        "ORDER BY r.created_at DESC LIMIT 1",
        (subject_key, blocker_type),
    ).fetchall()
    if rows:
        return _row_to_resolution_with_scope_source(rows[0], "CANDIDATE_FACT")

    return None


def _row_to_resolution_with_scope_source(row: sqlite3.Row, scope_source: str) -> dict[str, Any]:
    from webapp.persistence.application_blockers import _row_to_resolution

    resolution = _row_to_resolution(row)
    resolution["matched_scope_source"] = scope_source
    return resolution


def resolve_blocker(
    conn: sqlite3.Connection,
    *,
    workspace_id: str,
    blocker_id: str,
    answer_value: Any,
    answer_scope: str,
    resolved_by: str,
) -> dict[str, Any]:
    """Service entry point for resolving one blocker: validates the
    requested scope is both valid for this workspace (validate_answer_scope)
    and permitted by the blocker's own allowed_scopes (enforced inside
    resolve_application_blocker), then creates the durable resolution.

    Resolving one blocker never resolves, mutates, or otherwise touches
    any other blocker or the originating policy decision -- see
    webapp.persistence.application_blockers.resolve_application_blocker.
    """

    from webapp.persistence.application_blockers import resolve_application_blocker

    validate_answer_scope(conn, workspace_id=workspace_id, answer_scope=answer_scope)
    return resolve_application_blocker(
        conn,
        blocker_id=blocker_id,
        answer_value=answer_value,
        answer_scope=answer_scope,
        resolved_by=resolved_by,
    )
