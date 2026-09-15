"""Integration: _build_gate_assessments consumes resolved_answer_ids
citations end-to-end, via the public analyze_semantic_job_fit entry point
(Phase 4C spec §7/§8/§9).

Covers, per the Task 8 prompt's required integration coverage:
  - profile evidence only (no citation) -- baseline unaffected
  - resolved answer only (no profile evidence) -- citation alone -> SUPPORTIVE
  - both valid (profile evidence + valid citation agree)
  - invalid resolution + valid profile evidence (citation dropped, profile
    evidence still counts)
  - valid resolution + invalid/placeholder profile evidence (citation still
    counts even though profile evidence doesn't)
  - wrong semantic subject (SEARCH_WORKSPACE citation for a different
    subject than the target gate) -- dropped
  - wrong gate (own-workspace citation for a different gate's subject_key)
    -- dropped
  - cross-workspace SEARCH_WORKSPACE valid
  - cross-workspace CANDIDATE_FACT: valid via exact-subject_key rule when
    cited by its own gate; dropped when cited by a different gate
"""

from __future__ import annotations

import copy

from product.semantic_job_fit import (
    JOB_FIT_REQUEST_VERSION_V2,
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


def _claim(claim_id: str, *, placeholder: bool = False) -> dict:
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
        "placeholder": placeholder,
        "confidence": "high",
        "extraction_status": "explicit",
    }


def _job_snapshot(*, eligibility_text: str = "Visa sponsorship is not available.") -> dict:
    snapshot = _base_job_snapshot()
    snapshot["eligibility_requirements"] = [
        {"id": ELIGIBILITY_REQUIREMENT_ID, "text": eligibility_text, "kind": "required"},
    ]
    return snapshot


def _resolved_job_evidence(job_snapshot: dict) -> dict:
    return build_resolved_job_evidence_bundle(job_snapshot)


def _bundle_entry(
    resolution_id: str,
    *,
    subject_key: str = "gate:eligibility",
    semantic_subject_key: str | None = "work_authorization.sponsorship_required",
    matched_scope_source: str = "APPLICATION_ONLY",
    answer_scope: str | None = None,
) -> dict:
    return {
        "resolution_id": resolution_id,
        "subject_key": subject_key,
        "semantic_subject_key": semantic_subject_key,
        "blocker_type": "gate_flag",
        "answer_scope": answer_scope or matched_scope_source,
        "value": {"type": "boolean", "value": False},
        "resolved_by": "user_1",
        "matched_scope_source": matched_scope_source,
    }


def _bundle(*entries: dict) -> dict:
    return {
        "schema_version": "resolved_blocker_answers.v1",
        "workspace_id": "ws_1",
        "answers": list(entries),
    }


def _build_request(
    *,
    profile_claims: list[dict] | None = None,
    bundle: dict | None = None,
    resolved_answer_ids: list[str] | None = None,
    gate_status: str = "PASS",
    eligibility_text: str = "Visa sponsorship is not available.",
) -> dict:
    job_snapshot = _job_snapshot(eligibility_text=eligibility_text)
    resolved_job_evidence = _resolved_job_evidence(job_snapshot)
    job_evidence_id = next(
        item["id"] for item in resolved_job_evidence["evidence"]
        if item["category"] == "eligibility_requirements"
    )
    gate_proposal = {
        "gate_id": "eligibility",
        "status": gate_status,
        "reason": "Adjudicated by test.",
        "job_evidence_ids": [job_evidence_id],
        "profile_evidence_ids": [c["id"] for c in (profile_claims or [])],
    }
    if resolved_answer_ids is not None:
        gate_proposal["resolved_answer_ids"] = resolved_answer_ids

    return build_semantic_job_fit_request(
        request_id="req_test00000000000000010",
        profile_snapshot=_profile_snapshot(profile_claims),
        job_snapshot=job_snapshot,
        resolved_job_evidence=resolved_job_evidence,
        resolved_blocker_answers=bundle if bundle is not None else _bundle(),
        semantic_proposals={"matches": [], "gates": [gate_proposal]},
    )


def _eligibility(result: dict) -> dict:
    return next(g for g in result["gate_assessments"] if g["gate_id"] == "eligibility")


def test_profile_evidence_only_baseline_unaffected():
    claims = [_claim("clm_1111111111111111")]
    request = _build_request(profile_claims=claims)
    assert request["schema_version"] == JOB_FIT_REQUEST_VERSION_V2
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["status"] == "PASS"
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["profile_evidence_ids"] == ["clm_1111111111111111"]
    assert gate["resolved_answer_ids"] == []


def test_resolved_answer_only_makes_gate_supportive():
    bundle = _bundle(_bundle_entry("blockres_a1"))
    request = _build_request(bundle=bundle, resolved_answer_ids=["blockres_a1"])
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["status"] == "PASS"
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["profile_evidence_ids"] == []
    assert gate["resolved_answer_ids"] == ["blockres_a1"]


