"""Tests for Ticket 7 Semantic Job Fit Analyzer v0."""

import copy
import json
import unittest
from pathlib import Path

from product.job_understanding import build_job_understanding_request, extract_job_understanding
from product.job_understanding_providers import DeterministicFakeProvider
from product.semantic_job_fit import (
    JOB_FIT_REQUEST_VERSION_V1,
    JOB_FIT_RESULT_VERSION_V1,
    RESOLVED_JOB_EVIDENCE_BUNDLE_VERSION,
    SEMANTIC_FIT_POLICY_VERSION,
    SemanticJobFitValidationError,
    analyze_semantic_job_fit,
    build_resolved_job_evidence_bundle,
    build_semantic_job_fit_request,
    load_semantic_fit_policy,
    validate_resolved_job_evidence_bundle,
    validate_semantic_fit_policy,
    validate_semantic_job_fit_result,
)
from tests.test_job_fit import extension, profile_snapshot


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "job_understanding"


def fixture(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


def job_snapshot() -> dict:
    return fixture("job-snapshot.json")


def ready_candidate() -> dict:
    return fixture("provider-ready.json")


def understanding_pair(job=None, candidate=None):
    job = job or job_snapshot()
    request = build_job_understanding_request(job, "understanding-ticket7")
    result = extract_job_understanding(
        job,
        DeterministicFakeProvider(candidate or ready_candidate()),
        "understanding-ticket7",
    )
    return request, result


def claim(claim_id: str, category: str, field: str, value: str) -> dict:
    return {
        "id": claim_id,
        "record_id": f"rec_{claim_id[-16:]}",
        "concept_id": f"cpt_{claim_id[-16:]}",
        "category": category,
        "field": field,
        "value": value,
        "source": {
            "file": "CLAUDE.md",
            "section": "Candidate Profile > Synthetic",
            "line_start": 41,
            "line_end": 41,
        },
        "placeholder": False,
        "confidence": "high",
        "extraction_status": "explicit",
    }


def rich_profile() -> dict:
    profile = profile_snapshot()
    extra = [
        claim("clm_4444444444444444", "eligibility", "work_authorization", "Right to work in the UK"),
        claim("clm_5555555555555555", "languages", "language", "German"),
        claim("clm_6666666666666666", "constraints", "location", "London hybrid"),
    ]
    profile["claims"].extend(extra)
    profile["summary"]["claim_count"] = len(profile["claims"])
    return profile


def proposals_for_full_fit(bundle: dict) -> dict:
    pipeline_id = next(
        item["id"]
        for item in bundle["evidence"]
        if item["text"] == "Build reliable data pipelines."
    )
    work_id = next(
        item["id"]
        for item in bundle["evidence"]
        if item["text"] == "Applicants must already have the right to work in the UK."
    )
    german_id = next(
        item["id"]
        for item in bundle["evidence"]
        if item["category"] == "language_requirements"
    )
    hybrid_id = next(
        item["id"]
        for item in bundle["evidence"]
        if item["category"] == "logistics_requirements"
    )
    return {
        "matches": [
            {
                "proposal_id": "sem-python",
                "job_evidence_id": "jobev_req_python",
                "profile_evidence_ids": ["clm_1111111111111111"],
                "classification": "direct",
                "rationale": "Python is explicit on both sides.",
                "confidence": "high",
            },
            {
                "proposal_id": "sem-pipelines",
                "job_evidence_id": pipeline_id,
                "profile_evidence_ids": ["clm_2222222222222222"],
                "classification": "functionally_equivalent",
                "rationale": "Pipeline building responsibility aligns by function.",
                "confidence": "high",
                "functional_basis": {
                    "responsibility_alignment": ["Build reliable data pipelines", "Built production data pipelines"],
                    "competency_alignment": [],
                    "title_similarity_only": False,
                },
            },
        ],
        "gates": [
            {
                "gate_id": "eligibility",
                "status": "PASS",
                "reason": "Candidate has right-to-work evidence.",
                "job_evidence_ids": [work_id],
                "profile_evidence_ids": ["clm_4444444444444444"],
            },
            {
                "gate_id": "language",
                "status": "PASS",
                "reason": "Candidate has language evidence.",
                "job_evidence_ids": [german_id],
                "profile_evidence_ids": ["clm_5555555555555555"],
            },
            {
                "gate_id": "location_logistics",
                "status": "PASS",
                "reason": "Candidate has logistics evidence.",
                "job_evidence_ids": [hybrid_id],
                "profile_evidence_ids": ["clm_6666666666666666"],
            },
        ],
    }


def fully_scoring_policy() -> dict:
    policy = load_semantic_fit_policy()
    by_id = {rule["id"]: rule for rule in policy["dimension_rules"]}
    by_id["behavioral_fit"]["job_categories"] = ["responsibilities"]
    by_id["behavioral_fit"]["scores_by_classification"] = {
        "direct": 88,
        "functionally_equivalent": 80,
        "transferable": 65,
        "adjacent": None,
        "unsupported": None,
    }
    by_id["career_alignment"]["job_categories"] = ["requirements"]
    by_id["career_alignment"]["scores_by_classification"] = {
        "direct": 90,
        "functionally_equivalent": 80,
        "transferable": 65,
        "adjacent": None,
        "unsupported": None,
    }
    validate_semantic_fit_policy(policy)
    return policy


def semantic_request(
    profile=None,
    job=None,
    bundle=None,
    proposals=None,
    active_extensions=None,
    semantic_policy=None,
    user_intent=None,
) -> dict:
    job = job or job_snapshot()
    if bundle is None:
        understanding_request, understanding_result = understanding_pair(job)
        bundle = build_resolved_job_evidence_bundle(
            job,
            understanding_request,
            understanding_result,
        )
    return build_semantic_job_fit_request(
        request_id="fit-ticket7",
        profile_snapshot=profile or rich_profile(),
        job_snapshot=job,
        resolved_job_evidence=bundle,
        active_extensions=[extension()] if active_extensions is None else active_extensions,
        semantic_fit_policy=semantic_policy,
        user_intent=user_intent,
        semantic_proposals=proposals or proposals_for_full_fit(bundle),
    )


class SemanticJobFitTests(unittest.TestCase):
    def assert_invalid(self, callback, fragment=None):
        with self.assertRaises(SemanticJobFitValidationError) as context:
            callback()
        if fragment:
            self.assertIn(fragment, str(context.exception))

    def test_versions_are_owned_by_policy_and_v1_schema(self):
        policy = load_semantic_fit_policy()

        self.assertEqual(policy["schema_version"], SEMANTIC_FIT_POLICY_VERSION)
        self.assertEqual(semantic_request()["schema_version"], JOB_FIT_REQUEST_VERSION_V1)
        self.assertEqual(
            analyze_semantic_job_fit(semantic_request())["schema_version"],
            JOB_FIT_RESULT_VERSION_V1,
        )
        validate_semantic_fit_policy(policy)

    def test_unique_ticket6_evidence_is_usable_by_ticket7(self):
        req = semantic_request()

        result = analyze_semantic_job_fit(req)

        matched_ids = result["functionally_equivalent_matches"][0]["job_requirement_ids"]
        self.assertTrue(matched_ids[0].startswith("juev_"))
        self.assertEqual(result["functionally_equivalent_matches"][0]["status"], "READY")

    def test_duplicate_ticket6_evidence_aliases_raw_job_evidence_not_double_counted(self):
        job = job_snapshot()
        understanding_request, understanding_result = understanding_pair(job)

        bundle = build_resolved_job_evidence_bundle(job, understanding_request, understanding_result)

        self.assertEqual(bundle["schema_version"], RESOLVED_JOB_EVIDENCE_BUNDLE_VERSION)
        self.assertIn(
            {
                "alias_id": understanding_result["requirements"][0]["id"],
                "canonical_id": "jobev_req_python",
                "reason": "exact_duplicate",
            },
            bundle["aliases"],
        )
        self.assertEqual(
            len([item for item in bundle["evidence"] if item["text"] == "Python is required."]),
            1,
        )
        validate_resolved_job_evidence_bundle(job, bundle)

    def test_ticket6_suggestions_cannot_become_semantic_fit_evidence(self):
        job = job_snapshot()
        candidate = ready_candidate()
        candidate["suggestions"] = [
            {
                "proposal_id": "suggestion-one",
                "text": "Maybe this is senior.",
                "reason": "Needs review.",
                "quote": "You will mentor junior engineers.",
                "category": "responsibilities",
                "kind": "informational",
            }
        ]
        understanding_request, understanding_result = understanding_pair(job, candidate)
        bundle = build_resolved_job_evidence_bundle(job, understanding_request, understanding_result)
        suggestions_id = understanding_result["suggestions"][0]["id"]
        proposals = proposals_for_full_fit(bundle)
        proposals["matches"][0]["job_evidence_id"] = suggestions_id

        req = semantic_request(job=job, bundle=bundle, proposals=proposals)

        self.assert_invalid(lambda: analyze_semantic_job_fit(req), "unknown job evidence id")

    def test_direct_match_requires_profile_evidence(self):
        req = semantic_request()
        req["semantic_proposals"]["matches"][0]["profile_evidence_ids"] = []

        result = analyze_semantic_job_fit(req)

        self.assertFalse(result["direct_matches"])
        self.assertTrue(result["unsupported_claims"])
        self.assertEqual(result["gaps"][0]["gap_type"], "unsupported")

    def test_functional_match_requires_both_sides_and_non_title_basis(self):
        req = semantic_request()
        req["semantic_proposals"]["matches"][1]["functional_basis"] = {
            "responsibility_alignment": [],
            "competency_alignment": [],
            "title_similarity_only": True,
        }

        result = analyze_semantic_job_fit(req)

        self.assertFalse(result["functionally_equivalent_matches"])
        self.assertTrue(
            any("functional equivalence" in item["reason"] for item in result["unsupported_claims"])
        )

    def test_transferable_match_requires_active_extension_mapping_and_profile_evidence(self):
        req = semantic_request()
        pipeline_id = req["semantic_proposals"]["matches"][1]["job_evidence_id"]
        conditionless_extension = extension()
        conditionless_extension["transferable_mappings"][0]["conditions"] = []
        req["semantic_proposals"]["matches"] = [
            {
                "proposal_id": "sem-transfer",
                "job_evidence_id": pipeline_id,
                "profile_evidence_ids": ["clm_2222222222222222"],
                "classification": "transferable",
                "rationale": "Extension mapping supports transferability.",
                "confidence": "medium",
                "extension_ref": {
                    "extension_id": "data-transfer",
                    "extension_version": "0.1.0",
                    "record_type": "transferable_mapping",
                    "record_id": "field-models-to-pipelines",
                },
            }
        ]
        req["active_extensions"] = [conditionless_extension]

        result = analyze_semantic_job_fit(req)

        self.assertEqual(len(result["transferable_matches"]), 1)
        self.assertEqual(
            result["transferable_matches"][0]["limitations"],
            ["Does not prove employment history"],
        )
        self.assertEqual(result["transferable_matches"][0]["status"], "READY")

    def test_unresolved_transferable_conditions_do_not_contribute_to_scoring(self):
        req = semantic_request()
        pipeline_id = req["semantic_proposals"]["matches"][1]["job_evidence_id"]
        req["semantic_proposals"]["matches"] = [
            {
                "proposal_id": "sem-transfer-conditional",
                "job_evidence_id": pipeline_id,
                "profile_evidence_ids": ["clm_2222222222222222"],
                "classification": "transferable",
                "rationale": "Mapping conditions have not been resolved.",
                "confidence": "medium",
                "extension_ref": {
                    "extension_id": "data-transfer",
                    "extension_version": "0.1.0",
                    "record_type": "transferable_mapping",
                    "record_id": "field-models-to-pipelines",
                },
            }
        ]

        result = analyze_semantic_job_fit(req)

        self.assertEqual(result["transferable_matches"][0]["status"], "NEEDS_REVIEW")
        self.assertEqual(
            result["transferable_matches"][0]["conditions"],
            ["Candidate evidence exists"],
        )
        experience = next(
            item
            for item in result["dimension_assessments"]
            if item["dimension_id"] == "experience_match"
        )
        self.assertEqual(experience["status"], "NEEDS_REVIEW")
        self.assertIsNone(experience["score"])
        self.assertNotIn("experience_match", result["dimension_scores"])
        self.assertIsNone(result["overall_score"])
        self.assertIsNone(result["verdict"])
        self.assertTrue(
            any(
                question["topic"] == "extension_conditions"
                for question in result["human_judgment_questions"]
            )
        )

    def test_evaluate_intent_rejects_transferable_proposals(self):
        req = semantic_request(user_intent={"intent": "evaluate"})
        pipeline_id = req["semantic_proposals"]["matches"][1]["job_evidence_id"]
        req["semantic_proposals"]["matches"] = [
            {
                "proposal_id": "sem-transfer-disabled",
                "job_evidence_id": pipeline_id,
                "profile_evidence_ids": ["clm_2222222222222222"],
                "classification": "transferable",
                "rationale": "Transferability was not requested.",
                "confidence": "medium",
                "extension_ref": {
                    "extension_id": "data-transfer",
                    "extension_version": "0.1.0",
                    "record_type": "transferable_mapping",
                    "record_id": "field-models-to-pipelines",
                },
            }
        ]

        result = analyze_semantic_job_fit(req)

        self.assertFalse(result["transferable_matches"])
        self.assertTrue(
            any(
                "not permitted for evaluate intent" in item["reason"]
                for item in result["unsupported_claims"]
            )
        )

    def test_extension_only_candidate_claim_fails(self):
        req = semantic_request()
        pipeline_id = req["semantic_proposals"]["matches"][1]["job_evidence_id"]
        req["semantic_proposals"]["matches"] = [
            {
                "proposal_id": "sem-transfer-extension-only",
                "job_evidence_id": pipeline_id,
                "profile_evidence_ids": [],
                "classification": "transferable",
                "rationale": "Extension alone is not candidate evidence.",
                "confidence": "medium",
                "extension_ref": {
                    "extension_id": "data-transfer",
                    "extension_version": "0.1.0",
                    "record_type": "transferable_mapping",
                    "record_id": "field-models-to-pipelines",
                },
            }
        ]

        result = analyze_semantic_job_fit(req)

        self.assertFalse(result["transferable_matches"])
        self.assertTrue(result["unsupported_claims"])

    def test_prohibited_candidate_inference_field_is_rejected_before_transferability(self):
        req = semantic_request()
        req["semantic_proposals"]["matches"][0]["asserts_candidate_facts"] = [
            {
                "type": "professional-certification",
                "profile_evidence_ids": [],
            }
        ]

        self.assert_invalid(
            lambda: build_semantic_job_fit_request(
                request_id="fit-prohibited-inference",
                profile_snapshot=req["profile_snapshot"],
                job_snapshot=req["job_snapshot"],
                resolved_job_evidence=req["resolved_job_evidence"],
                active_extensions=req["active_extensions"],
                semantic_proposals=req["semantic_proposals"],
            ),
            "unsupported field",
        )

    def test_missing_eligibility_language_and_location_profile_evidence_yields_unverified(self):
        req = semantic_request(profile=profile_snapshot())
        for gate in req["semantic_proposals"]["gates"]:
            gate["profile_evidence_ids"] = []

        result = analyze_semantic_job_fit(req)

        statuses = {item["gate_id"]: item["status"] for item in result["gate_assessments"]}
        self.assertEqual(statuses["eligibility"], "UNVERIFIED")
        self.assertEqual(statuses["language"], "UNVERIFIED")
        self.assertEqual(statuses["location_logistics"], "UNVERIFIED")
        self.assertFalse(result["blocked"])

    def test_gate_provenance_preserves_only_the_adjudicated_job_refs(self):
        job = job_snapshot()
        candidate = ready_candidate()
        candidate["items"].append(
            {
                "proposal_id": "proposal-second-eligibility",
                "category": "eligibility_requirements",
                "kind": "preferred",
                "quote": "Caf\u00e9 collaboration is encouraged.",
                "certainty": "explicit",
            }
        )
        understanding_request, understanding_result = understanding_pair(job, candidate)
        bundle = build_resolved_job_evidence_bundle(job, understanding_request, understanding_result)
        proposals = proposals_for_full_fit(bundle)
        proposed_id = proposals["gates"][0]["job_evidence_ids"][0]

        result = analyze_semantic_job_fit(
            semantic_request(job=job, bundle=bundle, proposals=proposals)
        )

        eligibility = next(
            item for item in result["gate_assessments"] if item["gate_id"] == "eligibility"
        )
        self.assertEqual(eligibility["status"], "PASS")
        self.assertEqual(eligibility["job_evidence_ids"], [proposed_id])

    def test_gate_ref_outside_configured_category_is_unverified(self):
        req = semantic_request()
        language_id = req["semantic_proposals"]["gates"][1]["job_evidence_ids"][0]
        req["semantic_proposals"]["gates"][0]["job_evidence_ids"] = [language_id]

        result = analyze_semantic_job_fit(req)

        eligibility = next(
            item for item in result["gate_assessments"] if item["gate_id"] == "eligibility"
        )
        self.assertEqual(eligibility["status"], "UNVERIFIED")
        self.assertEqual(eligibility["job_evidence_ids"], [])

    def test_gate_with_missing_job_evidence_is_unverified(self):
        req = semantic_request()
        req["semantic_proposals"]["gates"][0]["job_evidence_ids"] = []

        result = analyze_semantic_job_fit(req)

        eligibility = next(
            item for item in result["gate_assessments"] if item["gate_id"] == "eligibility"
        )
        self.assertEqual(eligibility["status"], "UNVERIFIED")
        self.assertEqual(eligibility["job_evidence_ids"], [])

    def test_fail_gate_requires_affirmative_profile_incompatibility_evidence(self):
        req = semantic_request()
        req["semantic_proposals"]["gates"][0]["status"] = "FAIL"
        req["semantic_proposals"]["gates"][0]["profile_evidence_ids"] = []

        result = analyze_semantic_job_fit(req)

        eligibility = next(item for item in result["gate_assessments"] if item["gate_id"] == "eligibility")
        self.assertEqual(eligibility["status"], "UNVERIFIED")
        self.assertFalse(result["blocked"])

    def test_affirmative_fail_gate_blocks_and_nulls_overall_score_and_verdict(self):
        req = semantic_request()
        req["semantic_proposals"]["gates"][0]["status"] = "FAIL"
        req["semantic_proposals"]["gates"][0]["reason"] = "Affirmative eligibility incompatibility evidence."

        result = analyze_semantic_job_fit(req)

        eligibility = next(item for item in result["gate_assessments"] if item["gate_id"] == "eligibility")
        self.assertEqual(eligibility["status"], "FAIL")
        self.assertEqual(eligibility["profile_evidence_ids"], ["clm_4444444444444444"])
        self.assertTrue(result["blocked"])
        self.assertEqual(result["blocking_gate_ids"], ["eligibility"])
        self.assertIsNone(result["overall_score"])
        self.assertIsNone(result["verdict"])

    def test_conflicted_profile_concept_produces_review_not_fabricated_certainty(self):
        profile = rich_profile()
        conflicting = copy.deepcopy(profile["claims"][0])
        conflicting["id"] = "clm_7777777777777777"
        conflicting["value"] = "Not Python"
        profile["claims"].append(conflicting)
        profile["conflicts"] = [
            {
                "id": "con_1111111111111111",
                "concept_id": "cpt_1111111111111111",
                "category": "skills",
                "field": "technical_skill",
                "variants": [
                    {
                        "value": "Python",
                        "claim_ids": ["clm_1111111111111111"],
                        "provenance": [profile["claims"][0]["source"]],
                    },
                    {
                        "value": "Not Python",
                        "claim_ids": ["clm_7777777777777777"],
                        "provenance": [conflicting["source"]],
                    },
                ],
            }
        ]
        profile["summary"]["claim_count"] = len(profile["claims"])
        profile["summary"]["conflict_count"] = 1
        req = semantic_request(profile=profile)

        result = analyze_semantic_job_fit(req)

        self.assertFalse(result["direct_matches"])
        self.assertEqual(result["status"], "NEEDS_REVIEW")
        self.assertTrue(result["human_judgment_questions"])

    def test_placeholder_profile_claim_cannot_support_match(self):
        profile = rich_profile()
        profile["claims"][0]["placeholder"] = True
        profile["summary"]["placeholder_claim_count"] = 1
        req = semantic_request(profile=profile)

        result = analyze_semantic_job_fit(req)

        self.assertFalse(result["direct_matches"])
        self.assertTrue(result["unsupported_claims"])

    def test_unresolved_required_dimension_prevents_overall_score_and_verdict(self):
        req = semantic_request()
        req["semantic_proposals"]["matches"] = [req["semantic_proposals"]["matches"][0]]

        result = analyze_semantic_job_fit(req)

        experience = next(
            item for item in result["dimension_assessments"]
            if item["dimension_id"] == "experience_match"
        )
        self.assertEqual(experience["status"], "NEEDS_REVIEW")
        self.assertIsNone(result["overall_score"])
        self.assertIsNone(result["verdict"])

    def test_behavioral_and_career_dimensions_have_no_evidence_free_defaults(self):
        result = analyze_semantic_job_fit(semantic_request())

        by_id = {item["dimension_id"]: item for item in result["dimension_assessments"]}
        for dimension_id in ("behavioral_fit", "career_alignment"):
            self.assertEqual(by_id[dimension_id]["status"], "NEEDS_REVIEW")
            self.assertIsNone(by_id[dimension_id]["score"])
            self.assertNotIn(dimension_id, result["dimension_scores"])
        self.assertIsNone(result["overall_score"])
        self.assertIsNone(result["verdict"])

    def test_one_strong_match_cannot_hide_unresolved_material_evidence(self):
        job = job_snapshot()
        candidate = ready_candidate()
        candidate["items"].append(
            {
                "proposal_id": "proposal-second-requirement",
                "category": "requirements",
                "kind": "required",
                "quote": "You will mentor junior engineers.",
                "certainty": "explicit",
            }
        )
        understanding_request, understanding_result = understanding_pair(job, candidate)
        bundle = build_resolved_job_evidence_bundle(job, understanding_request, understanding_result)

        result = analyze_semantic_job_fit(semantic_request(job=job, bundle=bundle))

        technical = next(
            item
            for item in result["dimension_assessments"]
            if item["dimension_id"] == "technical_skills"
        )
        self.assertEqual(technical["status"], "NEEDS_REVIEW")
        self.assertIsNone(technical["score"])
        self.assertEqual(len(technical["job_evidence_ids"]), 2)
        self.assertNotIn("technical_skills", result["dimension_scores"])

    def test_fully_resolved_case_produces_deterministic_weighted_score_and_verdict(self):
        req = semantic_request(semantic_policy=fully_scoring_policy())

        result = analyze_semantic_job_fit(req)

        validate_semantic_job_fit_result(req, result)
        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["dimension_scores"]["technical_skills"], 90.0)
        self.assertEqual(result["dimension_scores"]["experience_match"], 82.0)
        self.assertEqual(result["dimension_scores"]["behavioral_fit"], 80.0)
        self.assertEqual(result["dimension_scores"]["career_alignment"], 90.0)
        self.assertEqual(result["overall_score"], 86.5)
        self.assertEqual(result["verdict"]["id"], "strong_fit")

    def test_end_to_end_synthetic_fit_traces_every_positive_conclusion_to_evidence(self):
        job = job_snapshot()
        understanding_request, understanding_result = understanding_pair(job)
        bundle = build_resolved_job_evidence_bundle(
            job,
            understanding_request,
            understanding_result,
        )
        req = semantic_request(
            job=job,
            bundle=bundle,
            semantic_policy=fully_scoring_policy(),
        )

        result = analyze_semantic_job_fit(req)

        profile_ids = {claim["id"] for claim in req["profile_snapshot"]["claims"]}
        job_ids = {item["id"] for item in req["resolved_job_evidence"]["evidence"]}
        for collection in (
            "direct_matches",
            "functionally_equivalent_matches",
            "transferable_matches",
        ):
            for match in result[collection]:
                self.assertTrue(match["job_requirement_ids"])
                self.assertTrue(match["profile_evidence_ids"])
                self.assertLessEqual(set(match["job_requirement_ids"]), job_ids)
                self.assertLessEqual(set(match["profile_evidence_ids"]), profile_ids)

        self.assertEqual(result["direct_matches"][0]["job_requirement_ids"], ["jobev_req_python"])
        self.assertTrue(result["functionally_equivalent_matches"][0]["job_requirement_ids"][0].startswith("juev_"))
        self.assertFalse(result["transferable_matches"])
        self.assertEqual(result["overall_score"], 86.5)
        self.assertEqual(result["verdict"]["id"], "strong_fit")

    def test_v0_job_fit_contract_remains_untouched_for_existing_callers(self):
        from product.job_fit import JOB_FIT_REQUEST_VERSION, build_job_fit_result
        from tests.test_job_fit import analysis, request

        result = build_job_fit_result(request(), analysis())

        self.assertEqual(request()["schema_version"], JOB_FIT_REQUEST_VERSION)
        self.assertEqual(result["schema_version"], "job-fit-result.v0")


if __name__ == "__main__":
    unittest.main()
