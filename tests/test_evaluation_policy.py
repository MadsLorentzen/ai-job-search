"""Tests for the deterministic Evaluation Policy v0 product contract."""

import copy
import io
import json
import math
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import product.evaluation_policy as evaluation_policy
from product.evaluation_policy import (
    EXPERIENCE_MATCH_CLASSES,
    GATE_STATUSES,
    POLICY_PATH,
    SCHEMA_PATH,
    SCHEMA_VERSION,
    EvaluationPolicyValidationError,
    calculate_overall_score,
    classify_verdict,
    evaluate_scores,
    load_evaluation_policy,
    main,
    normalized_evaluation_policy_json,
    validate_evaluation_policy,
    validate_experience_class,
)


def valid_policy() -> dict:
    return copy.deepcopy(load_evaluation_policy())


def valid_scores() -> dict:
    return {
        "technical_skills": 80,
        "experience_match": 70,
        "behavioral_fit": 60,
        "career_alignment": 90,
    }


def passing_gates() -> dict:
    return {
        "eligibility": "PASS",
        "language": "PASS",
        "location_logistics": "PASS",
    }


class EvaluationPolicyTests(unittest.TestCase):
    def assert_policy_invalid(self, policy, message_fragment=None):
        with self.assertRaises(EvaluationPolicyValidationError) as context:
            validate_evaluation_policy(policy)
        if message_fragment:
            self.assertIn(message_fragment, str(context.exception))

    def assert_input_invalid(self, callback, message_fragment=None):
        with self.assertRaises(EvaluationPolicyValidationError) as context:
            callback()
        if message_fragment:
            self.assertIn(message_fragment, str(context.exception))

    def test_valid_policy_loads(self):
        policy = load_evaluation_policy()

        self.assertEqual(policy["schema_version"], SCHEMA_VERSION)
        self.assertEqual(policy["id"], "default_job_fit_policy")

    def test_machine_readable_policy_is_valid_json_and_versioned(self):
        policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))

        self.assertEqual(policy["schema_version"], "evaluation-policy.v0")
        self.assertEqual(
            policy["methodology_reference"],
            ".claude/skills/job-application-assistant/04-job-evaluation.md",
        )

    def test_schema_is_canonical_for_shared_enums(self):
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

        self.assertEqual(
            GATE_STATUSES,
            set(schema["properties"]["gate_statuses"]["items"]["enum"]),
        )
        self.assertEqual(
            EXPERIENCE_MATCH_CLASSES,
            set(schema["properties"]["experience_match_classes"]["items"]["enum"]),
        )

    def test_unsupported_policy_version_rejected(self):
        policy = valid_policy()
        policy["schema_version"] = "evaluation-policy.v1"

        self.assert_policy_invalid(policy, "unsupported policy version")

    def test_weights_sum_correctly(self):
        policy = valid_policy()

        self.assertEqual(sum(item["weight"] for item in policy["dimensions"]), 1.0)
        validate_evaluation_policy(policy)

    def test_invalid_weight_total_rejected(self):
        policy = valid_policy()
        policy["dimensions"][0]["weight"] = 0.31

        self.assert_policy_invalid(policy, "weights must sum to 1.0")

    def test_duplicate_dimensions_rejected(self):
        policy = valid_policy()
        duplicate = copy.deepcopy(policy["dimensions"][0])
        policy["dimensions"].append(duplicate)

        self.assert_policy_invalid(policy, "duplicate dimension id")

    def test_duplicate_gates_rejected(self):
        policy = valid_policy()
        duplicate = copy.deepcopy(policy["gates"][0])
        policy["gates"].append(duplicate)

        self.assert_policy_invalid(policy, "duplicate gate id")

    def test_score_below_zero_rejected(self):
        scores = valid_scores()
        scores["technical_skills"] = -0.1

        self.assert_input_invalid(lambda: calculate_overall_score(scores), "between 0 and 100")

    def test_score_above_100_rejected(self):
        scores = valid_scores()
        scores["technical_skills"] = 100.1

        self.assert_input_invalid(lambda: calculate_overall_score(scores), "between 0 and 100")

    def test_non_numeric_score_rejected(self):
        scores = valid_scores()
        scores["technical_skills"] = "high"

        self.assert_input_invalid(lambda: calculate_overall_score(scores), "must be numeric")

    def test_numeric_string_score_rejected(self):
        scores = valid_scores()
        scores["technical_skills"] = "80"

        self.assert_input_invalid(lambda: calculate_overall_score(scores), "must be numeric")

    def test_nan_rejected(self):
        scores = valid_scores()
        scores["technical_skills"] = math.nan

        self.assert_input_invalid(lambda: calculate_overall_score(scores), "must be finite")

    def test_infinity_rejected(self):
        scores = valid_scores()
        scores["technical_skills"] = math.inf

        self.assert_input_invalid(lambda: calculate_overall_score(scores), "must be finite")

    def test_missing_dimension_rejected(self):
        scores = valid_scores()
        del scores["career_alignment"]

        self.assert_input_invalid(lambda: calculate_overall_score(scores), "required score is missing")

    def test_unknown_dimension_rejected(self):
        scores = valid_scores()
        scores["salary"] = 100

        self.assert_input_invalid(lambda: calculate_overall_score(scores), "unknown scored dimension")

    def test_weighted_score_calculation_correct(self):
        self.assertEqual(calculate_overall_score(valid_scores()), 77.5)

    def test_deterministic_rounding_half_up_to_one_decimal(self):
        scores = {
            "technical_skills": 70.15,
            "experience_match": 70.15,
            "behavioral_fit": 70.15,
            "career_alignment": 70.15,
        }

        self.assertEqual(calculate_overall_score(scores), 70.2)

    def test_strong_fit_boundary_75(self):
        self.assertEqual(classify_verdict(75)["id"], "strong_fit")

    def test_good_fit_boundaries_60_and_74x(self):
        self.assertEqual(classify_verdict(60)["id"], "good_fit")
        self.assertEqual(classify_verdict(74.9)["id"], "good_fit")

    def test_moderate_fit_boundary_45(self):
        self.assertEqual(classify_verdict(45)["id"], "moderate_fit")

    def test_weak_fit_boundary_30(self):
        self.assertEqual(classify_verdict(30)["id"], "weak_fit")

    def test_poor_fit_below_30(self):
        self.assertEqual(classify_verdict(29.9)["id"], "poor_fit")

    def test_hard_gate_fail_blocks_result(self):
        result = evaluate_scores(
            valid_scores(),
            {**passing_gates(), "eligibility": {"status": "FAIL", "reason": "Citizenship required."}},
        )

        self.assertTrue(result["blocked"])
        self.assertEqual(result["blocking_gate_ids"], ["eligibility"])
        self.assertIsNone(result["overall_score"])
        self.assertIsNone(result["verdict"])

    def test_hard_gate_fail_does_not_hide_malformed_dimension_scores(self):
        cases = [
            ("missing", lambda scores: scores.pop("career_alignment")),
            ("unknown", lambda scores: scores.__setitem__("salary", 100)),
            ("non_numeric", lambda scores: scores.__setitem__("technical_skills", "high")),
            ("nan", lambda scores: scores.__setitem__("technical_skills", math.nan)),
            ("infinity", lambda scores: scores.__setitem__("technical_skills", math.inf)),
            ("below_range", lambda scores: scores.__setitem__("technical_skills", -1)),
            ("above_range", lambda scores: scores.__setitem__("technical_skills", 101)),
        ]
        for label, mutate in cases:
            with self.subTest(case=label):
                scores = valid_scores()
                mutate(scores)
                self.assert_input_invalid(
                    lambda: evaluate_scores(
                        scores,
                        {**passing_gates(), "eligibility": "FAIL"},
                    )
                )

    def test_flag_does_not_block(self):
        result = evaluate_scores(
            valid_scores(),
            {**passing_gates(), "language": {"status": "FLAG", "reason": "Posting asks fluent English."}},
        )

        self.assertFalse(result["blocked"])
        self.assertEqual(result["overall_score"], 77.5)
        self.assertEqual(result["flags"][0]["gate_id"], "language")

    def test_unverified_does_not_block_unless_policy_says_otherwise(self):
        result = evaluate_scores(valid_scores(), {**passing_gates(), "eligibility": "UNVERIFIED"})

        self.assertFalse(result["blocked"])
        self.assertEqual(result["overall_score"], 77.5)

        policy = valid_policy()
        policy["gates"][0]["blocking_statuses"].append("UNVERIFIED")
        policy["gates"][0]["proceed_statuses"].remove("UNVERIFIED")
        validate_evaluation_policy(policy)
        result = evaluate_scores(valid_scores(), {**passing_gates(), "eligibility": "UNVERIFIED"}, policy)

        self.assertTrue(result["blocked"])
        self.assertEqual(result["blocking_gate_ids"], ["eligibility"])

    def test_gate_status_arrays_reject_wrong_structural_types_without_raw_exceptions(self):
        malformed_values = [None, {}, "FAIL", 1]
        fields = [
            "blocking_statuses",
            "warning_statuses",
            "unverified_statuses",
            "proceed_statuses",
        ]
        for field in fields:
            for value in malformed_values:
                with self.subTest(field=field, value=repr(value)):
                    policy = valid_policy()
                    policy["gates"][0][field] = value
                    self.assert_policy_invalid(policy, "must be an array")

    def test_contradictory_blocking_and_proceeding_gate_status_rejected(self):
        policy = valid_policy()
        policy["gates"][0]["blocking_statuses"].append("UNVERIFIED")

        self.assert_policy_invalid(policy, "blocking_statuses and proceed_statuses overlap")

    def test_multiple_blocking_gates_reported(self):
        result = evaluate_scores(
            valid_scores(),
            {
                "eligibility": "FAIL",
                "language": "FAIL",
                "location_logistics": "PASS",
            },
        )

        self.assertEqual(result["blocking_gate_ids"], ["eligibility", "language"])

    def test_unknown_gate_result_rejected(self):
        self.assert_input_invalid(
            lambda: evaluate_scores(valid_scores(), {**passing_gates(), "eligibility": "MAYBE"}),
            "unknown gate status",
        )

    def test_unknown_gate_id_rejected(self):
        self.assert_input_invalid(
            lambda: evaluate_scores(valid_scores(), {**passing_gates(), "salary": "PASS"}),
            "unknown gate id",
        )

    def test_functional_experience_class_enum_validates(self):
        for value in (
            "direct",
            "functionally_equivalent",
            "transferable",
            "adjacent",
            "unsupported",
        ):
            validate_experience_class(value)

        self.assert_input_invalid(lambda: validate_experience_class("same_title"), "experience_class")

    def test_literal_title_equality_alone_is_not_represented_as_evidence(self):
        policy = valid_policy()

        self.assertNotIn("same_title", policy["experience_match_classes"])
        self.assertFalse(
            any("title" in item for item in policy["experience_match_classes"])
        )
        self.assertIn("responsibilities", policy["dimensions"][1]["description"])

    def test_valid_structured_functionally_equivalent_classification(self):
        classification = {
            "classification": "functionally_equivalent",
            "basis": [
                "responsibilities materially align",
                "competencies materially align",
            ],
            "title_similarity_only": False,
        }

        validate_experience_class(classification["classification"])
        self.assertFalse(classification["title_similarity_only"])

    def test_deterministic_normalized_policy_output(self):
        policy = valid_policy()
        reordered = {key: copy.deepcopy(policy[key]) for key in reversed(policy)}

        self.assertEqual(
            normalized_evaluation_policy_json(policy),
            normalized_evaluation_policy_json(reordered),
        )

    def test_verdict_threshold_gap_rejected(self):
        policy = valid_policy()
        policy["verdict_thresholds"][1]["min_score"] = 31

        self.assert_policy_invalid(policy, "expected contiguous lower bound")

    def test_verdict_threshold_overlap_rejected(self):
        policy = valid_policy()
        policy["verdict_thresholds"][0]["max_score_exclusive"] = 31

        self.assert_policy_invalid(policy, "expected contiguous lower bound")

    def test_score_band_gap_rejected(self):
        policy = valid_policy()
        policy["dimensions"][0]["bands"][1]["min_score"] = 41

        self.assert_policy_invalid(policy, "expected contiguous lower bound")

    def test_dimension_score_boolean_rejected(self):
        scores = valid_scores()
        scores["technical_skills"] = True

        self.assert_input_invalid(lambda: calculate_overall_score(scores), "must be numeric")

    def test_default_missing_gate_results_are_unverified_and_nonblocking(self):
        result = evaluate_scores(valid_scores())

        self.assertFalse(result["blocked"])
        self.assertEqual(
            [item["status"] for item in result["gate_results"]],
            ["UNVERIFIED", "UNVERIFIED", "UNVERIFIED"],
        )

    def test_list_gate_results_supported_and_duplicate_rejected(self):
        gate_results = [
            {"gate_id": "eligibility", "status": "PASS"},
            {"gate_id": "language", "status": "PASS"},
            {"gate_id": "location_logistics", "status": "PASS"},
        ]

        self.assertFalse(evaluate_scores(valid_scores(), gate_results)["blocked"])

        duplicate = gate_results + [{"gate_id": "language", "status": "PASS"}]
        self.assert_input_invalid(
            lambda: evaluate_scores(valid_scores(), duplicate),
            "duplicate gate result",
        )

    def test_cli_validate_success_and_score(self):
        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = main(["validate"])

        self.assertEqual(exit_code, 0)
        self.assertTrue(json.loads(output.getvalue())["valid"])

        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = main(["score", json.dumps(valid_scores())])

        self.assertEqual(exit_code, 0)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["overall_score"], 77.5)
        self.assertEqual(payload["verdict"]["id"], "strong_fit")

    def test_cli_failure_is_nonzero_and_machine_readable(self):
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "policy.json"
            policy = valid_policy()
            policy["schema_version"] = "unsupported"
            path.write_text(json.dumps(policy), encoding="utf-8")
            error = io.StringIO()

            with redirect_stderr(error):
                exit_code = main(["validate", str(path)])

        self.assertEqual(exit_code, 1)
        payload = json.loads(error.getvalue())
        self.assertFalse(payload["valid"])
        self.assertTrue(payload["errors"])

    def test_salary_is_not_a_scored_dimension(self):
        policy = valid_policy()

        self.assertNotIn("salary", {item["id"] for item in policy["dimensions"]})

    def test_schema_and_python_reject_unknown_policy_fields(self):
        policy = valid_policy()
        policy["llm_prompt"] = "score this candidate"

        self.assert_policy_invalid(policy, "unsupported field")

    def test_python_identifier_validation_uses_schema_pattern(self):
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            evaluation_policy.ID_RE.pattern,
            schema["$defs"]["id"]["pattern"],
        )

    def test_policy_id_must_match_schema_identifier_pattern(self):
        policy = valid_policy()
        policy["id"] = "Default Job Fit Policy"

        self.assert_policy_invalid(policy, "schema id pattern")

    def test_gate_dimension_verdict_and_band_ids_match_schema_identifier_pattern(self):
        cases = [
            ("gate", lambda policy: policy["gates"][0].__setitem__("id", "Eligibility")),
            (
                "dimension",
                lambda policy: policy["dimensions"][0].__setitem__(
                    "id", "technical-skills"
                ),
            ),
            (
                "verdict",
                lambda policy: policy["verdict_thresholds"][0].__setitem__(
                    "id", "poor fit"
                ),
            ),
            (
                "band",
                lambda policy: policy["dimensions"][0]["bands"][0].__setitem__(
                    "label", "fundamental-mismatch"
                ),
            ),
        ]
        for label, mutate in cases:
            with self.subTest(identifier=label):
                policy = valid_policy()
                mutate(policy)
                self.assert_policy_invalid(policy, "schema id pattern")


if __name__ == "__main__":
    unittest.main()
