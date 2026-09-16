"""Integration: the explicit cross_source_relation contract on a FAIL gate
proposal (Phase 4C ENGINE_VERSION v2 fix), via the public
analyze_semantic_job_fit entry point.

Background: semantic_job_fit.py's _build_gate_assessments originally set
evidence_disposition="CONFLICTING" on ANY supported FAIL proposal,
regardless of which evidence source(s) supported it. This collapsed two
semantically distinct cases into one value:

  - a FAIL supported by profile evidence alone, or resolved-answer
    evidence alone, or both sources agreeing -- an ordinary trustworthy
    rejection (should be SUPPORTIVE -> AUTO_REJECT);
  - a FAIL where supportive profile evidence and a validated resolved
    blocker answer genuinely disagree -- a data-quality contradiction in
    the candidate's own evidence that must never be silently
    auto-rejected (should be CONFLICTING -> REQUIRE_USER, Phase 4C spec
    Sec9's table).

Neither _build_gate_assessments nor application_decision_policy.py can
distinguish these from citation-list shape alone (dual citation presence
does not imply disagreement -- confirmed by tracing _supportive_profile_
claims and validate_resolved_answer_citation, neither of which perform
any content-level agreement comparison). The fix adds an explicit
cross_source_relation field the semantic adapter's OWN proposal supplies
(ALIGNED | CONFLICTING | NOT_APPLICABLE) -- the deterministic layer only
reads it, never infers it.

Required regression matrix (Phase 4C Task 13 closeout):
  1. resolved-answer-only FAIL -> SUPPORTIVE -> AUTO_REJECT
  2. profile-only FAIL -> SUPPORTIVE -> AUTO_REJECT
  3. dual-source, cross_source_relation=ALIGNED FAIL -> SUPPORTIVE -> AUTO_REJECT
  4. dual-source, cross_source_relation=CONFLICTING FAIL -> CONFLICTING -> REQUIRE_USER
  5. dual-source, cross_source_relation missing/invalid -> hard validation error (fail safely)
"""

from __future__ import annotations

import pytest

from product.semantic_job_fit import (
    SemanticJobFitValidationError,
    analyze_semantic_job_fit,
    build_resolved_job_evidence_bundle,
    build_semantic_job_fit_request,
)
from tests.test_job_fit import job_snapshot as _base_job_snapshot
from tests.test_job_fit import profile_snapshot as _base_profile_snapshot

ELIGIBILITY_REQUIREMENT_ID = "jobev-spons-1"


def _profile_snapshot(claims: list[dict] | None = None) -> dict:
    snapshot = _base_profile_snapshot()
    snapshot["claims"] = claims if claims is not None else []
    snapshot["summary"]["claim_count"] = len(snapshot["claims"])
    snapshot["summary"]["placeholder_claim_count"] = sum(
        1 for c in snapshot["claims"] if c.get("placeholder")
    )
    return snapshot


def _claim(claim_id: str) -> dict:
    return {
        "id": claim_id,
        "record_id": f"rec_{claim_id[-16:]}",
        "concept_id": f"cpt_{claim_id[-16:]}",
        "category": "eligibility",
        "field": "work_authorization",
        "value": "No sponsorship required",
        "source": {
            "file": "CLAUDE.md",
            "section": "Candidate Profile > Eligibility",
            "line_start": 1,
            "line_end": 1,
        },
        "placeholder": False,
        "confidence": "high",
        "extraction_status": "explicit",
    }


def _job_snapshot() -> dict:
    snapshot = _base_job_snapshot()
    snapshot["eligibility_requirements"] = [
        {"id": ELIGIBILITY_REQUIREMENT_ID, "text": "Visa sponsorship is not available.", "kind": "required"},
    ]
    return snapshot


def _bundle_entry(resolution_id: str) -> dict:
    return {
        "resolution_id": resolution_id,
        "subject_key": "gate:eligibility",
        "semantic_subject_key": "work_authorization.sponsorship_required",
        "blocker_type": "gate_flag",
        "answer_scope": "APPLICATION_ONLY",
        "value": {"type": "boolean", "value": True},
        "resolved_by": "user_1",
        "matched_scope_source": "APPLICATION_ONLY",
    }


def _bundle(*entries: dict) -> dict:
    return {"schema_version": "resolved_blocker_answers.v1", "workspace_id": "ws_1", "answers": list(entries)}


def _build_fail_request(
    *,
    profile_claims: list[dict] | None = None,
    resolved_answer_ids: list[str] | None = None,
    cross_source_relation: str | None = "__OMIT__",
) -> dict:
    job_snapshot = _job_snapshot()
    resolved_job_evidence = build_resolved_job_evidence_bundle(job_snapshot)
    job_evidence_id = next(
        item["id"] for item in resolved_job_evidence["evidence"]
        if item["category"] == "eligibility_requirements"
    )
    gate_proposal = {
        "gate_id": "eligibility",
        "status": "FAIL",
        "reason": "Candidate confirmed sponsorship would be required; posting states none is offered.",
        "job_evidence_ids": [job_evidence_id],
        "profile_evidence_ids": [c["id"] for c in (profile_claims or [])],
    }
    if resolved_answer_ids is not None:
        gate_proposal["resolved_answer_ids"] = resolved_answer_ids
    if cross_source_relation != "__OMIT__":
        gate_proposal["cross_source_relation"] = cross_source_relation

    bundle_entries = [_bundle_entry(rid) for rid in (resolved_answer_ids or [])]
    return build_semantic_job_fit_request(
        request_id="req_test00000000000000020",
        profile_snapshot=_profile_snapshot(profile_claims),
        job_snapshot=job_snapshot,
        resolved_job_evidence=resolved_job_evidence,
        resolved_blocker_answers=_bundle(*bundle_entries),
        semantic_proposals={"matches": [], "gates": [gate_proposal]},
    )


