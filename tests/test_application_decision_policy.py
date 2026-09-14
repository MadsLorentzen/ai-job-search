"""Tests for the pure Application Decision Policy v0 domain classifier.

Phase 1 of the review-by-exception design: product/application_decision_policy.py
only. No persistence, no webapp wiring -- these tests exercise the module in
isolation, exactly as it will later be called from a mutation boundary.
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


def gate(status: str, *, job_ids=("jev_1",), profile_ids=("clm_1",)) -> dict:
    return {
        "gate_id": "eligibility",
        "status": status,
        "reason": "test reason",
        "job_evidence_ids": list(job_ids),
        "profile_evidence_ids": list(profile_ids),
    }


def dimension(status: str, *, required: bool = True, job_ids=()) -> dict:
    return {
        "dimension_id": "technical_skills",
        "status": status,
        "required": required,
        "job_evidence_ids": list(job_ids),
    }


class GateAssessmentTests(unittest.TestCase):
    def test_supported_fail_gate_auto_rejects(self):
        """A gate FAIL reaching this module is, by construction (per
        semantic_job_fit.py's own downgrade-to-UNVERIFIED rule for
        unsupported FAIL proposals), already trustworthy and supported.
        It must resolve to AUTO_REJECT, never REQUIRE_USER."""
        decision = evaluate_gate_assessment(
            gate("FAIL", profile_ids=("clm_conflict_evidence",))
        )
        self.assertEqual(decision.outcome, "AUTO_REJECT")
        self.assertEqual(decision.reason_code, "gate_fail_supported")

    def test_flag_gate_requires_user(self):
        """FLAG is an explicit, evidence-backed LLM-raised caveat -- this
        is the genuinely material/ambiguous case and must stay REQUIRE_USER."""
        decision = evaluate_gate_assessment(gate("FLAG"))
        self.assertEqual(decision.outcome, "REQUIRE_USER")
        self.assertEqual(decision.reason_code, "gate_flag")

    def test_supportive_eligibility_evidence_requires_user_pending_phase_2_contract(self):
        """This is the corrected, conservative behavior: the current Job
        Fit gate-assessment contract cannot distinguish evidence that was
        actually validated as supporting a proceed verdict from evidence
        that merely survived _supportive_profile_claims while the
        surrounding proposal was FAIL-without-support, NOT_APPLICABLE, or
        unrecognized (see product/semantic_job_fit.py's
        _build_gate_assessments: profile_ids is computed before, and
        independently of, the status-deciding branch). Until Phase 2 adds
        an explicit evidence_disposition field to that contract, any
        UNVERIFIED gate carrying non-empty profile_evidence_ids must
        escalate rather than assume support -- even when the evidence
        looks affirmative from the outside (e.g. a real "British Citizen"
        claim for an eligibility gate), because this module has no safe
        way to confirm the upstream record actually validated it."""
        decision = evaluate_gate_assessment(
            gate("UNVERIFIED", profile_ids=("clm_british_citizen",))
        )
        self.assertEqual(decision.outcome, "REQUIRE_USER")
        self.assertEqual(decision.reason_code, "gate_unverified_with_unvetted_evidence")

    def test_no_eligibility_evidence_auto_omits(self):
        decision = evaluate_gate_assessment(gate("UNVERIFIED", profile_ids=()))
        self.assertEqual(decision.outcome, "AUTO_OMIT")
        self.assertEqual(decision.reason_code, "gate_unverified_without_evidence")

    def test_ambiguous_or_conflicting_eligibility_evidence_requires_user(self):
        """Same code path as the supportive-evidence case above by
        necessity -- the upstream contract genuinely cannot distinguish
        the two today (see the Phase-1 contract gap note in
        product/application_decision_policy.py's module docstring). This
        test exists as its own explicit case to document the requirement
        directly: an UNVERIFIED gate whose evidence is actually
        conflicting or ambiguous must never be auto-resolved, and the
        conservative default achieves that correctly even though it
        cannot yet distinguish this case from the affirmative one."""
        decision = evaluate_gate_assessment(
            gate("UNVERIFIED", profile_ids=("clm_conflicting_residency_claim",))
        )
        self.assertEqual(decision.outcome, "REQUIRE_USER")

    def test_pass_gate_auto_proceeds(self):
        decision = evaluate_gate_assessment(gate("PASS"))
        self.assertEqual(decision.outcome, "AUTO_PROCEED")

    def test_not_applicable_gate_is_not_applicable(self):
        decision = evaluate_gate_assessment(gate("NOT_APPLICABLE"))
        self.assertEqual(decision.outcome, "NOT_APPLICABLE")

    def test_gate_evidence_ids_are_carried_through_verbatim(self):
        decision = evaluate_gate_assessment(
            gate("PASS", job_ids=("jev_a", "jev_b"), profile_ids=("clm_x",))
        )
        self.assertEqual(decision.job_evidence_ids, ("jev_a", "jev_b"))
        self.assertEqual(decision.profile_evidence_ids, ("clm_x",))

    def test_unknown_gate_status_rejected_as_input_error(self):
        with self.assertRaises(ApplicationDecisionPolicyInputError):
            evaluate_gate_assessment(gate("BOGUS_STATUS"))

    def test_missing_gate_field_rejected_as_input_error(self):
        malformed = gate("PASS")
        del malformed["reason"]
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
        fp_v0 = application_decision_policy_fingerprint(
            same_policy, engine_version="application-decision-engine.v0"
        )
        fp_v1 = application_decision_policy_fingerprint(
            same_policy, engine_version="application-decision-engine.v1"
        )
        self.assertNotEqual(fp_v0, fp_v1)

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
