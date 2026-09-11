import json
import unittest
from pathlib import Path
from unittest.mock import patch

from app.applications.drafting import ApplicationContext, draft_application, evaluate_fit
from app.applications.reviewing import review_application
from app.documents.pipeline import validate_pdf
from app.jobs.filters import deduplicate_jobs, filter_job
from app.jobs.normalize import normalize_job
from app.ranking.scoring import RankingEvidence, rank_job
from app.state.models import RemoteStatus
from tests.test_app_foundations import FakeProvider


class PipelineContractTests(unittest.TestCase):
    def setUp(self):
        self.context = ApplicationContext(
            job_posting="Remote data engineering role",
            candidate_profile="Candidate knows Python and SQL",
            evaluation_rules="Use repository scoring rules",
        )

    def test_normalize_filter_deduplicate_and_rank(self):
        raw = {
            "id": "job-1",
            "title": "Data Engineer",
            "company": "Acme",
            "url": "https://example.test/job-1",
            "description": "Fully remote worldwide",
        }
        job = normalize_job(raw)
        self.assertEqual(job.remote_status, RemoteStatus.FULLY_REMOTE_GLOBAL)
        self.assertTrue(filter_job(job, require_remote=True).accepted)
        self.assertEqual(len(deduplicate_jobs([job, normalize_job(raw)])), 1)
        result = rank_job(job, RankingEvidence(90, 80, 70, 60, eligibility="pass"))
        self.assertEqual(result.tier, "strong_fit")
        self.assertEqual(result.overall_score, 75.5)

    def test_fit_evaluation_and_drafting_validate_provider_json(self):
        provider = FakeProvider(
            [
                json.dumps({
                    "technical_score": 80,
                    "experience_score": 70,
                    "behavioral_score": 60,
                    "career_score": 90,
                    "strengths": ["Python"],
                    "gaps": [],
                }),
                json.dumps({"cv_source": "CV", "cover_letter_source": "Letter"}),
            ]
        )
        fit = evaluate_fit(provider, self.context)
        draft = draft_application(provider, self.context)
        self.assertEqual(fit.technical_score, 80)
        self.assertEqual(draft.cv_source, "CV")

    def test_reviewer_blocks_fabrication_flags(self):
        provider = FakeProvider([
            json.dumps({
                "approved": True,
                "issues": [],
                "fabrication_flags": ["Invented employer"],
                "ats_issues": [],
                "missing_requirements": [],
                "recommendations": [],
            })
        ])
        result = review_application(provider, self.context, "CV", "Letter")
        self.assertFalse(result.approved)
        self.assertEqual(result.fabrication_flags, ["Invented employer"])

    @patch("app.documents.pipeline.subprocess.run")
    def test_pdf_validation_reports_page_and_text_failures(self, run):
        run.side_effect = [
            type("Result", (), {"stdout": "Pages:          3\n"})(),
            type("Result", (), {"stdout": "short"})(),
        ]
        result = validate_pdf(
            Path("example.pdf"),
            expected_pages=2,
            required_text=("Missing",),
            min_characters=20,
            runner=run,
        )
        self.assertFalse(result.passed)
        self.assertIn("expected 2 page(s), found 3", result.errors)
        self.assertIn("text layer has 5 characters, expected at least 20", result.errors)
        self.assertIn("text layer is missing required text: Missing", result.errors)


if __name__ == "__main__":
    unittest.main()