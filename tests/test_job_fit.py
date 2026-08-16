"""Tests for Job Fit Contract v0 reference integrity."""

import copy
import io
import json
import math
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from product.evaluation_policy import load_evaluation_policy
from product.extensions import SCHEMA_VERSION as EXTENSION_SCHEMA_VERSION
from product.extensions import extension_content_id
from product.job_fit import (
    JOB_FIT_REQUEST_VERSION,
    JOB_FIT_RESULT_VERSION,
    JOB_POSTING_SNAPSHOT_VERSION,
    JobFitValidationError,
    build_job_fit_result,
    main,
    normalized_job_fit_result_json,
    validate_job_fit_request,
    validate_job_fit_result,
    validate_job_posting_snapshot,
)
from product.profile_snapshot import ID_SEMANTICS, SCHEMA_VERSION as PROFILE_SCHEMA_VERSION


def profile_snapshot() -> dict:
    claims = [
        {
            "id": "clm_1111111111111111",
            "record_id": "rec_1111111111111111",
            "concept_id": "cpt_1111111111111111",
            "category": "skills",
            "field": "technical_skill",
            "value": "Python",
            "source": {
                "file": "CLAUDE.md",
                "section": "Candidate Profile > Skills",
                "line_start": 10,
                "line_end": 10,
            },
            "placeholder": False,
            "confidence": "high",
            "extraction_status": "explicit",
        },
        {
            "id": "clm_2222222222222222",
            "record_id": "rec_2222222222222222",
            "concept_id": "cpt_2222222222222222",
            "category": "employment",
            "field": "responsibility_or_achievement",
            "value": "Built production data pipelines",
            "source": {
                "file": "CLAUDE.md",
                "section": "Candidate Profile > Experience",
                "line_start": 20,
                "line_end": 20,
            },
            "placeholder": False,
            "confidence": "high",
            "extraction_status": "explicit",
        },
        {
            "id": "clm_3333333333333333",
            "record_id": "rec_3333333333333333",
            "concept_id": "cpt_3333333333333333",
            "category": "education",
            "field": "qualification",
            "value": "Synthetic MSc",
            "source": {
                "file": "CLAUDE.md",
                "section": "Candidate Profile > Education",
                "line_start": 30,
                "line_end": 30,
            },
            "placeholder": False,
            "confidence": "high",
            "extraction_status": "explicit",
        },
    ]
    return {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "id_semantics": ID_SEMANTICS,
        "sources": [
            {
                "file": "CLAUDE.md",
                "sha256": "a" * 64,
                "line_count": 40,
            }
        ],
        "claims": claims,
        "corroborations": [],
        "conflicts": [],
        "summary": {
            "source_count": 1,
            "claim_count": len(claims),
            "placeholder_claim_count": 0,
            "corroboration_count": 0,
            "conflict_count": 0,
        },
    }


def job_snapshot() -> dict:
    return {
        "schema_version": JOB_POSTING_SNAPSHOT_VERSION,
        "job_id": "job-001",
        "source": "synthetic",
        "source_url": "https://example.test/jobs/1",
        "captured_at": "2026-08-16T12:00:00Z",
        "company": "Example Corp",
        "title": "Data Scientist",
        "location": "Remote",
        "employment_type": "Full time",
        "description": "Synthetic posting.",
        "raw_text": "Strong Python experience. Build data pipelines.",
        "requirements": [
            {"id": "req-python", "text": "Strong Python experience", "kind": "required"},
            {"id": "req-cert", "text": "Professional certification", "kind": "preferred"},
        ],
        "responsibilities": [
            {"id": "resp-pipelines", "text": "Build data pipelines", "kind": "required"}
        ],
        "language_requirements": [
            {"id": "lang-english", "text": "English required", "kind": "required"}
        ],
        "eligibility_requirements": [],
        "logistics_requirements": [],
        "compensation": {"text": "Not stated"},
        "metadata": {"fixture": True},
    }