def _eligibility(result: dict) -> dict:
    return next(g for g in result["gate_assessments"] if g["gate_id"] == "eligibility")


def test_resolved_answer_only_fail_is_supportive_not_conflicting():
    """Case 1: a FAIL supported by resolved-answer evidence alone (no
    profile evidence cited at all) -- the exact shape Task 11's own
    sponsorship-correction test double uses. Must be SUPPORTIVE, never
    CONFLICTING, since there is no second evidence source to disagree
    with. cross_source_relation is correctly omitted here -- the shape
    validator only requires it when BOTH source types are cited."""
    request = _build_fail_request(
        profile_claims=None, resolved_answer_ids=["blockres_a1"], cross_source_relation="__OMIT__",
    )
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["status"] == "FAIL"
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["profile_evidence_ids"] == []
    assert gate["resolved_answer_ids"] == ["blockres_a1"]


def test_profile_only_fail_is_supportive_not_conflicting():
    """Case 2: a FAIL supported by profile evidence alone (no resolved
    answer cited at all) -- the ordinary, pre-Phase-4C FAIL shape. Must
    remain SUPPORTIVE, exactly as it always has."""
    claims = [_claim("clm_1111111111111111")]
    request = _build_fail_request(
        profile_claims=claims, resolved_answer_ids=None, cross_source_relation="__OMIT__",
    )
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["status"] == "FAIL"
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["profile_evidence_ids"] == ["clm_1111111111111111"]
    assert gate["resolved_answer_ids"] == []


def test_dual_source_aligned_fail_is_supportive_not_conflicting():
    """Case 3: both profile evidence and a resolved answer are cited on a
    FAIL, and the semantic adapter explicitly asserts they AGREE
    (cross_source_relation=ALIGNED). Must be SUPPORTIVE -> AUTO_REJECT --
    citing two sources that happen to agree is not a conflict, and must
    not be routed to a human merely because two sources were cited."""
    claims = [_claim("clm_1111111111111111")]
    request = _build_fail_request(
        profile_claims=claims, resolved_answer_ids=["blockres_a1"], cross_source_relation="ALIGNED",
    )
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["status"] == "FAIL"
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["profile_evidence_ids"] == ["clm_1111111111111111"]
    assert gate["resolved_answer_ids"] == ["blockres_a1"]


def test_dual_source_conflicting_fail_is_conflicting():
    """Case 4 (Scenario 11): both profile evidence and a resolved answer
    are cited on a FAIL, and the semantic adapter explicitly asserts they
    DISAGREE (cross_source_relation=CONFLICTING). Must be CONFLICTING --
    the genuine cross-source-disagreement case from Phase 4C spec Sec9's
    table. The deterministic layer trusts this explicit signal verbatim;
    it never independently verifies agreement/disagreement itself."""
    claims = [_claim("clm_1111111111111111")]
    request = _build_fail_request(
        profile_claims=claims, resolved_answer_ids=["blockres_a1"], cross_source_relation="CONFLICTING",
    )
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["status"] == "FAIL"
    assert gate["evidence_disposition"] == "CONFLICTING"
    assert gate["profile_evidence_ids"] == ["clm_1111111111111111"]
    assert gate["resolved_answer_ids"] == ["blockres_a1"]


def test_dual_source_missing_relation_fails_safely_not_silently():
    """Case 5: both profile evidence and a resolved answer are cited, but
    cross_source_relation is entirely absent. This must be rejected as a
    malformed/incomplete proposal (a hard SemanticJobFitValidationError,
    raised at request-construction time by build_semantic_job_fit_request's
    own validate_semantic_job_fit_request call) rather than silently
    defaulting to either ALIGNED or CONFLICTING -- the deterministic layer
    must never guess an agree/disagree judgment from citation shape
    alone."""
    claims = [_claim("clm_1111111111111111")]
    with pytest.raises(SemanticJobFitValidationError) as exc_info:
        _build_fail_request(
            profile_claims=claims, resolved_answer_ids=["blockres_a1"], cross_source_relation="__OMIT__",
        )
    assert any("cross_source_relation" in error for error in exc_info.value.errors)


def test_dual_source_invalid_relation_value_fails_safely():
    """A cross_source_relation value outside the closed enum is also a
    hard validation error, exactly like every other enum field in this
    contract."""
    claims = [_claim("clm_1111111111111111")]
    with pytest.raises(SemanticJobFitValidationError) as exc_info:
        _build_fail_request(
            profile_claims=claims, resolved_answer_ids=["blockres_a1"], cross_source_relation="MAYBE",
        )
    assert any("cross_source_relation" in error for error in exc_info.value.errors)


def test_cross_source_relation_ignored_when_only_one_source_cited():
    """Supplying cross_source_relation even when only one source is cited
    is accepted (NOT_APPLICABLE is the correct/expected value in that
    case) but has no bearing on the FAIL disposition -- the precedence
    rule only ever looks at cross_source_relation via the has_supporting_
    evidence branch, and a single-source FAIL is always SUPPORTIVE
    regardless of what this field says."""
    request = _build_fail_request(
        profile_claims=None, resolved_answer_ids=["blockres_a1"], cross_source_relation="NOT_APPLICABLE",
    )
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["evidence_disposition"] == "SUPPORTIVE"
