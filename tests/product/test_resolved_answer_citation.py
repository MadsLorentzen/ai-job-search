"""validate_resolved_answer_citation: the deterministic gate for whether
a semantic adapter's cited resolved answer is trustworthy (Phase 4C
spec §8).

Validation rules exercised here (per the Task 8 prompt's authoritative
refinement of the plan text):
  1. resolution_id must be present in bundle["answers"] -- presence IS the
     effectiveness/applicability guarantee, no separate staleness check.
  2. Own-workspace answers (matched_scope_source APPLICATION_ONLY or
     CANDIDATE_FACT) are valid only on an EXACT subject_key string match --
     no semantic-subject check performed for this branch.
  3. Cross-workspace answers (matched_scope_source SEARCH_WORKSPACE, the
     only cross-workspace source Task 5/6 ever produce) are valid only when
     both the bundle entry's semantic_subject_key and the target gate's own
     classified semantic_subject_key are non-None and equal.
  4. CANDIDATE_FACT is handled entirely by rule 2 -- it never reaches the
     semantic-subject branch, because Task 6 guarantees it is always this
     workspace's own tier-1 answer.
"""

from __future__ import annotations

from product.semantic_job_fit import validate_resolved_answer_citation

BUNDLE = {
    "schema_version": "resolved_blocker_answers.v1",
    "workspace_id": "ws_1",
    "answers": [
        {
            "resolution_id": "blockres_a1",
            "subject_key": "gate:eligibility",
            "semantic_subject_key": "work_authorization.sponsorship_required",
            "blocker_type": "gate_flag",
            "answer_scope": "APPLICATION_ONLY",
            "value": {"type": "boolean", "value": False},
            "resolved_by": "user_1",
            "matched_scope_source": "APPLICATION_ONLY",
        },
        {
            "resolution_id": "blockres_b2",
            "subject_key": "gate:eligibility",
            "semantic_subject_key": "work_authorization.sponsorship_required",
            "blocker_type": "gate_flag",
            "answer_scope": "SEARCH_WORKSPACE",
            "value": {"type": "boolean", "value": False},
            "resolved_by": "user_1",
            "matched_scope_source": "SEARCH_WORKSPACE",
        },
        {
            "resolution_id": "blockres_c3",
            "subject_key": "gate:eligibility",
            "semantic_subject_key": "work_authorization.sponsorship_required",
            "blocker_type": "gate_flag",
            "answer_scope": "CANDIDATE_FACT",
            "value": {"type": "boolean", "value": False},
            "resolved_by": "user_1",
            "matched_scope_source": "CANDIDATE_FACT",
        },
    ],
}


def test_own_application_answer_valid_for_exact_subject_key_match():
    assert validate_resolved_answer_citation(
        "blockres_a1", BUNDLE,
        blocker_type="gate_flag", subject_key="gate:eligibility",
        target_semantic_subject_key="work_authorization.sponsorship_required",
        target_job_evidence_ids=["jobev_1"],
    ) is True


def test_own_application_answer_invalid_for_different_subject_key():
    assert validate_resolved_answer_citation(
        "blockres_a1", BUNDLE,
        blocker_type="gate_flag", subject_key="gate:language",
        target_semantic_subject_key="work_authorization.sponsorship_required",
        target_job_evidence_ids=["jobev_1"],
    ) is False


def test_cross_application_answer_valid_when_semantic_subject_matches():
    assert validate_resolved_answer_citation(
        "blockres_b2", BUNDLE,
        blocker_type="gate_flag", subject_key="gate:eligibility",
        target_semantic_subject_key="work_authorization.sponsorship_required",
        target_job_evidence_ids=["jobev_1"],
    ) is True


def test_cross_application_answer_invalid_when_target_has_no_semantic_subject():
    assert validate_resolved_answer_citation(
        "blockres_b2", BUNDLE,
        blocker_type="gate_flag", subject_key="gate:eligibility",
        target_semantic_subject_key=None,
        target_job_evidence_ids=["jobev_1"],
    ) is False


def test_cross_application_answer_invalid_when_semantic_subject_differs():
    assert validate_resolved_answer_citation(
        "blockres_b2", BUNDLE,
        blocker_type="gate_flag", subject_key="gate:eligibility",
        target_semantic_subject_key="employment.notice_period",
        target_job_evidence_ids=["jobev_1"],
    ) is False


def test_unknown_resolution_id_is_invalid():
    assert validate_resolved_answer_citation(
        "blockres_does_not_exist", BUNDLE,
        blocker_type="gate_flag", subject_key="gate:eligibility",
        target_semantic_subject_key="work_authorization.sponsorship_required",
        target_job_evidence_ids=["jobev_1"],
    ) is False


def test_candidate_fact_entry_validated_via_exact_subject_key_rule_when_cited_by_own_gate():
    # Rule 4: CANDIDATE_FACT is handled entirely by rule 2 (exact
    # subject_key match), never rule 3's semantic-subject leniency.
    assert validate_resolved_answer_citation(
        "blockres_c3", BUNDLE,
        blocker_type="gate_flag", subject_key="gate:eligibility",
        target_semantic_subject_key="work_authorization.sponsorship_required",
        target_job_evidence_ids=["jobev_1"],
    ) is True


def test_candidate_fact_entry_invalid_for_different_gate_even_with_matching_semantic_subject():
    # Proves rule 4 in the negative direction: a CANDIDATE_FACT entry must
    # NOT fall back to semantic-subject matching when the exact subject_key
    # doesn't match, even though the semantic subject does match -- that
    # would be re-introducing the corrected-away cross-application path.
    assert validate_resolved_answer_citation(
        "blockres_c3", BUNDLE,
        blocker_type="gate_flag", subject_key="gate:language",
        target_semantic_subject_key="work_authorization.sponsorship_required",
        target_job_evidence_ids=["jobev_1"],
    ) is False