def test_both_profile_evidence_and_valid_citation_agree():
    claims = [_claim("clm_1111111111111111")]
    bundle = _bundle(_bundle_entry("blockres_a1"))
    request = _build_request(profile_claims=claims, bundle=bundle, resolved_answer_ids=["blockres_a1"])
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["status"] == "PASS"
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["profile_evidence_ids"] == ["clm_1111111111111111"]
    assert gate["resolved_answer_ids"] == ["blockres_a1"]


def test_invalid_resolution_dropped_but_valid_profile_evidence_still_counts():
    claims = [_claim("clm_1111111111111111")]
    bundle = _bundle()  # empty -- blockres_missing not in bundle
    request = _build_request(profile_claims=claims, bundle=bundle, resolved_answer_ids=["blockres_missing"])
    result = analyze_semantic_job_fit(request)  # must not raise
    gate = _eligibility(result)
    assert gate["status"] == "PASS"
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["profile_evidence_ids"] == ["clm_1111111111111111"]
    assert gate["resolved_answer_ids"] == []


def test_valid_resolution_still_counts_when_profile_evidence_is_placeholder():
    # Mirrors existing placeholder-rejection logic for profile evidence:
    # a placeholder claim is rejected by _supportive_profile_claims exactly
    # as it already is today -- the resolved-answer citation must not be
    # weakened by that rejection.
    placeholder_claim = _claim("clm_1111111111111111", placeholder=True)
    bundle = _bundle(_bundle_entry("blockres_a1"))
    request = _build_request(
        profile_claims=[placeholder_claim], bundle=bundle, resolved_answer_ids=["blockres_a1"],
    )
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["status"] == "PASS"
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["profile_evidence_ids"] == []  # placeholder rejected, exactly as today
    assert gate["resolved_answer_ids"] == ["blockres_a1"]  # citation unaffected


def test_wrong_semantic_subject_search_workspace_citation_dropped():
    # SEARCH_WORKSPACE citation whose semantic_subject_key differs from
    # the target gate's own classified semantic subject.
    bundle = _bundle(
        _bundle_entry(
            "blockres_b2",
            semantic_subject_key="employment.notice_period",
            matched_scope_source="SEARCH_WORKSPACE",
        )
    )
    request = _build_request(bundle=bundle, resolved_answer_ids=["blockres_b2"])
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["resolved_answer_ids"] == []
    # No evidence at all now (no profile, invalid citation dropped) -> falls
    # back to existing ABSENT/UNVERIFIED adjudication, exactly as if the
    # adapter had never cited anything.
    assert gate["evidence_disposition"] == "ABSENT"
    assert gate["status"] == "UNVERIFIED"


def test_wrong_gate_own_workspace_citation_dropped():
    # Own-workspace (APPLICATION_ONLY) citation whose subject_key belongs
    # to a different gate/blocker instance than the one citing it.
    bundle = _bundle(_bundle_entry("blockres_a1", subject_key="gate:language"))
    request = _build_request(bundle=bundle, resolved_answer_ids=["blockres_a1"])
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["resolved_answer_ids"] == []
    assert gate["evidence_disposition"] == "ABSENT"
    assert gate["status"] == "UNVERIFIED"


def test_cross_workspace_search_workspace_valid():
    bundle = _bundle(
        _bundle_entry(
            "blockres_b2",
            semantic_subject_key="work_authorization.sponsorship_required",
            matched_scope_source="SEARCH_WORKSPACE",
        )
    )
    request = _build_request(bundle=bundle, resolved_answer_ids=["blockres_b2"])
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["resolved_answer_ids"] == ["blockres_b2"]
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["status"] == "PASS"


def test_cross_workspace_candidate_fact_valid_for_own_gate_via_exact_subject_key_rule():
    bundle = _bundle(
        _bundle_entry(
            "blockres_c3",
            subject_key="gate:eligibility",
            matched_scope_source="CANDIDATE_FACT",
        )
    )
    request = _build_request(bundle=bundle, resolved_answer_ids=["blockres_c3"])
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["resolved_answer_ids"] == ["blockres_c3"]
    assert gate["evidence_disposition"] == "SUPPORTIVE"
    assert gate["status"] == "PASS"


def test_candidate_fact_dropped_when_cited_by_different_gate():
    # Confirms rule 2's exact-match behavior applies to CANDIDATE_FACT, not
    # rule 3's semantic-subject leniency: even though the semantic subject
    # would match, a different gate's subject_key means the citation is
    # dropped, exactly as an APPLICATION_ONLY entry would be.
    bundle = _bundle(
        _bundle_entry(
            "blockres_c3",
            subject_key="gate:language",
            semantic_subject_key="work_authorization.sponsorship_required",
            matched_scope_source="CANDIDATE_FACT",
        )
    )
    request = _build_request(bundle=bundle, resolved_answer_ids=["blockres_c3"])
    result = analyze_semantic_job_fit(request)
    gate = _eligibility(result)
    assert gate["resolved_answer_ids"] == []
    assert gate["evidence_disposition"] == "ABSENT"
    assert gate["status"] == "UNVERIFIED"
