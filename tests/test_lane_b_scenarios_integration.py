"""Proves Lane B's generated material can reach Issue #15's real READY state
-- not a look-alike assertion at the Application Intelligence layer, but the
actual webapp.application_material predicate, fed a synthesized review_record
that acknowledges every qualifying unit exactly the shape the webapp review
workflow would produce."""

import unittest

from product.application_intelligence import analyze_application_intelligence

from tests.test_lane_b_scenarios import _canned_proposal_covering_all_evidence, build_request, scenario
from webapp.application_material import application_material_completion, application_material_is_completion_ready


def _synthesize_acknowledging_review_record(result: dict) -> dict:
    """Build a review_record acknowledging every cv_content/cover_letter_content
    unit_id, matching the exact shape webapp.application_material._acknowledged_content_unit_ids
    expects: decisions_consulted entries with review_item_type=content_unit and
    disposition=acknowledged_and_proceed."""

    all_unit_ids = [u["unit_id"] for u in result["cv_content"] + result["cover_letter_content"]]
    return {
        "review_record": {
            "decisions_consulted": [
                {"domain_item_id": unit_id, "review_item_type": "content_unit", "disposition": "acknowledged_and_proceed"}
                for unit_id in all_unit_ids
            ],
        },
    }


class TestFullChainReachesRealIssue15Ready(unittest.TestCase):
    def test_strong_evidence_scenario_reaches_real_ready_after_acknowledgment(self):
        payload = scenario("strong_evidence")
        request = build_request(payload, "laneb-integration-strong")
        proposal = _canned_proposal_covering_all_evidence(payload)
        result = analyze_application_intelligence(request, proposal)

        webapp_payload = {**result, **_synthesize_acknowledging_review_record(result)}
        completion = application_material_completion(webapp_payload)

        self.assertEqual(
            completion["status"], "READY",
            f"expected strong_evidence to reach real Issue #15 READY once acknowledged, got issues={completion['issues']}",
        )
        self.assertTrue(application_material_is_completion_ready(webapp_payload))

    def test_unacknowledged_material_stays_incomplete_even_if_substantive(self):
        """Confirms the synthesized review_record in the test above is load-
        bearing, not incidental -- the same generated material without
        acknowledgment must NOT be READY."""
        payload = scenario("strong_evidence")
        request = build_request(payload, "laneb-integration-unacked")
        proposal = _canned_proposal_covering_all_evidence(payload)
        result = analyze_application_intelligence(request, proposal)

        webapp_payload = {**result, "review_record": {"decisions_consulted": []}}
        self.assertFalse(application_material_is_completion_ready(webapp_payload))


if __name__ == "__main__":
    unittest.main()
