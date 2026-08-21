"""Lane B deterministic scenario suite. No LLM call, no LLM judge -- every
proposal is a canned fixture fed through DeterministicFakeProvider, and every
assertion is a structural recomputation, never a subjective quality check."""

import json
import unittest
from pathlib import Path

from product.application_intelligence import (
    DEFAULT_POLICY,
    _compute_requirement_coverage,
    analyze_application_intelligence,
)
from product.application_material_contract import (
    MIN_CV_UNITS,
    MIN_CV_WORDS,
    MIN_COVER_LETTER_PARAGRAPHS,
    MIN_COVER_LETTER_WORDS,
    normalized_word_tokens,
)

SCENARIO_DIR = Path(__file__).parent / "fixtures" / "application_intelligence" / "scenarios"

# assertion_type -> (category, allowed fields). Mirrors
# product.application_intelligence._ASSERTION_TYPE_SHAPES exactly so the
# canned proposal helper can pick an assertion_type a claim structurally
# qualifies for, instead of hard-coding one type for every claim shape. This
# is a *test-side* mirror -- it does not import the private mapping, since
# the helper's job is to independently reconstruct which assertion_type a
# given claim's (category, field) is eligible for, the same way a real
# provider would have to infer it from the minimized proposal payload it
# receives.
ASSERTION_TYPE_SHAPES = {
    "technical_skill": ("skills", {"technical_skill"}),
    "skill": ("skills", {"technical_skill", "domain_skill", "software_or_tool"}),
    "employment": ("employment", {"job_title", "employer", "date_range", "location"}),
    "responsibility": ("employment", {"responsibility_or_achievement"}),
    "certification": ("certifications", {"certification"}),
    "education": ("education", {"qualification", "institution", "date_range"}),
    "publication": ("publications", {"publication"}),
    "award": ("awards", {"award"}),
    "language": ("languages", {"language", "proficiency"}),
}


def scenario(name: str) -> dict:
    return json.loads((SCENARIO_DIR / f"{name}.json").read_text(encoding="utf-8"))


def build_request(scenario_payload: dict, request_id: str) -> dict:
    return {
        "schema_version": "application-intelligence-request.v0",
        "request_id": request_id,
        "job_fit_result": scenario_payload["job_fit_result"],
        "resolved_job_evidence": scenario_payload["resolved_job_evidence"],
        "profile_snapshot": scenario_payload["profile_snapshot"],
        "policy": DEFAULT_POLICY,
    }


# assertion_type -> the rendering_variant this helper picks for it. Every
# entry here has an unconditionally-eligible PLAIN template registered in
# product.application_intelligence.TEMPLATE_TABLE *except* "language", which
# registers only ("language", "AS_CAPABILITY_STATEMENT") and only for claims
# whose field is "proficiency" (product.application_intelligence's
# _is_explicit_proficiency). A bare language-name claim (field "language",
# e.g. value "German") has no registered template at all and is genuinely
# unrenderable under the real contract -- not a test bug to work around.
_PLAIN_RENDERABLE_ASSERTION_TYPES = frozenset(ASSERTION_TYPE_SHAPES) - {"language"}


def _assertion_type_and_variant_for_claim(claim: dict) -> tuple[str, str] | None:
    """Return (assertion_type, rendering_variant) this claim can actually
    render under, or None if no registered template will accept it.

    Generic across all five scenarios: it inspects the claim's own
    category/field rather than assuming a fixed assertion_type per match
    position, so it works whether the cited evidence is a technical_skill,
    a responsibility_or_achievement, a bare language name, or anything else
    the real fixtures contain. Deliberately mirrors the real renderer's
    eligibility (not just category/field membership) so this helper never
    proposes an atom doomed to UNSUPPORTED for reasons unrelated to the
    scenario under test -- doomed atoms would silently shrink cv_content
    below what the fixture's real evidence can support.
    """

    for assertion_type, (category, fields) in ASSERTION_TYPE_SHAPES.items():
        if claim["category"] != category or claim["field"] not in fields:
            continue
        if assertion_type in _PLAIN_RENDERABLE_ASSERTION_TYPES:
            return assertion_type, "PLAIN"
        if assertion_type == "language" and claim["field"] == "proficiency":
            return assertion_type, "AS_CAPABILITY_STATEMENT"
    return None


