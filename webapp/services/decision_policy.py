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

import re
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
from product.semantic_subject_registry import SEMANTIC_SUBJECTS
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


# Reuse-scope classification is keyed on the SEMANTICS of the actual
# posting requirement text behind a gate blocker, never on blocker_type or
# subject_key alone -- "gate:eligibility" covers both "must have the
# right to work in the UK" (a stable candidate fact, safe to reuse) and
# "sign this employer's specific right-to-work attestation"
# (application-specific, never safe to reuse silently). Not a taxonomy
# engine: a small deterministic pattern match over requirement text
# resolved from job_evidence_ids. Anything not positively recognized as a
# stable fact requirement defaults to the restrictive APPLICATION_ONLY
# -only scope -- the safe direction to fail in, consistent with "explicit
# applicable requirement whose optionality cannot be established ->
# MATERIAL" from the Phase 2 materiality design.
#
# Keyword presence alone is not sufficient: "please disclose any prior
# visa violations for our compliance review" mentions "visa" but is an
# employer-specific attestation, not a statement that the candidate must
# hold a durable, reusable visa/sponsorship status. Before a stable-fact
# keyword is allowed to widen scope, the same text is checked against
# _ATTESTATION_ACTION_PATTERN -- action verbs (sign/disclose/complete/
# submit) paired with a one-off employer document (form/declaration/
# disclosure/pledge/attestation), or any mention of "violation(s)". A
# match there means the sentence is asking the candidate to perform an
# employer-specific action, not declaring a durable attribute, so that
# text is excluded from the stable-fact check regardless of which
# keywords it also contains.
_FULL_SCOPES = ("APPLICATION_ONLY", "SEARCH_WORKSPACE", "CANDIDATE_FACT")
_RESTRICTED_SCOPES = ("APPLICATION_ONLY",)

_ATTESTATION_ACTION_PATTERN = re.compile(
    r"\b(?:sign|disclose|complete|submit)\b.*\b(?:form|declaration|disclosure|pledge|attestation)\b"
    r"|\b(?:form|declaration|disclosure|pledge|attestation)\b.*\b(?:sign|disclose|complete|submit)\b"
    r"|\bviolations?\b",
    re.IGNORECASE,
)

_STABLE_FACT_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bright to work\b",
        r"\bcitizen(?:ship)?\b",
        r"\bsponsorship\b",
        r"\bvisa\b",
        r"\bwork permit\b",
        r"\bdriv(?:ing|er'?s) licen[sc]e\b",
        r"\bnotice period\b",
    )
)


def _blocker_question(decision: DecisionRecord) -> str:
    if decision.review_item_type == "gate_flag":
        gate_id = decision.subject_key.split(":", 1)[-1]
        return f"This posting has a {gate_id.replace('_', ' ')} requirement your evidence doesn't address. {decision.reason}"
    dimension_id = decision.subject_key.split(":", 1)[-1]
    return f"{dimension_id.replace('_', ' ')} needs your input before scoring can continue. {decision.reason}"


# gate_id -> resolved_job_evidence category, mirroring
# product/semantic_fit_policy.v0.json's gate_evidence_categories exactly
# (semantic_job_fit.py's _build_gate_assessments uses the same mapping).
_GATE_EVIDENCE_CATEGORIES = {
    "eligibility": "eligibility_requirements",
    "language": "language_requirements",
    "location_logistics": "logistics_requirements",
}