def extension() -> dict:
    return {
        "schema_version": EXTENSION_SCHEMA_VERSION,
        "id": "data-transfer",
        "name": "Data Transfer",
        "version": "0.1.0",
        "status": "reviewed",
        "description": "Synthetic professional knowledge.",
        "publisher": {"name": "Example", "type": "organization"},
        "trust": {"level": "community-reviewed"},
        "metadata": {"created_date": "2026-08-16", "reviewed_date": None},
        "scope": {},
        "sources": [
            {
                "id": "guide",
                "title": "Synthetic Guide",
                "publisher": "Example",
                "source_type": "industry-guidance",
            }
        ],
        "competencies": [
            {
                "id": "pipeline-design",
                "name": "Pipeline design",
                "description": "Design data pipelines.",
                "category": "data",
                "source_ids": ["guide"],
            }
        ],
        "transferable_mappings": [
            {
                "id": "field-models-to-pipelines",
                "source": {"concept": "field modelling"},
                "target": {"competency_id": "pipeline-design"},
                "rationale": "Model workflow design can support pipeline reasoning.",
                "transfer_strength": "moderate",
                "limitations": ["Does not prove employment history"],
                "conditions": ["Candidate evidence exists"],
                "evidence_requirements": ["Concrete workflow example"],
                "source_ids": ["guide"],
            }
        ],
        "disallowed_mappings": [
            {
                "id": "transfer-does-not-imply-certification",
                "source_concept": "pipeline knowledge",
                "prohibited_inference": "professional-certification",
                "rationale": "Knowledge is not proof of certification.",
                "source_ids": ["guide"],
            }
        ],
    }


def request(active_extensions=None) -> dict:
    return {
        "schema_version": JOB_FIT_REQUEST_VERSION,
        "request_id": "fit-001",
        "profile_snapshot": profile_snapshot(),
        "job_snapshot": job_snapshot(),
        "active_extensions": [extension()] if active_extensions is None else active_extensions,
        "evaluation_policy": load_evaluation_policy(),
        "user_intent": {"intent": "evaluate_with_transferability"},
    }


def scores() -> dict:
    return {
        "technical_skills": 80,
        "experience_match": 70,
        "behavioral_fit": 60,
        "career_alignment": 90,
    }


def direct_match(match_id="match-direct") -> dict:
    return {
        "match_id": match_id,
        "job_requirement_ids": ["req-python"],
        "profile_evidence_ids": ["clm_1111111111111111"],
        "classification": "direct",
        "rationale": "Both sides explicitly mention Python.",
        "confidence": "high",
        "status": "READY",
    }


def functional_match() -> dict:
    return {
        "match_id": "match-functional",
        "job_requirement_ids": ["resp-pipelines"],
        "profile_evidence_ids": ["clm_2222222222222222"],
        "classification": "functionally_equivalent",
        "rationale": "Responsibilities materially align.",
        "confidence": "medium",
        "status": "READY",
        "functional_basis": {
            "responsibility_alignment": ["Built pipelines", "Build data pipelines"],
            "competency_alignment": ["workflow design"],
            "title_similarity_only": False,
        },
    }


def extension_ref(record_id="field-models-to-pipelines") -> dict:
    return {
        "extension_id": "data-transfer",
        "extension_version": "0.1.0",
        "record_type": "transferable_mapping",
        "record_id": record_id,
    }


def transferable_match() -> dict:
    return {
        "match_id": "match-transfer",
        "job_requirement_ids": ["resp-pipelines"],
        "profile_evidence_ids": ["clm_2222222222222222"],
        "classification": "transferable",
        "extension_ref": extension_ref(),
        "transferable_mapping_id": "field-models-to-pipelines",
        "rationale": "Candidate evidence plus extension mapping support transferability.",
        "limitations": ["Does not prove employment history"],
        "conditions": ["Candidate evidence exists"],
        "confidence": "medium",
        "status": "READY",
    }


def analysis() -> dict:
    return {
        "gate_results": {
            "eligibility": "PASS",
            "language": "PASS",
            "location_logistics": "PASS",
        },
        "dimension_scores": scores(),
        "direct_matches": [],
        "functionally_equivalent_matches": [],
        "transferable_matches": [],
        "gaps": [],
        "unsupported_claims": [],
        "human_judgment_questions": [],
        "notes": [],
    }