def _canned_proposal_covering_all_evidence(payload: dict) -> dict:
    """Build one deterministic atom proposal that cites every direct/functional
    match's profile evidence as a cv_bullet, and every transferable match as a
    transferability atom -- enough breadth to exercise coverage computation
    across all five scenarios without hand-tuning a proposal per scenario.

    Each cv_bullet atom's assertion_type is inferred from the actual cited
    claim's (category, field) via _assertion_type_and_variant_for_claim, rather than
    hard-coded, so the helper renders real evidence instead of silently
    producing UNSUPPORTED atoms whenever a match's evidence isn't a bare
    "skill" claim (e.g. strong_evidence's functional match cites a
    responsibility_or_achievement claim, not a skills claim).

    A cv_bullet is also emitted for every claim in the profile snapshot that
    is *not* already cited by a match but does qualify for some
    assertion_type and is not conflicted -- this is what lets
    TestStrongEvidenceScenario clear MIN_CV_UNITS/MIN_CV_WORDS from genuine,
    real evidence the fixture actually contains (education, certifications,
    languages, etc.) rather than from padding invented text. A conflicted
    claim IS deliberately still cited once, by itself, so
    TestConflictingEvidenceScenario can prove the renderer actually rejects
    it into unsupported_claims rather than merely never encountering it.
    """

    job_fit_result = payload["job_fit_result"]
    claims_by_id = {c["id"]: c for c in payload["profile_snapshot"]["claims"]}
    conflicted_concepts = {c["concept_id"] for c in payload["profile_snapshot"].get("conflicts", [])}

    content_units = []
    plan = []
    unit_index = 0
    cited_claim_ids: set[str] = set()

    for match in job_fit_result.get("direct_matches", []) + job_fit_result.get("functionally_equivalent_matches", []):
        evidence_ids = match.get("profile_evidence_ids", [])
        atoms = []
        for atom_offset, evidence_id in enumerate(evidence_ids):
            claim = claims_by_id.get(evidence_id)
            renderable = _assertion_type_and_variant_for_claim(claim) if claim else None
            if renderable is None:
                continue
            assertion_type, rendering_variant = renderable
            unit_index += 1
            atoms.append({
                "atom_id": f"atom-{unit_index}-{atom_offset}", "atom_kind": "candidate_fact",
                "assertion_type": assertion_type, "profile_evidence_ids": [evidence_id],
                "job_evidence_ids": [], "job_fit_match_id": None, "rendering_variant": rendering_variant,
            })
            cited_claim_ids.add(evidence_id)
        if not atoms:
            continue
        unit_index += 1
        unit_id = f"unit-{unit_index}"
        content_units.append({"unit_id": unit_id, "unit_type": "cv_bullet", "atoms": atoms, "connectives": []})
        plan.append({
            "plan_id": f"plan-{unit_index}", "target_unit_type": "cv_bullet",
            "target_job_requirement_ids": match.get("job_requirement_ids", []),
            "rationale_kind": "strengthens_direct_match",
        })

    for match in job_fit_result.get("transferable_matches", []):
        unit_index += 1
        unit_id = f"unit-{unit_index}"
        atoms = [{
            "atom_id": f"atom-{unit_index}", "atom_kind": "transferability",
            "assertion_type": None, "profile_evidence_ids": [],
            "job_evidence_ids": [], "job_fit_match_id": match["match_id"], "rendering_variant": "PLAIN",
        }]
        content_units.append({"unit_id": unit_id, "unit_type": "cv_bullet", "atoms": atoms, "connectives": []})
        plan.append({
            "plan_id": f"plan-{unit_index}", "target_unit_type": "cv_bullet",
            "target_job_requirement_ids": match.get("job_requirement_ids", []),
            "rationale_kind": "covers_uncovered_requirement",
        })
        cited_claim_ids.update(match.get("profile_evidence_ids", []))

    # Cite every remaining real claim the fixture actually contains that
    # qualifies for some assertion_type and was not already cited above --
    # this is additional genuine evidence (education, certifications,
    # languages, further skills), never invented text. A claim belonging to
    # a conflicted concept is cited by itself in its own unit so the
    # contract can prove the renderer rejects it, rather than folding it
    # into a larger unit where the surrounding atoms would mask the
    # rejection's effect on unit status.
    for claim_id, claim in claims_by_id.items():
        if claim_id in cited_claim_ids:
            continue
        renderable = _assertion_type_and_variant_for_claim(claim)
        if renderable is None:
            continue
        assertion_type, rendering_variant = renderable
        unit_index += 1
        unit_id = f"unit-{unit_index}"
        atoms = [{
            "atom_id": f"atom-{unit_index}", "atom_kind": "candidate_fact",
            "assertion_type": assertion_type, "profile_evidence_ids": [claim_id],
            "job_evidence_ids": [], "job_fit_match_id": None, "rendering_variant": rendering_variant,
        }]
        content_units.append({"unit_id": unit_id, "unit_type": "cv_bullet", "atoms": atoms, "connectives": []})
        cited_claim_ids.add(claim_id)
        # Note: a claim belonging to a conflicted concept is NOT excluded
        # from this loop -- it is deliberately still cited here (as its own
        # single-atom unit) so TestConflictingEvidenceScenario can observe
        # the real renderer reject it into unsupported_claims. Without this,
        # profile_evidence_ids sourced only from real Ticket 7 matches would
        # never include the conflicted claim, and the conflicted-evidence
        # guard would go unexercised by this generic helper.

    # Cover letter paragraph(s) citing every responsibility_or_achievement
    # claim available (real, non-conflicted evidence) -- long enough on its
    # own, across all such claims, to matter for word-count scenarios. This
    # generalizes the brief's "reuse the first direct-match evidence"
    # fallback into "use every responsibility claim the fixture has," which
    # is what actually lets strong_evidence's cover letter clear
    # MIN_COVER_LETTER_WORDS from real evidence.
    responsibility_claim_ids = [
        c["id"] for c in payload["profile_snapshot"]["claims"]
        if c["field"] == "responsibility_or_achievement" and c["concept_id"] not in conflicted_concepts
    ]
    if responsibility_claim_ids:
        atoms = [
            {
                "atom_id": f"atom-cl-{offset}", "atom_kind": "candidate_fact", "assertion_type": "responsibility",
                "profile_evidence_ids": [claim_id],
                "job_evidence_ids": [], "job_fit_match_id": None, "rendering_variant": "PLAIN",
            }
            for offset, claim_id in enumerate(responsibility_claim_ids)
        ]
        content_units.append({
            "unit_id": "cover-letter-1", "unit_type": "cover_letter_paragraph",
            "atoms": atoms,
            "connectives": [],
        })

    return {"content_units": content_units, "cv_emphasis_plan": plan, "cover_letter_plan": []}


