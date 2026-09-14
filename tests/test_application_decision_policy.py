"""Tests for the pure Application Decision Policy v0 domain classifier.

Covers Phase 1 (product/application_decision_policy.py's outcome enum,
dimension gap-id fields, fingerprint) and Phase 2 (consuming the
evidence_disposition / materiality fields product/semantic_job_fit.py now
exposes on each gate assessment). No persistence, no webapp wiring -- these
tests exercise the module in isolation, exactly as it will later be called
from a mutation boundary.
"""

import copy
import unittest

from product.application_decision_policy import (
    DEFAULT_POLICY,
    ENGINE_VERSION,
    ApplicationDecisionPolicyInputError,
    ApplicationDecisionPolicyValidationError,
    application_decision_policy_fingerprint,
    evaluate_dimension_assessment,
    evaluate_gate_assessment,
    load_application_decision_policy,
    validate_application_decision_policy,
)


def gate(
    status: str,
    *,
    evidence_disposition: str,
    materiality: str,
    job_ids=("jev_1",),
    profile_ids=("clm_1",),
) -> dict:
    return {
        "gate_id": "eligibility",
        "status": status,
        "reason": "test reason",
        "job_evidence_ids": list(job_ids),
        "profile_evidence_ids": list(profile_ids),
        "evidence_disposition": evidence_disposition,
        "materiality": materiality,
    }


def dimension(status: str, *, required: bool = True, job_ids=()) -> dict:
    return {
        "dimension_id": "technical_skills",
        "status": status,
        "required": required,
        "job_evidence_ids": list(job_ids),
    }