class JobFitContractTests(unittest.TestCase):
    def assert_invalid(self, callback, fragment=None):
        with self.assertRaises(JobFitValidationError) as context:
            callback()
        if fragment:
            self.assertIn(fragment, str(context.exception))

    def test_minimal_valid_job_posting_snapshot(self):
        snapshot = {
            "schema_version": JOB_POSTING_SNAPSHOT_VERSION,
            "job_id": "job-min",
            "source": "synthetic",
            "captured_at": "2026-08-16T12:00:00Z",
            "company": "Example",
            "title": "Engineer",
            "requirements": [],
            "responsibilities": [],
        }

        validate_job_posting_snapshot(snapshot)

    def test_richer_job_posting_snapshot_validates(self):
        validate_job_posting_snapshot(job_snapshot())

    def test_duplicate_job_evidence_ids_rejected(self):
        snapshot = job_snapshot()
        snapshot["responsibilities"][0]["id"] = "req-python"

        self.assert_invalid(lambda: validate_job_posting_snapshot(snapshot), "duplicate job evidence id")

    def test_valid_job_fit_request(self):
        validate_job_fit_request(request())

    def test_invalid_profile_snapshot_rejected_through_existing_validator(self):
        req = request()
        req["profile_snapshot"]["summary"]["claim_count"] = 99

        self.assert_invalid(lambda: validate_job_fit_request(req), "$.profile_snapshot")

    def test_invalid_extension_rejected_through_existing_validator(self):
        req = request()
        req["active_extensions"][0]["schema_version"] = "extension-package.v1"

        self.assert_invalid(lambda: validate_job_fit_request(req), "$.active_extensions[0]")

    def test_invalid_evaluation_policy_rejected_through_existing_validator(self):
        req = request()
        req["evaluation_policy"]["schema_version"] = "evaluation-policy.v1"

        self.assert_invalid(lambda: validate_job_fit_request(req), "$.evaluation_policy")

    def test_duplicate_active_extension_rejected(self):
        ext = extension()
        req = request([ext, copy.deepcopy(ext)])

        self.assert_invalid(lambda: validate_job_fit_request(req), "duplicate extension")

    def test_direct_match_with_valid_profile_and_job_evidence(self):
        data = analysis()
        data["direct_matches"] = [direct_match()]

        validate_job_fit_result(request(), build_job_fit_result(request(), data))

    def test_direct_match_with_unknown_profile_evidence_rejected(self):
        data = analysis()
        match = direct_match()
        match["profile_evidence_ids"] = ["clm_missing"]
        data["direct_matches"] = [match]

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "unknown profile evidence id")

    def test_direct_match_with_unknown_job_evidence_rejected(self):
        data = analysis()
        match = direct_match()
        match["job_requirement_ids"] = ["req-missing"]
        data["direct_matches"] = [match]

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "unknown job evidence id")

    def test_functionally_equivalent_match_validates_with_structured_basis(self):
        data = analysis()
        data["functionally_equivalent_matches"] = [functional_match()]

        validate_job_fit_result(request(), build_job_fit_result(request(), data))

    def test_title_equality_alone_cannot_establish_functional_equivalence(self):
        data = analysis()
        match = functional_match()
        match["functional_basis"] = {
            "responsibility_alignment": [],
            "competency_alignment": [],
            "title_similarity_only": True,
        }
        data["functionally_equivalent_matches"] = [match]

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "title_similarity_only")

    def test_transferable_match_with_valid_active_extension_mapping(self):
        data = analysis()
        data["transferable_matches"] = [transferable_match()]

        validate_job_fit_result(request(), build_job_fit_result(request(), data))

    def test_transferable_match_with_inactive_extension_rejected(self):
        data = analysis()
        match = transferable_match()
        match["extension_ref"]["extension_id"] = "inactive"
        data["transferable_matches"] = [match]

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "unknown active extension")

    def test_transferable_match_with_unknown_mapping_id_rejected(self):
        data = analysis()
        match = transferable_match()
        match["transferable_mapping_id"] = "missing-map"
        match["extension_ref"] = extension_ref("missing-map")
        data["transferable_matches"] = [match]

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "unknown transferable mapping id")

    def test_transferable_match_cannot_establish_certification_from_extension_alone(self):
        data = analysis()
        match = transferable_match()
        match["asserts_candidate_facts"] = [
            {"type": "professional-certification", "profile_evidence_ids": []}
        ]
        data["transferable_matches"] = [match]

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "candidate-specific facts require profile evidence")

    def test_explicit_prohibited_inference_boundary_enforced(self):
        data = analysis()
        match = transferable_match()
        match["asserts_candidate_facts"] = [
            {
                "type": "professional-certification",
                "profile_evidence_ids": ["clm_3333333333333333"],
            }
        ]
        data["transferable_matches"] = [match]

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "prohibited inference boundary")

    def test_missing_evidence_represented_as_gap_not_fabricated_negative_fact(self):
        data = analysis()
        data["gaps"] = [
            {
                "gap_id": "gap-cert",
                "job_requirement_ids": ["req-cert"],
                "gap_type": "missing_evidence",
                "evidence_status": "NEEDS_REVIEW",
                "notes": "Certification is not evidenced in the supplied profile snapshot.",
            }
        ]

        result = build_job_fit_result(request(), data)

        self.assertEqual(result["gaps"][0]["evidence_status"], "NEEDS_REVIEW")

    def test_unsupported_claim_validates(self):
        data = analysis()
        data["unsupported_claims"] = [
            {
                "claim_id": "claim-cert",
                "claim_text": "Candidate holds the certification.",
                "reason": "No profile evidence supports this claim.",
                "attempted_profile_evidence_ids": [],
                "attempted_extension_refs": [extension_ref()],
                "status": "UNSUPPORTED",
            }
        ]

        validate_job_fit_result(request(), build_job_fit_result(request(), data))

    def test_human_judgment_question_validates(self):
        data = analysis()
        data["human_judgment_questions"] = [
            {
                "question_id": "question-language",
                "topic": "language",
                "question": "Does the stated English requirement exceed the candidate level?",
                "related_job_ids": ["lang-english"],
                "related_profile_evidence_ids": [],
                "status": "NEEDS_REVIEW",
            }
        ]

        validate_job_fit_result(request(), build_job_fit_result(request(), data))

    def test_duplicate_match_ids_rejected(self):
        data = analysis()
        data["direct_matches"] = [direct_match(), direct_match()]

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "duplicate id")

    def test_duplicate_match_ids_across_match_types_rejected(self):
        data = analysis()
        functional = functional_match()
        functional["match_id"] = "match-direct"
        data["direct_matches"] = [direct_match()]
        data["functionally_equivalent_matches"] = [functional]

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "duplicate match id")

    def test_duplicate_gaps_questions_and_unsupported_claim_ids_rejected(self):
        cases = [
            (
                "gaps",
                [
                    {
                        "gap_id": "dup",
                        "job_requirement_ids": ["req-cert"],
                        "gap_type": "missing_evidence",
                        "evidence_status": "NEEDS_REVIEW",
                        "notes": "Missing.",
                    },
                    {
                        "gap_id": "dup",
                        "job_requirement_ids": ["req-python"],
                        "gap_type": "partial_match",
                        "evidence_status": "NEEDS_REVIEW",
                        "notes": "Partial.",
                    },
                ],
            ),
            (
                "human_judgment_questions",
                [
                    {
                        "question_id": "dup",
                        "topic": "language",
                        "question": "Question one?",
                        "related_job_ids": [],
                        "related_profile_evidence_ids": [],
                        "status": "NEEDS_REVIEW",
                    },
                    {
                        "question_id": "dup",
                        "topic": "eligibility",
                        "question": "Question two?",
                        "related_job_ids": [],
                        "related_profile_evidence_ids": [],
                        "status": "NEEDS_REVIEW",
                    },
                ],
            ),
            (
                "unsupported_claims",
                [
                    {
                        "claim_id": "dup",
                        "claim_text": "Claim one.",
                        "reason": "Unsupported.",
                        "attempted_profile_evidence_ids": [],
                        "attempted_extension_refs": [],
                        "status": "UNSUPPORTED",
                    },
                    {
                        "claim_id": "dup",
                        "claim_text": "Claim two.",
                        "reason": "Unsupported.",
                        "attempted_profile_evidence_ids": [],
                        "attempted_extension_refs": [],
                        "status": "UNSUPPORTED",
                    },
                ],
            ),
        ]
        for field, records in cases:
            with self.subTest(field=field):
                data = analysis()
                data[field] = records
                self.assert_invalid(lambda: build_job_fit_result(request(), data), "duplicate id")

    def test_gate_fail_produces_blocked_structured_result(self):
        data = analysis()
        data["gate_results"]["eligibility"] = "FAIL"

        result = build_job_fit_result(request(), data)

        self.assertTrue(result["blocked"])
        self.assertIsNone(result["overall_score"])
        self.assertIsNone(result["verdict"])
        self.assertEqual(result["blocking_gate_ids"], ["eligibility"])

    def test_malformed_score_still_rejected_even_when_gate_fails(self):
        data = analysis()
        data["gate_results"]["eligibility"] = "FAIL"
        data["dimension_scores"]["technical_skills"] = math.nan

        self.assert_invalid(lambda: build_job_fit_result(request(), data), "must be finite")

    def test_flag_and_unverified_proceed_according_to_evaluation_policy(self):
        data = analysis()
        data["gate_results"]["language"] = "FLAG"
        data["gate_results"]["eligibility"] = "UNVERIFIED"

        result = build_job_fit_result(request(), data)

        self.assertFalse(result["blocked"])
        self.assertEqual(result["overall_score"], 77.5)

    def test_evaluation_score_equals_evaluation_policy_output(self):
        result = build_job_fit_result(request(), analysis())

        self.assertEqual(result["overall_score"], 77.5)
        self.assertEqual(result["verdict"]["id"], "strong_fit")

    def test_result_request_identity_mismatch_rejected(self):
        req = request()
        result = build_job_fit_result(req, analysis())
        result["request_id"] = "different"

        self.assert_invalid(lambda: validate_job_fit_result(req, result), "request_id")

    def test_result_referring_to_different_job_rejected(self):
        req = request()
        result = build_job_fit_result(req, analysis())
        result["job_snapshot"]["job_id"] = "different"

        self.assert_invalid(lambda: validate_job_fit_result(req, result), "job_snapshot")

    def test_schema_version_mismatch_rejected(self):
        req = request()
        req["schema_version"] = "job-fit-request.v1"

        self.assert_invalid(lambda: validate_job_fit_request(req), "unsupported job fit request version")

        result = build_job_fit_result(request(), analysis())
        result["schema_version"] = "job-fit-result.v1"
        self.assert_invalid(lambda: validate_job_fit_result(request(), result), "unsupported job fit result version")

    def test_deterministic_normalized_output(self):
        req = request()
        result = build_job_fit_result(req, analysis())
        reordered = {key: copy.deepcopy(result[key]) for key in reversed(result)}

        self.assertEqual(
            normalized_job_fit_result_json(req, result),
            normalized_job_fit_result_json(req, reordered),
        )

    def test_cli_invalid_input_returns_json_and_nonzero(self):
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "request.json"
            invalid = request()
            invalid["profile_snapshot"]["summary"]["claim_count"] = 99
            path.write_text(json.dumps(invalid), encoding="utf-8")
            error = io.StringIO()

            with redirect_stderr(error):
                exit_code = main(["validate-request", str(path)])

        self.assertEqual(exit_code, 1)
        payload = json.loads(error.getvalue())
        self.assertFalse(payload["valid"])
        self.assertTrue(payload["errors"])

    def test_cli_assemble_outputs_valid_result(self):
        with tempfile.TemporaryDirectory() as tempdir:
            request_path = Path(tempdir) / "request.json"
            analysis_path = Path(tempdir) / "analysis.json"
            request_path.write_text(json.dumps(request()), encoding="utf-8")
            analysis_path.write_text(json.dumps(analysis()), encoding="utf-8")
            output = io.StringIO()

            with redirect_stdout(output):
                exit_code = main(["assemble", str(request_path), str(analysis_path)])

        self.assertEqual(exit_code, 0)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["schema_version"], JOB_FIT_RESULT_VERSION)

    def test_active_extension_versions_include_content_id(self):
        result = build_job_fit_result(request(), analysis())

        self.assertEqual(
            result["active_extension_versions"][0]["content_id"],
            extension_content_id(extension()),
        )


if __name__ == "__main__":
    unittest.main()
