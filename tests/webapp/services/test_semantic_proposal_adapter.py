# tests/webapp/services/test_semantic_proposal_adapter.py
from product.semantic_job_fit import build_semantic_job_fit_request, validate_semantic_job_fit_request

from webapp.services.semantic_proposal_adapter import (
    SemanticProposalAdapter, FakeSemanticProposalAdapter, select_semantic_profile_evidence,
)

FORBIDDEN_KEYS = {"overall_score", "verdict", "recommendation", "blocked", "blocking_gate_ids"}


def _assert_no_forbidden_keys(value):
    if isinstance(value, dict):
        for key, sub in value.items():
            assert key not in FORBIDDEN_KEYS, f"adapter output must not contain {key!r}"
            _assert_no_forbidden_keys(sub)
    elif isinstance(value, list):
        for item in value:
            _assert_no_forbidden_keys(item)


def _minimal_profile_snapshot():
    return {
        "schema_version": "candidate-profile-evidence-snapshot.v0",
        "id_semantics": "deterministic content-derived identifiers; not durable persistent identifiers",
        "sources": [{"file": "cv.md", "sha256": "4097889236a2af26c293033feb964c4cf118c0224e0d063fec0a89e9d0569ef2",
                      "line_count": 1}], "claims": [
            {"id": "clm_0000000000000001", "record_id": "rec_0000000000000001", "concept_id": "cpt_0000000000000001",
             "category": "experience", "field": "responsibility", "value": "Led a data migration project",
             "source": {"file": "cv.md", "section": None, "line_start": 1, "line_end": 1},
             "placeholder": False, "confidence": "high", "extraction_status": "explicit"},
        ],
        "corroborations": [], "conflicts": [],
        "summary": {"source_count": 1, "claim_count": 1, "placeholder_claim_count": 0,
                     "corroboration_count": 0, "conflict_count": 0},
    }


def _minimal_job_snapshot():
    return {
        "schema_version": "job-posting-snapshot.v0", "job_id": "jobsrc_0000000000000000000a",
        "source": "manual", "captured_at": "2026-08-18T00:00:00Z",
        "company": "Acme", "title": "Backend Engineer",
        "requirements": [{"id": "jobev_req_0000000000000001", "text": "Lead data migrations", "kind": "required"}],
        "responsibilities": [], "language_requirements": [], "eligibility_requirements": [],
        "logistics_requirements": [], "metadata": {"ingestion": {}},
    }


def _minimal_resolved_bundle():
    return {
        "schema_version": "resolved-job-evidence-bundle.v0",
        "job_snapshot": {"schema_version": "job-posting-snapshot.v0", "job_id": "jobsrc_0000000000000000000a",
                          "content_id": "jobsnap_2dfdbe6de74a1906af38"},
        "evidence": [
            {"id": "jobev_req_0000000000000001", "category": "requirements", "text": "Lead data migrations",
             "kind": "required", "origin": "job_posting_snapshot", "status": "EXPLICIT"},
        ],
        "aliases": [], "excluded": {"raw_text": "not_semantic_fit_evidence", "suggestions": "not_semantic_fit_evidence",
                                     "ambiguous_statements": "not_semantic_fit_evidence", "warnings": "not_semantic_fit_evidence"},
        "summary": {"evidence_count": 1, "alias_count": 0},
    }


def test_fake_adapter_output_round_trips_through_real_ticket7_request_validation():
    adapter = FakeSemanticProposalAdapter(canned_response={
        "matches": [{
            "proposal_id": "prop_0000000000000001",
            "job_evidence_id": "jobev_req_0000000000000001",
            "profile_evidence_ids": ["clm_0000000000000001"],
            "classification": "direct",
            "rationale": "Both describe leading a data migration project.",
        }],
        "gates": [{
            "gate_id": "eligibility", "status": "PASS", "reason": "No eligibility concerns identified.",
            "job_evidence_ids": [], "profile_evidence_ids": [],
        }],
    })
    proposals = adapter.propose(
        profile_evidence=_minimal_profile_snapshot()["claims"],
        resolved_job_evidence=_minimal_resolved_bundle(),
        active_extensions=[],
    )
    request = build_semantic_job_fit_request(
        request_id="req_test_1",
        profile_snapshot=_minimal_profile_snapshot(),
        job_snapshot=_minimal_job_snapshot(),
        resolved_job_evidence=_minimal_resolved_bundle(),
        semantic_proposals=proposals,
    )
    validate_semantic_job_fit_request(request)  # must not raise