class GateAssessmentTests(unittest.TestCase):
    """Phase 2: classification is driven directly by evidence_disposition
    and materiality, both produced upstream by semantic_job_fit.py's
    _build_gate_assessments. These replace the conservative Phase-1
    fallback (which had to assume the worst from evidence-id presence
    alone) with a decision grounded in what the product layer actually
    knows about this specific posting and this specific candidate."""

    def test_supported_fail_gate_auto_rejects(self):
        """A gate FAIL reaching this module is, by construction (per
        semantic_job_fit.py's own downgrade-to-UNVERIFIED rule for
        unsupported FAIL proposals), already trustworthy and supported.
        It must resolve to AUTO_REJECT, never REQUIRE_USER -- regardless
        of materiality/disposition, which FAIL overrides."""
        decision = evaluate_gate_assessment(
            gate(
                "FAIL", evidence_disposition="CONFLICTING", materiality="MATERIAL",
                profile_ids=("clm_conflict_evidence",),
            )
        )
        self.assertEqual(decision.outcome, "AUTO_REJECT")
        self.assertEqual(decision.reason_code, "gate_fail_supported")

    def test_flag_gate_requires_user(self):
        """FLAG is an explicit, evidence-backed LLM-raised caveat -- this
        is the genuinely material/ambiguous case and must stay REQUIRE_USER
        regardless of materiality/disposition."""
        decision = evaluate_gate_assessment(
            gate("FLAG", evidence_disposition="SUPPORTIVE", materiality="MATERIAL")
        )
        self.assertEqual(decision.outcome, "REQUIRE_USER")
        self.assertEqual(decision.reason_code, "gate_flag")

    def test_supportive_eligibility_evidence_auto_proceeds(self):
        """Required fail-first case: affirmative, validated, non-conflicting
        supportive evidence on a material gate -- AUTO_PROCEED."""
        decision = evaluate_gate_assessment(
            gate(
                "PASS", evidence_disposition="SUPPORTIVE", materiality="MATERIAL",
                profile_ids=("clm_british_citizen",),
            )
        )
        self.assertEqual(decision.outcome, "AUTO_PROCEED")
        self.assertEqual(decision.reason_code, "gate_material_supportive")

    def test_absent_eligibility_evidence_on_material_gate_requires_user(self):
        """Required fail-first case: a genuinely material gate (this
        posting states a real eligibility requirement) with no candidate
        evidence at all must escalate -- a missing answer to a material
        question is exactly the case that must never be auto-omitted."""
        decision = evaluate_gate_assessment(
            gate(
                "UNVERIFIED", evidence_disposition="ABSENT", materiality="MATERIAL",
                profile_ids=(),
            )
        )
        self.assertEqual(decision.outcome, "REQUIRE_USER")
        self.assertEqual(decision.reason_code, "gate_material_absent")

    def test_conflicting_eligibility_evidence_requires_user(self):
        """Required fail-first case: conflicting/ambiguous evidence on a
        material gate must never be auto-resolved."""
        decision = evaluate_gate_assessment(
            gate(
                "UNVERIFIED", evidence_disposition="CONFLICTING", materiality="MATERIAL",
                profile_ids=("clm_conflicting_residency_claim",),
            )
        )
        self.assertEqual(decision.outcome, "REQUIRE_USER")
        self.assertEqual(decision.reason_code, "gate_material_conflicting")

    def test_absent_optional_language_evidence_auto_omits(self):
        """Required fail-first case: a NON_MATERIAL gate (this posting
        states no language requirement, or the policy has explicitly
        marked what evidence exists as non-material) with no candidate
        evidence -- safe to AUTO_OMIT. This is the one case where absence
        is genuinely safe to auto-resolve, and it requires NON_MATERIAL,
        never a static "language is always optional" assumption."""
        decision = evaluate_gate_assessment(
            gate(
                "UNVERIFIED", evidence_disposition="ABSENT", materiality="NON_MATERIAL",
                job_ids=(), profile_ids=(),
            )
        )
        self.assertEqual(decision.outcome, "AUTO_OMIT")
        self.assertEqual(decision.reason_code, "gate_non_material_absent")

    def test_conflicting_non_material_evidence_still_requires_user(self):
        """Conflicting evidence is never safe to silently resolve, even on
        a non-material gate -- an unresolved contradiction in the
        candidate's own evidence is a data-quality problem regardless of
        whether the gate itself is optional for this posting."""
        decision = evaluate_gate_assessment(
            gate(
                "UNVERIFIED", evidence_disposition="CONFLICTING", materiality="NON_MATERIAL",
            )
        )
        self.assertEqual(decision.outcome, "REQUIRE_USER")
        self.assertEqual(decision.reason_code, "gate_non_material_conflicting")

    def test_insufficient_evidence_on_material_gate_requires_user(self):
        """INSUFFICIENT (present but never validated toward a verdict) on
        a material gate must escalate, not be treated as either supportive
        or safely omittable."""
        decision = evaluate_gate_assessment(
            gate(
                "UNVERIFIED", evidence_disposition="INSUFFICIENT", materiality="MATERIAL",
            )
        )
        self.assertEqual(decision.outcome, "REQUIRE_USER")
        self.assertEqual(decision.reason_code, "gate_material_insufficient")

    def test_insufficient_evidence_on_non_material_gate_requires_user(self):
        """INSUFFICIENT must escalate even on a non-material gate -- unlike
        ABSENT, there is genuinely something present that was never
        vetted, which is not the same as confirmed nothing-to-omit."""
        decision = evaluate_gate_assessment(
            gate(
                "UNVERIFIED", evidence_disposition="INSUFFICIENT", materiality="NON_MATERIAL",
            )
        )
        self.assertEqual(decision.outcome, "REQUIRE_USER")
        self.assertEqual(decision.reason_code, "gate_non_material_insufficient")

    def test_not_applicable_materiality_is_not_applicable_outcome(self):
        """A gate whose category this posting never mentions at all must
        resolve NOT_APPLICABLE regardless of status/disposition -- there is
        nothing on this posting to evaluate for or against."""
        decision = evaluate_gate_assessment(
            gate(
                "UNVERIFIED", evidence_disposition="ABSENT", materiality="NOT_APPLICABLE",
                job_ids=(), profile_ids=(),
            )
        )
        self.assertEqual(decision.outcome, "NOT_APPLICABLE")
        self.assertEqual(decision.reason_code, "gate_not_applicable")

    def test_gate_evidence_ids_are_carried_through_verbatim(self):
        decision = evaluate_gate_assessment(
            gate(
                "PASS", evidence_disposition="SUPPORTIVE", materiality="MATERIAL",
                job_ids=("jev_a", "jev_b"), profile_ids=("clm_x",),
            )
        )
        self.assertEqual(decision.job_evidence_ids, ("jev_a", "jev_b"))
        self.assertEqual(decision.profile_evidence_ids, ("clm_x",))

    def test_unknown_gate_status_rejected_as_input_error(self):
        with self.assertRaises(ApplicationDecisionPolicyInputError):
            evaluate_gate_assessment(
                gate("BOGUS_STATUS", evidence_disposition="ABSENT", materiality="MATERIAL")
            )

    def test_unknown_evidence_disposition_rejected_as_input_error(self):
        with self.assertRaises(ApplicationDecisionPolicyInputError):
            evaluate_gate_assessment(
                gate("PASS", evidence_disposition="BOGUS", materiality="MATERIAL")
            )

    def test_unknown_materiality_rejected_as_input_error(self):
        with self.assertRaises(ApplicationDecisionPolicyInputError):
            evaluate_gate_assessment(
                gate("PASS", evidence_disposition="SUPPORTIVE", materiality="BOGUS")
            )

    def test_missing_gate_field_rejected_as_input_error(self):
        malformed = gate("PASS", evidence_disposition="SUPPORTIVE", materiality="MATERIAL")
        del malformed["reason"]
        with self.assertRaises(ApplicationDecisionPolicyInputError):
            evaluate_gate_assessment(malformed)

    def test_missing_evidence_disposition_field_rejected_as_input_error(self):
        malformed = gate("PASS", evidence_disposition="SUPPORTIVE", materiality="MATERIAL")
        del malformed["evidence_disposition"]
        with self.assertRaises(ApplicationDecisionPolicyInputError):
            evaluate_gate_assessment(malformed)

    def test_missing_materiality_field_rejected_as_input_error(self):
        malformed = gate("PASS", evidence_disposition="SUPPORTIVE", materiality="MATERIAL")
        del malformed["materiality"]
        with self.assertRaises(ApplicationDecisionPolicyInputError):
            evaluate_gate_assessment(malformed)


