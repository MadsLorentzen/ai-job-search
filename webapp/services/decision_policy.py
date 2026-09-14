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


def execute_job_fit_policy(
    conn: sqlite3.Connection, *, workspace_id: str, fit_artifact: dict[str, Any],
) -> list[dict[str, Any]]:
    """Classify every gate and dimension assessment on a just-persisted
    job_fit_result artifact and durably record each decision.

    Idempotent: calling this again for the same artifact (e.g. a retried
    request) writes no duplicate rows, because save_policy_decision's
    underlying INSERT OR IGNORE is keyed on the exact applicability tuple
    (workspace_id, stage, source_artifact_id, review_item_type,
    subject_key, policy_fingerprint) enforced by the database itself.
    """

    payload = fit_artifact["payload"]
    source_artifact_id = fit_artifact["id"]
    persisted: list[dict[str, Any]] = []

    for gate in payload.get("gate_assessments", []):
        decision = evaluate_gate_assessment(gate)
        persisted.append(
            _persist(
                conn, workspace_id=workspace_id, stage="fit",
                source_artifact_id=source_artifact_id, decision=decision, commit=False,
            )
        )

    for dimension in payload.get("dimension_assessments", []):
        decision = evaluate_dimension_assessment(
            dimension,
            relevant_job_ids=dimension.get("job_evidence_ids", []),
            matched_job_ids=dimension.get("matched_job_requirement_ids", []),
            supporting_profile_evidence_ids=dimension.get(
                "supporting_profile_evidence_ids", []
            ),
        )
        persisted.append(
            _persist(
                conn, workspace_id=workspace_id, stage="fit",
                source_artifact_id=source_artifact_id, decision=decision, commit=False,
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