def _requirement_texts(
    conn: sqlite3.Connection, workspace_id: str, decision: DecisionRecord,
) -> list[str]:
    """The actual posting requirement text behind a gate_flag decision.

    Prefers the specific job_evidence_ids the gate proposal adjudicated
    (when one was submitted and matched the category). When no proposal
    was submitted at all -- the common MATERIAL+ABSENT case, e.g. no
    eligibility evidence supplied -- job_evidence_ids is empty even though
    the posting genuinely states a requirement in that category (that is
    exactly what materiality=MATERIAL already established). Falls back to
    every job-evidence item in the gate's own category in that case,
    rather than treating "no proposal" as "no text to classify"."""

    from webapp.persistence.artifacts import get_current_artifact

    bundle = get_current_artifact(conn, workspace_id, "resolved_job_evidence")
    if bundle is None:
        return []
    evidence_items = bundle["payload"].get("evidence", [])
    evidence_by_id = {item["id"]: item for item in evidence_items}

    if decision.job_evidence_ids:
        return [
            evidence_by_id[evidence_id]["text"]
            for evidence_id in decision.job_evidence_ids
            if evidence_id in evidence_by_id
        ]

    gate_id = decision.subject_key.split(":", 1)[-1]
    category = _GATE_EVIDENCE_CATEGORIES.get(gate_id)
    if category is None:
        return []
    return [item["text"] for item in evidence_items if item.get("category") == category]


def _is_stable_fact_requirement(texts: list[str]) -> bool:
    for text in texts:
        if _ATTESTATION_ACTION_PATTERN.search(text):
            continue
        if any(pattern.search(text) for pattern in _STABLE_FACT_PATTERNS):
            return True
    return False


# Each family maps to exactly one product/semantic_subject_registry.py
# key. This mapping lives here, in the classifier, deliberately separate
# from the registry itself (spec §3): changing or adding a pattern here
# never redefines what a registry key means, and the registry's four
# initial keys are the authority on which values classify_semantic_subject
# may ever return.
_SEMANTIC_SUBJECT_PATTERNS: tuple[tuple[re.Pattern, str], ...] = (
    (re.compile(r"\bright to work\b", re.IGNORECASE), "work_authorization.right_to_work"),
    (re.compile(r"\bcitizen(?:ship)?\b", re.IGNORECASE), "work_authorization.right_to_work"),
    (re.compile(r"\bsponsorship\b", re.IGNORECASE), "work_authorization.sponsorship_required"),
    (re.compile(r"\bvisa\b", re.IGNORECASE), "work_authorization.sponsorship_required"),
    (re.compile(r"\bwork permit\b", re.IGNORECASE), "work_authorization.sponsorship_required"),
    (re.compile(r"\bdriv(?:ing|er'?s) licen[sc]e\b", re.IGNORECASE), "licence.driving"),
    (re.compile(r"\bnotice period\b", re.IGNORECASE), "employment.notice_period"),
)


def classify_semantic_subject(blocker_type: str, requirement_texts: list[str]) -> str | None:
    """Map gate requirement text to a product/semantic_subject_registry.py
    key, or None (Phase 4C spec §3). Dimension blockers never classify
    (rule 1). Attestation-action text is excluded before matching (rule
    4, mirrors _is_stable_fact_requirement's own exclusion). Text matching
    more than one registry family classifies to None (rule 3) -- Phase 4C
    has no per-fact decomposition of a single gate's evidence.
    """

    if blocker_type != "gate_flag":
        return None

    matched_keys: set[str] = set()
    for text in requirement_texts:
        if _ATTESTATION_ACTION_PATTERN.search(text):
            continue
        for pattern, registry_key in _SEMANTIC_SUBJECT_PATTERNS:
            if pattern.search(text):
                matched_keys.add(registry_key)

    if len(matched_keys) != 1:
        return None
    (key,) = matched_keys
    assert key in SEMANTIC_SUBJECTS  # registry is the authority; classifier must never invent a key
    return key


