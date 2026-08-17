"""Tests for Ticket 8 Application Intelligence v0."""

import copy
import json
import unittest
from pathlib import Path


SCHEMA_PATH = Path(__file__).parent.parent / "product" / "schemas" / "application-intelligence-contract.v0.schema.json"


class TestSchemaLoads(unittest.TestCase):
    def test_schema_file_is_valid_json_with_expected_defs(self):
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.assertEqual(schema["$defs"]["requestVersion"]["const"], "application-intelligence-request.v0")
        self.assertEqual(schema["$defs"]["resultVersion"]["const"], "application-intelligence-result.v0")
        self.assertEqual(schema["$defs"]["policyVersion"]["const"], "application-intelligence-policy.v0")
        self.assertEqual(
            set(schema["$defs"]["strengthLevel"]["enum"]),
            {"STATED", "EXPLICIT_PROFICIENCY", "EXPLICIT_DURATION", "EXPLICIT_HANDS_ON", "EXPLICIT_LEADERSHIP"},
        )
        self.assertEqual(
            set(schema["$defs"]["recommendation"]["enum"]),
            {"proceed", "proceed_with_review", "do_not_proceed"},
        )


POLICY_PATH = Path(__file__).parent.parent / "product" / "application_intelligence_policy.v0.json"


class TestPolicyFile(unittest.TestCase):
    def test_policy_file_covers_every_blocked_status_verdict_combination(self):
        policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        self.assertEqual(policy["schema_version"], "application-intelligence-policy.v0")
        rule_ids = {rule["rule_id"] for rule in policy["recommendation_rules"]}
        self.assertEqual(
            rule_ids,
            {"blocked", "unavailable", "needs_review", "ready_poor_or_weak", "ready_moderate", "ready_good_or_strong"},
        )
        verdicts_covered = set()
        for rule in policy["recommendation_rules"]:
            verdicts_covered.update(rule.get("when_verdict_in", []))
        self.assertEqual(verdicts_covered, {"poor_fit", "weak_fit", "moderate_fit", "good_fit", "strong_fit"})


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "application_intelligence"


