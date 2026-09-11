import json
import unittest

from app.connectors.disabled import (
    DisabledByDefaultError,
    DisabledMailConnector,
    DisabledPipelineConnector,
    MailConnector,
    PipelineConnector,
)
from app.interview.prep import build_interview_prep
from app.reporting.html import render_tracker_html
from app.upskill.gaps import extract_skill_gaps, synthesize_learning_plan
from tests.test_app_foundations import FakeProvider


class FinalCorePhaseTests(unittest.TestCase):
    def test_interview_output_is_structured_star(self):
        provider = FakeProvider([
            json.dumps([{
                "question": "Tell me about a project",
                "situation": "Situation",
                "task": "Task",
                "action": "Action",
                "result": "Result",
            }])
        ])
        answer = build_interview_prep(provider, "posting", "profile")[0]
        self.assertEqual(answer.action, "Action")

    def test_upskill_diffs_before_synthesis(self):
        gaps = extract_skill_gaps("Python and SQL", "role", ["Python", "Kubernetes"])
        self.assertEqual([gap.skill for gap in gaps], ["Kubernetes"])
        provider = FakeProvider([
            json.dumps([{
                "skill": "Kubernetes",
                "priority": "high",
                "study_direction": "Start with deployments",
                "estimated_hours": 20,
            }])
        ])
        plan = synthesize_learning_plan(provider, "Python and SQL", "role", gaps)
        self.assertEqual(plan[0]["skill"], "Kubernetes")

    def test_html_report_escapes_tracker_values(self):
        report = render_tracker_html(
            [{"company": "A < B", "role": "Data & BI", "status": "new"}],
            "2026-09-07",
        )
        self.assertIn("A &lt; B", report)
        self.assertIn("Data &amp; BI", report)
        self.assertNotIn("A < B", report)

    def test_connectors_are_disabled(self):
        self.assertIn("plain mapping", MailConnector.search_messages.__doc__)
        self.assertIn("plain job mapping", PipelineConnector.upsert_job.__doc__)
        self.assertRaises(TypeError, MailConnector)
        self.assertRaises(TypeError, PipelineConnector)
        with self.assertRaises(DisabledByDefaultError):
            DisabledMailConnector().search_messages({})
        with self.assertRaises(DisabledByDefaultError):
            DisabledPipelineConnector().upsert_job({})


if __name__ == "__main__":
    unittest.main()