def _blocker_allowed_scopes(
    conn: sqlite3.Connection, workspace_id: str, decision: DecisionRecord,
) -> list[str]:
    if decision.review_item_type != "gate_flag":
        # Dimension (skill/experience coverage) blockers are not
        # legal/eligibility-adjacent by construction -- full scope set.
        return list(_FULL_SCOPES)
    texts = _requirement_texts(conn, workspace_id, decision)
    if _is_stable_fact_requirement(texts):
        return list(_FULL_SCOPES)
    return list(_RESTRICTED_SCOPES)


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
    requirement_texts = _requirement_texts(conn, workspace_id, decision)
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
        allowed_scopes=_blocker_allowed_scopes(conn, workspace_id, decision),
        semantic_subject_key=classify_semantic_subject(decision.review_item_type, requirement_texts),
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

    Also supersedes, at this mutation boundary, any OPEN blocker left over
    from a prior fit-stage artifact for this workspace -- a stale blocker
    must never remain physically 'open' forever just because it is
    excluded from governing queries by artifact comparison alone (see
    webapp.persistence.application_blockers.supersede_open_blockers). An
    already-resolved prior blocker is left untouched: its answer remains
    valid audit history and it was never claiming to still be open.
    """

    from webapp.persistence.application_blockers import supersede_open_blockers

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

    supersede_open_blockers(
        conn, workspace_id=workspace_id, stage="fit",
        current_source_artifact_id=source_artifact_id, commit=False,
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


def find_semantic_subject_match(
    conn: sqlite3.Connection, *, workspace_id: str, semantic_subject_key: str | None,
) -> dict[str, Any] | None:
    """The ONLY cross-application answer lookup Phase 4C performs: a
    SEARCH_WORKSPACE-scoped resolution from a sibling workspace sharing
    workspace_id's real search workspace, keyed on semantic_subject_key
    equality, never subject_key string equality (Phase 4C spec §5) --
    subject_key is artifact-instance-scoped and essentially never matches
    verbatim across two different applications' own Job Fit artifacts.

    Deliberately does NOT look up CANDIDATE_FACT-scoped resolutions
    across workspaces (spec §5 point 3, §17's amended Candidate Fact
    boundary): doing so would rebuild the shadow candidate-evidence
    store the design explicitly rules out. A CANDIDATE_FACT-scoped
    answer is visible only within its own originating workspace, via
    Task 6's tier-1 lookup in build_resolved_blocker_answers_payload --
    never via this function.
    """

    if semantic_subject_key is None:
        return None

    from webapp.persistence.application_identity import get_search_workspace_for_application

    search_workspace_id = get_search_workspace_for_application(conn, workspace_id)
    if search_workspace_id is None:
        return None

    rows = conn.execute(
        "SELECT r.* FROM blocker_resolutions r "
        "JOIN application_blockers b ON b.id = r.blocker_id "
        "JOIN application_workspace_origins o ON o.application_workspace_id = r.workspace_id "
        "WHERE o.search_workspace_id = ? AND b.semantic_subject_key = ? "
        "AND r.answer_scope = 'SEARCH_WORKSPACE' "
        "ORDER BY r.created_at DESC LIMIT 1",
        (search_workspace_id, semantic_subject_key),
    ).fetchall()
    if rows:
        return _row_to_resolution_with_scope_source(rows[0], "SEARCH_WORKSPACE")

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
    request_id: str,
    answer_value: Any,
    answer_scope: str,
    resolved_by: str,
) -> dict[str, Any]:
    """Service entry point for answering (or correcting an answer to) one
    blocker: validates the requested scope is both valid for this
    workspace (validate_answer_scope) and permitted by the blocker's own
    allowed_scopes (enforced inside resolve_application_blocker), then
    creates the durable resolution.

    request_id is the idempotency key: a retried call with the same
    request_id is a no-op; a genuinely new correction requires a new
    request_id. Resolving/correcting one blocker never touches any other
    blocker or the originating policy decision -- see
    webapp.persistence.application_blockers.resolve_application_blocker.
    """

    from webapp.persistence.application_blockers import resolve_application_blocker

    validate_answer_scope(conn, workspace_id=workspace_id, answer_scope=answer_scope)
    return resolve_application_blocker(
        conn,
        blocker_id=blocker_id,
        request_id=request_id,
        answer_value=answer_value,
        answer_scope=answer_scope,
        resolved_by=resolved_by,
    )