def test_adapter_forbids_authoritative_keys_but_allows_required_gate_status():
    adapter = FakeSemanticProposalAdapter(canned_response={
        "matches": [],
        "gates": [{"gate_id": "eligibility", "status": "PASS", "reason": "x",
                    "job_evidence_ids": [], "profile_evidence_ids": []}],
        "overall_score": 99,  # attempt to smuggle an authoritative key
        "verdict": {"id": "strong_fit"},
    })
    result = adapter.propose(profile_evidence=[], resolved_job_evidence=_minimal_resolved_bundle(), active_extensions=[])
    assert set(result.keys()) == {"matches", "gates"}
    assert result["gates"][0]["status"] == "PASS"  # status survives — it is required, not forbidden
    _assert_no_forbidden_keys(result)


def test_adapter_builds_prompt_context_with_extension_mapping_identity_not_raw_files():
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    extension = {
        "schema_version": "extension-package.v0", "id": "ext_wellcontrol", "name": "Well Control",
        "version": "1.0.0", "status": "active", "description": "x", "publisher": "x", "trust": "x", "metadata": {}, "scope": "x",
        "transferable_mappings": [
            {"id": "map_0001", "source": "concept:driller.well_control", "target": "concept:hse.risk_assessment",
             "rationale": "Well control drills are a form of risk assessment.", "transfer_strength": "strong",
             "limitations": "Requires HSE certification to be recognized formally."},
        ],
    }
    context = adapter.build_prompt_context(
        profile_evidence=[{"id": "clm_1", "category": "experience", "field": "responsibility", "value": "x"}],
        resolved_job_evidence=_minimal_resolved_bundle(),
        active_extensions=[extension],
    )
    ext_context = context["active_extensions"][0]
    assert ext_context["extension_id"] == "ext_wellcontrol"
    assert ext_context["extension_version"] == "1.0.0"
    mapping = ext_context["transferable_mappings"][0]
    assert mapping["id"] == "map_0001"
    assert mapping["source"] == "concept:driller.well_control"
    assert mapping["limitations"] == "Requires HSE certification to be recognized formally."
    import json
    serialized = json.dumps(context)
    assert "source_file" not in serialized
    assert "cv_file" not in serialized


def test_semantic_profile_subset_excludes_contact_identity_placeholders_and_conflicts():
    claims = [
        {"id": "name", "concept_id": "c-name", "category": "identity", "field": "name", "value": "Ada"},
        {"id": "email", "concept_id": "c-email", "category": "contact", "field": "email", "value": "ada@example.test"},
        {"id": "phone", "concept_id": "c-phone", "category": "contact", "field": "phone", "value": "+44 000"},
        {"id": "url", "concept_id": "c-url", "category": "contact", "field": "linkedin", "value": "https://example.test"},
        {"id": "placeholder", "concept_id": "c-placeholder", "category": "skills", "field": "skill", "value": "[SKILL]", "placeholder": True},
        {"id": "conflicted", "concept_id": "c-conflict", "category": "employment", "field": "title", "value": "Engineer"},
        {"id": "skill", "concept_id": "c-skill", "category": "skills", "field": "skill", "value": "Python", "placeholder": False},
        {"id": "language", "concept_id": "c-language", "category": "languages", "field": "language", "value": "English", "placeholder": False},
        {"id": "location", "concept_id": "c-location", "category": "location", "field": "location", "value": "London", "placeholder": False},
        {"id": "status", "concept_id": "c-status", "category": "identity", "field": "employment_status", "value": "Employed", "placeholder": False},
    ]
    selected = select_semantic_profile_evidence({
        "claims": claims,
        "conflicts": [{"id": "conf", "concept_id": "c-conflict"}],
    })
    assert {item["id"] for item in selected} == {"skill", "language", "location", "status"}

    adapter = FakeSemanticProposalAdapter({"matches": [], "gates": []})
    context = adapter.build_prompt_context(
        profile_evidence=selected, resolved_job_evidence=_minimal_resolved_bundle(),
        active_extensions=[],
    )
    serialized = str(context)
    assert "ada@example.test" not in serialized
    assert "+44 000" not in serialized
    assert "https://example.test" not in serialized
