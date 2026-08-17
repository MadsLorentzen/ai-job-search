from __future__ import annotations

import os
import unittest

from product.job_understanding import extract_job_understanding
from product.openai_job_understanding_provider import OpenAIJobUnderstandingProvider


LIVE_ENABLED = (
    os.environ.get("RUN_OPENAI_LIVE_TESTS") == "1"
    and bool(os.environ.get("OPENAI_API_KEY", "").strip())
)


@unittest.skipUnless(
    LIVE_ENABLED,
    "requires RUN_OPENAI_LIVE_TESTS=1 and OPENAI_API_KEY",
)
class OpenAIJobUnderstandingLiveSmokeTest(unittest.TestCase):
    def test_synthetic_posting_produces_exact_grounded_evidence(self):
        exact_text = "Applicants must have professional Python experience."
        job = {
            "schema_version": "job-posting-snapshot.v0",
            "job_id": "synthetic-openai-live-smoke",
            "source": "synthetic-live-test",
            "captured_at": "2026-08-16T12:00:00Z",
            "company": "Synthetic Example Ltd",
            "title": "Synthetic Software Engineer",
            "raw_text": exact_text,
            "requirements": [],
            "responsibilities": [],
            "language_requirements": [],
            "eligibility_requirements": [],
            "logistics_requirements": [],
        }
        result = extract_job_understanding(
            job,
            OpenAIJobUnderstandingProvider(),
            "synthetic-openai-live-smoke",
            requested_categories=["requirements"],
        )
        accepted = result["requirements"]
        self.assertGreaterEqual(len(accepted), 1)
        self.assertTrue(
            any(item["text"] in exact_text for item in accepted),
            accepted,
        )
        for item in accepted:
            citation = item["citations"][0]
            self.assertEqual(
                exact_text[citation["start"] : citation["end"]],
                citation["quote"],
            )


if __name__ == "__main__":
    unittest.main()