class DimensionAssessmentTests(unittest.TestCase):
    def test_ready_dimension_auto_proceeds(self):
        decision = evaluate_dimension_assessment(
            dimension("READY", job_ids=["jev_1", "jev_2"]),
            relevant_job_ids=["jev_1", "jev_2"],
            matched_job_ids=["jev_1", "jev_2"],
        )
        self.assertEqual(decision.outcome, "AUTO_PROCEED")
        self.assertEqual(decision.reason_code, "dimension_ready")

    def test_no_relevant_job_ids_is_not_applicable(self):
        """behavioral_fit / career_alignment have job_categories: [] in the
        semantic fit policy, so relevant_job_ids is always empty. This must
        classify as NOT_APPLICABLE, never AUTO_PROCEED -- there is no
        evidence to affirm, so a positive judgment would misrepresent an
        absence of signal as a supported conclusion."""
        decision = evaluate_dimension_assessment(
            dimension("NEEDS_REVIEW", job_ids=[]),
            relevant_job_ids=[],
            matched_job_ids=[],
        )
        self.assertEqual(decision.outcome, "NOT_APPLICABLE")
        self.assertEqual(decision.reason_code, "dimension_no_relevant_job_ids")

    def test_partial_coverage_auto_proceeds_with_gaps(self):
        """7/8 matched: AUTO_PROCEED_WITH_GAPS, with the unmatched job
        requirement id recorded separately from the matched ids and from
        any profile-evidence id -- three distinct identifier namespaces,
        never compared to one another."""
        decision = evaluate_dimension_assessment(
            dimension("NEEDS_REVIEW", job_ids=[f"jreq_{i}" for i in range(1, 8)]),
            relevant_job_ids=[f"jreq_{i}" for i in range(1, 9)],
            matched_job_ids=[f"jreq_{i}" for i in range(1, 8)],
            supporting_profile_evidence_ids=["clm_p6", "clm_msproject"],
        )
        self.assertEqual(decision.outcome, "AUTO_PROCEED_WITH_GAPS")
        self.assertEqual(decision.reason_code, "dimension_partial_coverage")
        self.assertEqual(
            decision.matched_job_requirement_ids,
            tuple(f"jreq_{i}" for i in range(1, 8)),
        )
        self.assertEqual(decision.unmatched_job_requirement_ids, ("jreq_8",))
        self.assertEqual(
            decision.supporting_profile_evidence_ids, ("clm_p6", "clm_msproject")
        )
        # The unmatched job-requirement id must never appear in either the
        # matched or the supporting-evidence collection.
        self.assertNotIn("jreq_8", decision.matched_job_requirement_ids)
        self.assertNotIn("jreq_8", decision.supporting_profile_evidence_ids)

    def test_zero_coverage_on_required_dimension_requires_user(self):
        """Zero of the relevant, required job-side items matched at all --
        distinct from partial coverage, this is a genuine material fit
        question and must escalate."""
        decision = evaluate_dimension_assessment(
            dimension("NEEDS_REVIEW", job_ids=[]),
            relevant_job_ids=["jreq_1", "jreq_2"],
            matched_job_ids=[],
        )
        self.assertEqual(decision.outcome, "REQUIRE_USER")
        self.assertEqual(decision.reason_code, "dimension_zero_coverage")

    def test_unmatched_ids_never_double_counted(self):
        decision = evaluate_dimension_assessment(
            dimension("NEEDS_REVIEW"),
            relevant_job_ids=["jreq_1", "jreq_2", "jreq_3"],
            matched_job_ids=["jreq_1"],
        )
        self.assertEqual(decision.matched_job_requirement_ids, ("jreq_1",))
        self.assertEqual(
            decision.unmatched_job_requirement_ids, ("jreq_2", "jreq_3")
        )

    def test_unknown_dimension_status_rejected_as_input_error(self):
        with self.assertRaises(ApplicationDecisionPolicyInputError):
            evaluate_dimension_assessment(
                dimension("BOGUS"), relevant_job_ids=[], matched_job_ids=[]
            )

    def test_missing_dimension_field_rejected_as_input_error(self):
        malformed = dimension("READY")
        del malformed["required"]
        with self.assertRaises(ApplicationDecisionPolicyInputError):
            evaluate_dimension_assessment(
                malformed, relevant_job_ids=[], matched_job_ids=[]
            )


