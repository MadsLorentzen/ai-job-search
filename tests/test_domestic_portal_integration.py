"""End-to-end contract guards for Chinese portal data flowing into /rank.

The workflow implementation is split between the TypeScript portal adapter and
the canonical markdown specifications. These tests pin their shared field and
routing contract without making network requests.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ZHAOPIN_HELPERS = REPO / ".agents" / "skills" / "zhaopin-search" / "cli" / "src" / "helpers.ts"
SCRAPER = REPO / ".claude" / "skills" / "job-scraper" / "SKILL.md"
RANK = REPO / ".claude" / "commands" / "rank.md"

SHARED_FIELDS = {
    "portal",
    "source",
    "access_mode",
    "raw_id",
    "salary",
    "salary_min",
    "salary_max",
    "salary_months",
    "salary_unit",
    "experience",
    "education",
}


def stored_schema_fields() -> set[str]:
    text = SCRAPER.read_text(encoding="utf-8")
    match = re.search(r"Add ALL fetched jobs.*?```json(.*?)```", text, re.DOTALL)
    if match is None:
        raise AssertionError("Step 4 seen_jobs.json schema block not found")
    return set(re.findall(r'"([a-z_]+)"\s*:', match.group(1)))


class DomesticPortalIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = ZHAOPIN_HELPERS.read_text(encoding="utf-8")
        cls.scraper = SCRAPER.read_text(encoding="utf-8")
        cls.rank = RANK.read_text(encoding="utf-8")

    def test_zhaopin_emits_discoverable_portal_and_read_only_provenance(self):
        self.assertIn('portal: "zhaopin-search"', self.adapter)
        self.assertIn('source,', self.adapter)
        self.assertIn('access_mode: "public_html"', self.adapter)
        self.assertIn('raw_id: job.id', self.adapter)

    def test_seen_jobs_schema_persists_shared_chinese_fields(self):
        self.assertTrue(
            SHARED_FIELDS <= stored_schema_fields(),
            f"missing shared fields: {sorted(SHARED_FIELDS - stored_schema_fields())}",
        )

    def test_rank_resolves_portal_detail_with_raw_id(self):
        self.assertIn(".agents/skills/<portal>/SKILL.md", self.rank)
        self.assertIn("Prefer `raw_id`", self.rank)
        self.assertIn("documented read-only `detail` command", self.rank)
        self.assertIn("never substitute for fetching the posting", self.rank)

    def test_rank_consumes_and_preserves_chinese_normalization_fields(self):
        for field in SHARED_FIELDS:
            self.assertIn(f"`{field}`", self.rank, f"/rank does not name {field}")
        self.assertIn("China-market normalization notes", self.rank)
        self.assertIn("never rebuilds an entry", self.rank)

    def test_rank_does_not_treat_salary_as_an_automatic_fit_boost(self):
        normalized = " ".join(self.rank.split())
        self.assertIn("does not independently raise a fit score", normalized)
        self.assertIn("unparseable/hidden salary as unknown", normalized)


if __name__ == "__main__":
    unittest.main()