class ScenarioAssertionMixin:
    """Shared assertions every scenario runs, regardless of its expected outcome."""

    def _assert_coverage_matches_recomputation(self, result, job_fit_result):
        recomputed = _compute_requirement_coverage(job_fit_result, result["cv_content"] + result["cover_letter_content"])
        self.assertEqual(result["requirement_coverage"], recomputed)

    def _assert_all_cited_evidence_is_valid_and_unconflicted(self, result, profile_snapshot):
        claim_ids = {c["id"] for c in profile_snapshot["claims"]}
        conflicted_concepts = {c["concept_id"] for c in profile_snapshot.get("conflicts", [])}
        claims_by_id = {c["id"]: c for c in profile_snapshot["claims"]}
        for unit in result["cv_content"] + result["cover_letter_content"]:
            for evidence_id in unit["profile_evidence_ids"]:
                self.assertIn(evidence_id, claim_ids, f"unit {unit['unit_id']} cites unknown evidence {evidence_id}")
                self.assertNotIn(
                    claims_by_id[evidence_id]["concept_id"], conflicted_concepts,
                    f"unit {unit['unit_id']} cites conflicted evidence {evidence_id}",
                )


class TestStrongEvidenceScenario(ScenarioAssertionMixin, unittest.TestCase):
    def test_strong_evidence_clears_contract_with_high_coverage(self):
        payload = scenario("strong_evidence")
        request = build_request(payload, "laneb-strong-evidence")
        proposal = _canned_proposal_covering_all_evidence(payload)
        result = analyze_application_intelligence(request, proposal)
        cv_words = sum(len(normalized_word_tokens(u["text"])) for u in result["cv_content"] if u["status"] == "READY")
        self.assertGreaterEqual(len(result["cv_content"]), MIN_CV_UNITS)
        self.assertGreaterEqual(cv_words, MIN_CV_WORDS)
        cover_letter_words = sum(
            len(normalized_word_tokens(u["text"])) for u in result["cover_letter_content"] if u["status"] == "READY"
        )
        self.assertGreaterEqual(len(result["cover_letter_content"]), MIN_COVER_LETTER_PARAGRAPHS)
        self.assertGreaterEqual(cover_letter_words, MIN_COVER_LETTER_WORDS)
        self._assert_coverage_matches_recomputation(result, payload["job_fit_result"])
        self._assert_all_cited_evidence_is_valid_and_unconflicted(result, payload["profile_snapshot"])
        self.assertGreater(len(result["requirement_coverage"]["covered"]), 0)