class PolicyLoadingAndFingerprintTests(unittest.TestCase):
    def test_default_policy_loads_and_validates(self):
        validate_application_decision_policy(DEFAULT_POLICY)

    def test_load_application_decision_policy_round_trips(self):
        loaded = load_application_decision_policy()
        self.assertEqual(loaded["schema_version"], "application-decision-policy.v0")

    def test_fingerprint_is_stable_for_identical_content(self):
        first = application_decision_policy_fingerprint(copy.deepcopy(DEFAULT_POLICY))
        second = application_decision_policy_fingerprint(copy.deepcopy(DEFAULT_POLICY))
        self.assertEqual(first, second)

    def test_fingerprint_changes_when_content_changes_even_if_version_does_not(self):
        """This is the whole point of the fingerprint: proving exactly
        which policy contents produced a decision even if someone edits
        the file without bumping schema_version."""
        mutated = copy.deepcopy(DEFAULT_POLICY)
        mutated["reason_codes"]["gate_pass"] = "Edited without a version bump."
        original_fp = application_decision_policy_fingerprint(DEFAULT_POLICY)
        mutated_fp = application_decision_policy_fingerprint(mutated)
        self.assertNotEqual(original_fp, mutated_fp)
        self.assertEqual(mutated["schema_version"], DEFAULT_POLICY["schema_version"])

    def test_fingerprint_has_stable_prefix(self):
        fp = application_decision_policy_fingerprint(DEFAULT_POLICY)
        self.assertTrue(fp.startswith("appdecpolicy_"))

    def test_fingerprint_changes_when_policy_json_changes(self):
        mutated = copy.deepcopy(DEFAULT_POLICY)
        mutated["reason_codes"]["gate_pass"] = "A different reason string."
        original_fp = application_decision_policy_fingerprint(DEFAULT_POLICY)
        mutated_fp = application_decision_policy_fingerprint(mutated)
        self.assertNotEqual(original_fp, mutated_fp)

    def test_fingerprint_changes_when_engine_version_changes_even_if_policy_json_does_not(self):
        """This is the whole point of folding engine_version into the
        fingerprint: a behavior-changing edit to the Python classifier
        (evaluate_gate_assessment / evaluate_dimension_assessment) with no
        JSON change at all must still be provable via the fingerprint. A
        JSON-only hash could not detect this class of change -- two
        behaviorally different engines could otherwise silently share the
        same audit fingerprint."""
        same_policy = DEFAULT_POLICY
        fp_a = application_decision_policy_fingerprint(
            same_policy, engine_version="application-decision-engine.v1"
        )
        fp_b = application_decision_policy_fingerprint(
            same_policy, engine_version="application-decision-engine.v2"
        )
        self.assertNotEqual(fp_a, fp_b)

    def test_fingerprint_defaults_to_current_engine_version(self):
        explicit = application_decision_policy_fingerprint(
            DEFAULT_POLICY, engine_version=ENGINE_VERSION
        )
        default = application_decision_policy_fingerprint(DEFAULT_POLICY)
        self.assertEqual(explicit, default)

    def test_missing_field_invalidates_policy(self):
        broken = copy.deepcopy(DEFAULT_POLICY)
        del broken["gate_rules"]
        with self.assertRaises(ApplicationDecisionPolicyValidationError):
            validate_application_decision_policy(broken)

    def test_wrong_outcome_set_invalidates_policy(self):
        broken = copy.deepcopy(DEFAULT_POLICY)
        broken["outcomes"] = ["AUTO_PROCEED"]
        with self.assertRaises(ApplicationDecisionPolicyValidationError):
            validate_application_decision_policy(broken)


if __name__ == "__main__":
    unittest.main()