def fixture(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


class TestFixturesLoad(unittest.TestCase):
    def test_all_fixtures_parse_as_json_with_expected_status(self):
        self.assertEqual(fixture("profile-snapshot.json")["schema_version"], "candidate-profile-evidence-snapshot.v0")
        self.assertEqual(fixture("resolved-job-evidence.json")["evidence"][0]["id"], "jobev_req_python")
        self.assertEqual(fixture("job-fit-result-ready.json")["status"], "READY")
        self.assertIsInstance(fixture("job-fit-result-ready.json")["verdict"], dict)
        self.assertIn(fixture("job-fit-result-ready.json")["verdict"]["id"], {"poor_fit", "weak_fit", "moderate_fit", "good_fit", "strong_fit"})
        self.assertEqual(fixture("job-fit-result-blocked.json")["blocked"], True)
        self.assertEqual(fixture("job-fit-result-needs-review.json")["status"], "NEEDS_REVIEW")


from product.application_intelligence import (
    DEFAULT_POLICY,
    ApplicationIntelligenceValidationError,
    _compute_recommendation,
    validate_application_intelligence_policy,
)


class TestRecommendationPolicyValidation(unittest.TestCase):
    def test_default_policy_file_validates(self):
        validate_application_intelligence_policy(DEFAULT_POLICY)  # must not raise


def _fake_verdict(verdict_id):
    return None if verdict_id is None else {"id": verdict_id, "display_name": verdict_id, "score": 50.0}


class TestComputeRecommendation(unittest.TestCase):
    def test_blocked_is_always_do_not_proceed(self):
        result = fixture("job-fit-result-blocked.json")
        recommendation, reason = _compute_recommendation(result, DEFAULT_POLICY)
        self.assertEqual(recommendation, "do_not_proceed")
        self.assertIn("blocked", reason.lower())

    def test_needs_review_is_proceed_with_review(self):
        result = fixture("job-fit-result-needs-review.json")
        recommendation, _ = _compute_recommendation(result, DEFAULT_POLICY)
        self.assertEqual(recommendation, "proceed_with_review")

    def test_ready_strong_fit_is_proceed(self):
        result = fixture("job-fit-result-ready.json")
        recommendation, _ = _compute_recommendation(result, DEFAULT_POLICY)
        self.assertEqual(recommendation, "proceed")

    def test_every_status_verdict_blocked_combination_is_covered(self):
        # Exhaustive table-driven test per the design's named acceptance criterion.
        cases = [
            (True, "READY", "strong_fit", "do_not_proceed"),
            (True, "NEEDS_REVIEW", None, "do_not_proceed"),
            (False, "UNAVAILABLE", None, "do_not_proceed"),
            (False, "NEEDS_REVIEW", None, "proceed_with_review"),
            (False, "READY", "poor_fit", "do_not_proceed"),
            (False, "READY", "weak_fit", "do_not_proceed"),
            (False, "READY", "moderate_fit", "proceed_with_review"),
            (False, "READY", "good_fit", "proceed"),
            (False, "READY", "strong_fit", "proceed"),
        ]
        for blocked, status, verdict, expected in cases:
            with self.subTest(blocked=blocked, status=status, verdict=verdict):
                fake_result = {"blocked": blocked, "status": status, "verdict": _fake_verdict(verdict)}
                recommendation, _ = _compute_recommendation(fake_result, DEFAULT_POLICY)
                self.assertEqual(recommendation, expected)

    def test_no_matching_rule_raises(self):
        with self.assertRaises(ApplicationIntelligenceValidationError):
            _compute_recommendation({"blocked": False, "status": "BOGUS", "verdict": None}, DEFAULT_POLICY)


from product.application_intelligence import (
    analyze_application_intelligence,
    validate_application_intelligence_result,
    _bundle_content_id,
)
from product.job_fit import profile_snapshot_content_id


def application_intelligence_request(job_fit_fixture: str) -> dict:
    """Build a Ticket 8 request pairing a generated Ticket 7 fixture with the
    small hand-authored profile/evidence fixtures the rest of this test file's
    claim ids and job evidence ids assume.

    The generated job-fit-result-*.json fixtures carry Ticket 7's own real
    profile_snapshot/resolved_job_evidence *identity stubs* (schema_version +
    content_id), computed against the fixtures the generator script actually
    used (tests/test_semantic_job_fit.py's rich_profile()/job_snapshot()).
    Those are not the same objects as this file's profile-snapshot.json /
    resolved-job-evidence.json, which the rest of this test suite's claim ids
    (clm_1111111111111111 etc.) and job evidence ids (jobev_req_python etc.)
    are written against. To exercise Ticket 8's rendering/adjudication logic
    against stable, well-known ids while still satisfying the real upstream
    identity staleness check added in Task 1, the embedded identity stubs are
    patched here to match the fixtures actually being supplied. The staleness
    check itself is exercised separately and directly in TestRealTicket7Seam,
    which builds a genuine, fully consistent Ticket 7 result end-to-end.
    """

    job_fit_result = fixture(job_fit_fixture)
    resolved_job_evidence = fixture("resolved-job-evidence.json")
    profile_snapshot = fixture("profile-snapshot.json")
    job_fit_result["profile_snapshot"] = {
        "schema_version": profile_snapshot["schema_version"],
        "content_id": profile_snapshot_content_id(profile_snapshot),
    }
    job_fit_result["resolved_job_evidence"] = {
        "schema_version": resolved_job_evidence["schema_version"],
        "content_id": _bundle_content_id(resolved_job_evidence),
    }
    return {
        "schema_version": "application-intelligence-request.v0",
        "request_id": "appintel-req-1",
        "job_fit_result": job_fit_result,
        "resolved_job_evidence": resolved_job_evidence,
        "profile_snapshot": profile_snapshot,
        "policy": DEFAULT_POLICY,
    }


class TestBareSkillClaimCannotReachHandsOnTemplate(unittest.TestCase):
    """Named regression test from the design: 'Python' alone must never render
    as 'Strong hands-on experience with Python'."""

    def test_bare_technical_skill_atom_rejects_as_strength_variant(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-1",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "AS_STRENGTH",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        unit = result["cv_content"][0]
        self.assertEqual(unit["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["unsupported_claims"]), 1)
        self.assertIn("structural evidence linkage", result["unsupported_claims"][0]["reason"])

    def test_bare_technical_skill_atom_accepts_plain_variant(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-1",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        unit = result["cv_content"][0]
        self.assertEqual(unit["status"], "READY")
        self.assertEqual(unit["text"], "Python")

    def test_linked_responsibility_atom_accepts_hands_on_variant(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-2",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "responsibility",
                            "profile_evidence_ids": ["clm_4444444444444444"],
                            "rendering_variant": "AS_STRENGTH",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        unit = result["cv_content"][0]
        self.assertEqual(unit["status"], "READY")
        self.assertIn("Hands-on delivery of", unit["text"])


class TestJobReferenceAtom(unittest.TestCase):
    def test_valid_job_reference_atom_renders_from_job_evidence_text(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cover-para-3",
                    "unit_type": "cover_letter_paragraph",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "job_reference",
                            "job_evidence_ids": ["jobev_req_python"],
                            "rendering_variant": "AS_REQUIREMENT",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        unit = result["cover_letter_content"][0]
        self.assertEqual(unit["status"], "READY")
        self.assertEqual(unit["text"], "Requires production Python experience.")

    def test_unknown_job_evidence_id_rejected(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cover-para-4",
                    "unit_type": "cover_letter_paragraph",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "job_reference",
                            "job_evidence_ids": ["jobev_does_not_exist"],
                            "rendering_variant": "AS_REQUIREMENT",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cover_letter_content"][0]["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["unsupported_claims"]), 1)


class TestRationaleNeverRendered(unittest.TestCase):
    """Named regression test: Ticket 7 rationale text must never appear in
    rendered content, even for transferability atoms."""

    def test_transferability_atom_never_includes_rationale_text(self):
        # Uses the needs-review fixture (not ready) because the real Ticket 7
        # ready fixture -- generated from proposals_for_full_fit(), which only
        # proposes direct and functionally_equivalent classifications -- has
        # no transferable match at all. The needs-review fixture genuinely
        # exercises a transferable match with non-empty limitations.
        request = application_intelligence_request("job-fit-result-needs-review.json")
        job_fit_result = request["job_fit_result"]
        rationale_text = job_fit_result["transferable_matches"][0]["rationale"]
        match_id = job_fit_result["transferable_matches"][0]["match_id"]
        proposal = {
            "content_units": [
                {
                    "unit_id": "cover-para-1",
                    "unit_type": "cover_letter_paragraph",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "transferability",
                            "job_fit_match_id": match_id,
                            "rendering_variant": "WITH_CONDITIONS_INLINE",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        unit = result["cover_letter_content"][0]
        self.assertNotIn(rationale_text, unit["text"])
        self.assertIn("Limitations:", unit["text"])

    def test_transferability_atom_forces_needs_review_when_match_unresolved(self):
        request = application_intelligence_request("job-fit-result-needs-review.json")
        match_id = request["job_fit_result"]["transferable_matches"][0]["match_id"]
        proposal = {
            "content_units": [
                {
                    "unit_id": "cover-para-2",
                    "unit_type": "cover_letter_paragraph",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "transferability",
                            "job_fit_match_id": match_id,
                            "rendering_variant": "WITH_CONDITIONS_INLINE",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cover_letter_content"][0]["status"], "NEEDS_REVIEW")


class TestConnectiveGuard(unittest.TestCase):
    def test_disallowed_connective_forces_needs_review(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-3",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [{"after_atom_index": 0, "text": "extremely proficient in"}],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")


class TestResultStatusPropagation(unittest.TestCase):
    def test_blocked_job_fit_result_forces_unavailable_status(self):
        request = application_intelligence_request("job-fit-result-blocked.json")
        result = analyze_application_intelligence(request, None)
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["recommendation"], "do_not_proceed")

    def test_no_proposal_yields_empty_cv_and_cover_letter_content(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        result = analyze_application_intelligence(request, None)
        self.assertEqual(result["cv_content"], [])
        self.assertEqual(result["cover_letter_content"], [])
        self.assertEqual(result["recommendation"], "proceed")


class TestExtensionOnlyFactsRejected(unittest.TestCase):
    def test_candidate_fact_atom_cannot_cite_only_extension_ref(self):
        # A candidate_fact atom has no extension_ref field at all in this
        # design (only transferability atoms carry job_fit_match_id/extension
        # references) -- so a provider attempting to assert a candidate fact
        # via extension alone simply has no evidence ids to cite, and is
        # rejected by the existing "requires profile evidence" check.
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-4",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "certification",
                            "profile_evidence_ids": [],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["unsupported_claims"]), 1)


class TestMissingEvidenceDoesNotBecomeNegativeClaim(unittest.TestCase):
    def test_unsupported_atom_reason_never_asserts_absence_of_candidate_experience(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-5",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "certification",
                            "profile_evidence_ids": ["clm_9999999999999999"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        reason = result["unsupported_claims"][0]["reason"]
        self.assertNotIn("does not have", reason)
        self.assertNotIn("lacks", reason)
        self.assertIn("unknown profile evidence id", reason)


class TestByteForByteReproducibility(unittest.TestCase):
    def test_ready_unit_text_is_deterministic_across_repeated_calls(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-6",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        first = analyze_application_intelligence(request, proposal)
        second = analyze_application_intelligence(request, proposal)

        self.assertEqual(first["cv_content"][0]["text"], second["cv_content"][0]["text"])
        self.assertEqual(first["cv_content"][0]["text"], "Python")


class TestRealTicket7Seam(unittest.TestCase):
    """Proves analyze_application_intelligence works against a genuine Ticket 7
    result built through Ticket 7's own functions, not a hand-built fixture."""

    def test_real_ticket7_result_is_accepted_and_produces_a_result(self):
        from product.semantic_job_fit import (
            analyze_semantic_job_fit,
            build_resolved_job_evidence_bundle,
            build_semantic_job_fit_request,
        )
        from tests.test_semantic_job_fit import (
            fully_scoring_policy,
            job_snapshot,
            proposals_for_full_fit,
            rich_profile,
            understanding_pair,
        )

        job = job_snapshot()
        request_understanding, result_understanding = understanding_pair(job=job)
        bundle = build_resolved_job_evidence_bundle(job, request_understanding, result_understanding)
        profile = rich_profile()
        proposals = proposals_for_full_fit(bundle)
        ticket7_request = build_semantic_job_fit_request(
            request_id="real-seam-test",
            profile_snapshot=profile,
            job_snapshot=job,
            resolved_job_evidence=bundle,
            semantic_fit_policy=fully_scoring_policy(),
            user_intent={"intent": "evaluate_with_transferability"},
            semantic_proposals=proposals,
        )
        ticket7_result = analyze_semantic_job_fit(ticket7_request)

        ticket8_request = {
            "schema_version": "application-intelligence-request.v0",
            "request_id": "appintel-real-seam",
            "job_fit_result": ticket7_result,
            "resolved_job_evidence": bundle,
            "profile_snapshot": profile,
            "policy": DEFAULT_POLICY,
        }

        result = analyze_application_intelligence(ticket8_request, None)

        self.assertIn(result["recommendation"], {"proceed", "proceed_with_review", "do_not_proceed"})
        self.assertIn(result["status"], {"READY", "NEEDS_REVIEW", "UNAVAILABLE"})

    def test_stale_profile_snapshot_is_rejected(self):
        from product.semantic_job_fit import (
            analyze_semantic_job_fit,
            build_resolved_job_evidence_bundle,
            build_semantic_job_fit_request,
        )
        from tests.test_semantic_job_fit import (
            fully_scoring_policy,
            job_snapshot,
            proposals_for_full_fit,
            rich_profile,
            understanding_pair,
        )

        job = job_snapshot()
        request_understanding, result_understanding = understanding_pair(job=job)
        bundle = build_resolved_job_evidence_bundle(job, request_understanding, result_understanding)
        profile = rich_profile()
        proposals = proposals_for_full_fit(bundle)
        ticket7_request = build_semantic_job_fit_request(
            request_id="stale-test",
            profile_snapshot=profile,
            job_snapshot=job,
            resolved_job_evidence=bundle,
            semantic_fit_policy=fully_scoring_policy(),
            user_intent={"intent": "evaluate_with_transferability"},
            semantic_proposals=proposals,
        )
        ticket7_result = analyze_semantic_job_fit(ticket7_request)

        # Mutate the profile AFTER Ticket 7 evaluated it -- simulates a caller
        # supplying stale/changed evidence alongside an old Ticket 7 result.
        stale_profile = copy.deepcopy(profile)
        stale_profile["claims"].append(
            {
                "id": "clm_9999999999999998",
                "record_id": "rec_9999999999999998",
                "concept_id": "cpt_9999999999999998",
                "category": "skills",
                "field": "technical_skill",
                "value": "Rust",
                "source": {"file": "CLAUDE.md", "section": "Technical Skills", "line_start": 99, "line_end": 99},
                "placeholder": False,
                "confidence": "high",
                "extraction_status": "explicit",
            }
        )
        stale_profile["summary"]["claim_count"] = len(stale_profile["claims"])

        ticket8_request = {
            "schema_version": "application-intelligence-request.v0",
            "request_id": "appintel-stale",
            "job_fit_result": ticket7_result,
            "resolved_job_evidence": bundle,
            "profile_snapshot": stale_profile,
            "policy": DEFAULT_POLICY,
        }

        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            analyze_application_intelligence(ticket8_request, None)
        self.assertTrue(any("stale or mismatched" in error for error in ctx.exception.errors))


class TestFullResultContract(unittest.TestCase):
    def test_result_has_all_seven_approved_sections(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        result = analyze_application_intelligence(request, None)
        for field in (
            "job_fit_result_ref", "profile_snapshot", "recommendation", "positioning",
            "cv_emphasis_plan", "cv_content", "cover_letter_plan", "cover_letter_content",
            "unsupported_claims", "status", "notes",
        ):
            self.assertIn(field, result, f"missing {field}")

    def test_positioning_direct_strengths_populated_from_real_ticket7_matches(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        result = analyze_application_intelligence(request, None)
        job_fit_result = fixture("job-fit-result-ready.json")
        expected_count = len(job_fit_result.get("direct_matches", []))
        self.assertEqual(len(result["positioning"]["direct_strengths"]), expected_count)

    def test_positioning_transferable_strengths_preserve_conditions_and_status(self):
        request = application_intelligence_request("job-fit-result-needs-review.json")
        result = analyze_application_intelligence(request, None)
        job_fit_result = fixture("job-fit-result-needs-review.json")
        ticket7_matches = job_fit_result.get("transferable_matches", [])
        if not ticket7_matches:
            self.skipTest("needs-review fixture has no transferable_matches to verify against")
        positioning_matches = result["positioning"]["transferable_strengths"]
        self.assertEqual(len(positioning_matches), len(ticket7_matches))
        for expected, actual in zip(ticket7_matches, positioning_matches):
            self.assertEqual(actual["conditions"], expected.get("conditions", []))
            self.assertEqual(actual["limitations"], expected.get("limitations", []))
            self.assertEqual(actual["status"], expected["status"])

    def test_validate_application_intelligence_result_accepts_own_output(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        result = analyze_application_intelligence(request, None)
        validate_application_intelligence_result(request, result)  # must not raise


class TestNoStrengthCrossLeakage(unittest.TestCase):
    def test_bare_skill_claim_cannot_get_capability_statement(self):
        """Regression for the fixed bug: bare technical_skill claims must not
        be able to render 'Experience with X' (AS_CAPABILITY_STATEMENT),
        which itself asserts unearned experience."""

        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-cap",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "AS_CAPABILITY_STATEMENT",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["unsupported_claims"]), 1)
        self.assertIn("structural evidence linkage", result["unsupported_claims"][0]["reason"])

    def test_linked_skill_claim_can_get_capability_statement(self):
        """A technical_skill claim WITH employment linkage should still be
        eligible for AS_CAPABILITY_STATEMENT (positive control)."""

        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-linked-cap",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_5555555555555555"],
                            "rendering_variant": "AS_CAPABILITY_STATEMENT",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "READY")
        self.assertEqual(result["cv_content"][0]["text"], "Experience with Python")

    def test_single_atom_renders_from_the_qualifying_claim_not_claims_zero(self):
        """Regression for the fixed correctness gap: when one atom cites
        MULTIPLE claims of the same assertion_type and only some of them
        satisfy the template's eligibility predicate, the renderer must use
        a claim that ITSELF qualifies -- never claims[0] merely because it
        was cited first. Cites clm_1111111111111111 ("Python", unlinked,
        does NOT qualify for AS_CAPABILITY_STATEMENT) FIRST and
        clm_6666666666666666 ("SQL", linked to the same employment record as
        clm_2222222222222222/clm_4444444444444444, DOES qualify) SECOND.
        Before the fix, this rendered "Experience with Python" -- the
        unlinked claim's value -- because eligibility was checked with any()
        over the whole claims list while rendering always used claims[0].
        After the fix, it must render "Experience with SQL": the value comes
        from the claim that actually satisfied eligibility."""

        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-multi-claim",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": [
                                "clm_1111111111111111",
                                "clm_6666666666666666",
                            ],
                            "rendering_variant": "AS_CAPABILITY_STATEMENT",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "READY")
        self.assertEqual(result["cv_content"][0]["text"], "Experience with SQL")
        self.assertNotEqual(result["cv_content"][0]["text"], "Experience with Python")

    def test_unrelated_strong_claim_does_not_leak_into_weak_claim_eligibility(self):
        """Regression: an atom citing BOTH a strong (linked) claim and an
        unrelated weak (unlinked) claim for a DIFFERENT fact must not let the
        strong claim's eligibility apply to the weak one. Since each atom
        renders from claims[0] only (see _render_candidate_fact_atom), this
        test constructs two SEPARATE atoms citing different claims and
        confirms each is judged solely on its own evidence."""

        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-mixed",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            # Strong: linked responsibility claim.
                            "atom_id": "atom-strong",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "responsibility",
                            "profile_evidence_ids": ["clm_4444444444444444"],
                            "rendering_variant": "AS_STRENGTH",
                        },
                        {
                            # Weak: bare unlinked skill claim, same unit.
                            "atom_id": "atom-weak",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "AS_STRENGTH",
                        },
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        # The unit overall is NEEDS_REVIEW because one atom failed, but
        # critically the failure must be the weak atom, not a false pass.
        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["unsupported_claims"]), 1)
        self.assertIn("atom-weak", result["unsupported_claims"][0]["rejected_atom_ids"])


class TestStrengthenedPolicyValidation(unittest.TestCase):
    def test_default_policy_covers_all_real_verdict_ids(self):
        validate_application_intelligence_policy(DEFAULT_POLICY)  # must not raise

    def test_policy_missing_blocked_rule_is_rejected(self):
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"] = [
            rule for rule in bad_policy["recommendation_rules"] if not rule.get("when_blocked")
        ]
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("blocked=true" in error for error in ctx.exception.errors))

    def test_policy_with_unknown_verdict_id_is_rejected(self):
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"].append(
            {
                "rule_id": "bogus",
                "when_status": "READY",
                "when_verdict_in": ["not_a_real_verdict"],
                "recommendation": "proceed",
                "reason": "test",
            }
        )
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("unknown verdict id" in error for error in ctx.exception.errors))

    def test_policy_with_non_boolean_when_blocked_is_rejected(self):
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"][0] = dict(bad_policy["recommendation_rules"][0])
        bad_policy["recommendation_rules"][0]["when_blocked"] = "yes"
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("when_blocked: must be boolean" in error for error in ctx.exception.errors))

    def test_policy_with_verdict_rule_scoped_to_unavailable_is_rejected(self):
        # UNAVAILABLE is the one status Ticket 7 can never pair with a real
        # verdict (blocked results short-circuit before evaluate_scores()
        # runs) -- this combination remains genuinely ambiguous/impossible.
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"].append(
            {
                "rule_id": "ambiguous",
                "when_status": "UNAVAILABLE",
                "when_verdict_in": ["strong_fit"],
                "recommendation": "proceed",
                "reason": "test",
            }
        )
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("only meaningful when when_status is 'READY' or 'NEEDS_REVIEW'" in error for error in ctx.exception.errors))

    def test_policy_with_verdict_rule_scoped_to_needs_review_is_accepted(self):
        # Regression: Ticket 7's _result_status can return NEEDS_REVIEW while
        # evaluate_scores() still ran and produced a real, non-null verdict
        # (a non-required dimension can independently resolve to
        # NEEDS_REVIEW while every required dimension is READY and no gate
        # blocks). A policy rule routing that reachable state by verdict id
        # must be ACCEPTED, not rejected as ambiguous.
        good_policy = copy.deepcopy(DEFAULT_POLICY)
        good_policy["recommendation_rules"].append(
            {
                "rule_id": "needs_review_with_verdict",
                "when_status": "NEEDS_REVIEW",
                "when_verdict_in": ["strong_fit"],
                "recommendation": "proceed_with_review",
                "reason": "test",
            }
        )
        validate_application_intelligence_policy(good_policy)  # must not raise

    def test_duplicate_rule_id_is_rejected(self):
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"].append(dict(bad_policy["recommendation_rules"][0]))
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("duplicate rule_id" in error for error in ctx.exception.errors))


class TestRecommendationIsProviderBlind(unittest.TestCase):
    def test_compute_recommendation_signature_takes_no_proposal_argument(self):
        import inspect
        signature = inspect.signature(_compute_recommendation)
        self.assertEqual(list(signature.parameters), ["job_fit_result", "policy"])


class TestParkedFindingsFixed(unittest.TestCase):
    """Regression tests for the two findings parked during the original
    Task 6 review: a malformed atom crashing instead of quarantining, and a
    misleading rejection-reason string. Both are now fixed."""

    def test_malformed_atom_missing_assertion_type_does_not_crash(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-malformed",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            # assertion_type deliberately missing
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        # Must not raise -- this used to KeyError.
        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["unsupported_claims"]), 1)

    def test_no_template_vs_insufficient_strength_have_distinct_reasons(self):
        request = application_intelligence_request("job-fit-result-ready.json")

        # Case A: no template exists at all for this (assertion_type, variant).
        # Uses clm_2222222222222222 (employment/job_title), which passes the
        # category/field match for assertion_type "employment" -- so the
        # rejection is reached via the template-table lookup, not an earlier
        # category/field mismatch. (The brief's original choice of "award" +
        # clm_1111111111111111, a skills/technical_skill claim, fails the
        # category/field check before ever reaching the template lookup,
        # since this fixture has no awards-category claim at all.)
        proposal_no_template = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-no-template",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "employment",
                            "profile_evidence_ids": ["clm_2222222222222222"],
                            "rendering_variant": "AS_STRENGTH",  # no ("employment", "AS_STRENGTH") entry exists
                        }
                    ],
                    "connectives": [],
                }
            ]
        }
        result_a = analyze_application_intelligence(request, proposal_no_template)
        reason_a = result_a["unsupported_claims"][0]["reason"]

        # Case B: template exists but evidence doesn't support it.
        proposal_insufficient = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-insufficient",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "AS_STRENGTH",  # template exists, evidence too weak
                        }
                    ],
                    "connectives": [],
                }
            ]
        }
        result_b = analyze_application_intelligence(request, proposal_insufficient)
        reason_b = result_b["unsupported_claims"][0]["reason"]

        self.assertIn("no rendering template is registered", reason_a)
        self.assertIn("structural evidence linkage", reason_b)
        self.assertNotEqual(reason_a, reason_b)


class TestConnectiveIndexBoundsChecking(unittest.TestCase):
    def test_negative_after_atom_index_is_rejected(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-neg-idx",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [{"after_atom_index": -1, "text": "and"}],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertTrue(any("out of range" in claim["reason"] for claim in result["unsupported_claims"]))

    def test_out_of_range_after_atom_index_is_rejected(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-oob-idx",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [{"after_atom_index": 5, "text": "and"}],  # only 1 atom exists (index 0)
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertTrue(any("out of range" in claim["reason"] for claim in result["unsupported_claims"]))


if __name__ == "__main__":
    unittest.main()