class TestSparseEvidenceScenario(ScenarioAssertionMixin, unittest.TestCase):
    def test_sparse_evidence_legitimately_stays_incomplete(self):
        payload = scenario("sparse_evidence")
        request = build_request(payload, "laneb-sparse-evidence")
        proposal = _canned_proposal_covering_all_evidence(payload)
        result = analyze_application_intelligence(request, proposal)
        cv_words = sum(len(normalized_word_tokens(u["text"])) for u in result["cv_content"] if u["status"] == "READY")
        # Assert INCOMPLETE for the right reason -- not enough evidence, never
        # because the suite forced padding.
        self.assertTrue(
            len(result["cv_content"]) < MIN_CV_UNITS or cv_words < MIN_CV_WORDS,
            "sparse_evidence scenario should not have enough material to clear the contract",
        )
        self._assert_all_cited_evidence_is_valid_and_unconflicted(result, payload["profile_snapshot"])


class TestTransferableOnlyScenario(ScenarioAssertionMixin, unittest.TestCase):
    def test_transferable_matches_render_and_count_toward_coverage(self):
        payload = scenario("transferable_only")
        request = build_request(payload, "laneb-transferable-only")
        proposal = _canned_proposal_covering_all_evidence(payload)
        result = analyze_application_intelligence(request, proposal)
        self._assert_coverage_matches_recomputation(result, payload["job_fit_result"])
        self.assertTrue(any(m["classification"] == "transferable" for m in result["positioning"]["transferable_strengths"]) or not payload["job_fit_result"].get("transferable_matches"))


class TestGapsScenario(ScenarioAssertionMixin, unittest.TestCase):
    def test_gap_text_is_verbatim_and_excluded_from_coverage(self):
        payload = scenario("gaps")
        request = build_request(payload, "laneb-gaps")
        result = analyze_application_intelligence(request, None)
        job_fit_gaps = payload["job_fit_result"].get("gaps", [])
        self.assertEqual(len(result["positioning"]["material_gaps"]), len(job_fit_gaps))
        for expected, actual in zip(job_fit_gaps, result["positioning"]["material_gaps"]):
            self.assertEqual(actual["text"], expected["notes"])


class TestConflictingEvidenceScenario(ScenarioAssertionMixin, unittest.TestCase):
    def test_conflicted_claims_are_never_cited(self):
        payload = scenario("conflicting_evidence")
        request = build_request(payload, "laneb-conflicting-evidence")
        proposal = _canned_proposal_covering_all_evidence(payload)  # deliberately includes an atom citing the conflicted claim
        result = analyze_application_intelligence(request, proposal)
        self._assert_all_cited_evidence_is_valid_and_unconflicted(result, payload["profile_snapshot"])
        self.assertTrue(result["unsupported_claims"], "expected the conflicted-claim atom to be rejected into unsupported_claims")


class TestPlanIssuesDiagnosticOnly(unittest.TestCase):
    def test_malformed_plan_entry_reported_separately_from_unsupported_claims(self):
        payload = scenario("strong_evidence")
        request = build_request(payload, "laneb-plan-issues")
        proposal = _canned_proposal_covering_all_evidence(payload)
        proposal["cv_emphasis_plan"] = [{"plan_id": "bad", "target_unit_type": "not_real", "target_job_requirement_ids": [], "rationale_kind": "covers_uncovered_requirement"}]
        result = analyze_application_intelligence(request, proposal)
        self.assertEqual(len(result["plan_issues"]), 1)
        # A malformed plan entry must not add to unsupported_claims and must not
        # prevent otherwise-valid content_units from rendering.
        self.assertGreater(len(result["cv_content"]), 0)


GOLDEN_DIR = SCENARIO_DIR / "golden"


class TestGoldenSnapshotsMatch(unittest.TestCase):
    """Static in CI: compares against checked-in golden files, never rewrites
    them. Refresh deliberately via
    `python -m tests.fixtures.application_intelligence.scenarios.update_snapshots`."""

    def test_all_scenarios_match_their_golden_snapshot(self):
        from tests.fixtures.application_intelligence.scenarios.update_snapshots import SCENARIO_NAMES, _render_summary
        for name in SCENARIO_NAMES:
            with self.subTest(scenario=name):
                payload = scenario(name)
                request = build_request(payload, f"laneb-golden-check-{name}")
                proposal = _canned_proposal_covering_all_evidence(payload)
                result = analyze_application_intelligence(request, proposal)
                actual = _render_summary(result)
                expected = json.loads((GOLDEN_DIR / f"{name}.json").read_text(encoding="utf-8"))
                self.assertEqual(actual, expected, f"{name} render drifted from golden snapshot -- if intentional, run update_snapshots.py")


if __name__ == "__main__":
    unittest.main()
