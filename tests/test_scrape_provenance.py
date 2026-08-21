"""Guards for /scrape's result-provenance recording.

The scraper is a markdown spec (the spec IS the implementation), so these
tests pin the invariants that would break silently: seen_jobs.json entries
record whether they came from a portal CLI or the WebSearch fallback
(`source`), and the Step 5 summary names the portals that ran on the
fallback. Together these keep a ghost-job report diagnosable days after
the run's scrollback is gone (#331): a stale-index entry, a live-CLI
entry, and a job with no entry at all each point at a different mechanism.
"""
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKILL = REPO / ".claude" / "skills" / "job-scraper" / "SKILL.md"


def _steps(text: str) -> dict[str, str]:
    """Split the skill spec into {heading: body} by '###' step headers.

    Splitting this way lets a fork's extra steps sit between the ones
    under test without shifting which text a given assertion sees.
    """
    result = {}
    for part in text.split("\n### ")[1:]:
        heading, _, body = part.partition("\n")
        result[heading.strip()] = body
    return result


class ScrapeProvenanceSpec(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.steps = _steps(cls.text)

    def test_schema_block_carries_source_field(self):
        step4 = self.steps.get("Step 4: Deduplicate & Store", "")
        self.assertIn(
            '"source": "cli/websearch"',
            step4,
            "the seen_jobs.json schema block lost the source (provenance) field",
        )

    def test_source_field_is_additive_and_never_backfilled(self):
        step4 = self.steps.get("Step 4: Deduplicate & Store", "")
        self.assertIn(
            "`cli` for Step 1b portal-CLI output, `websearch` for the Step 1c fallback",
            step4,
            "Step 4 must define which mechanism each source value names",
        )
        self.assertIn(
            "the mechanism was not recorded",
            step4,
            "Step 4 must forbid back-filling source on entries that predate the field",
        )

    def test_fallback_results_are_tagged_at_the_source(self):
        step1 = self.steps.get("Step 1: Search", "")
        fallback = step1.partition("#### 1c. WebSearch fallback")[2]
        self.assertIn(
            "Step 4 persists this as the entry's `source`",
            fallback,
            "Step 1c must tag fallback results so Step 4 has a provenance value to store",
        )

    def test_step5_summary_names_fallback_portals(self):
        step5 = self.steps.get("Step 5: Present Results", "")
        self.assertIn(
            "fallback (websearch):",
            step5,
            "Step 5 must surface which portals ran on the WebSearch fallback this run",
        )
        self.assertIn(
            "omit the line when every portal ran its CLI",
            " ".join(step5.split()),
            "the fallback line must be omitted when every portal ran its CLI, not printed empty",
        )


class TestRecencyFallback(unittest.TestCase):
    """Step 1b.3 says to scope to the last 14 days via the portal's recency
    flag - but not every portal has one (jobdanmark offers no date filter or
    sort at all), which left the instruction unsatisfiable there: the agent
    either silently skipped the scoping or invented a flag, and inventing a
    flag is exactly what the UNKNOWN_FLAG rejection now errors on (review
    finding F32, 2026-08-19). Every portal emits a `date` field, so
    client-side filtering is always available as the fallback."""

    def test_step1b_names_a_client_side_fallback_for_flagless_portals(self):
        text = SKILL.read_text(encoding="utf-8")
        self.assertIn(
            "no recency flag",
            text,
            "Step 1b.3 must say what to do when a portal offers no recency flag",
        )
        self.assertIn(
            "filter client-side",
            text,
            "the fallback is filtering results by their `date` field after the call",
        )
        self.assertIn(
            "a sort is not a filter",
            text,
            "the instruction must stop presenting --order (a sort) as interchangeable with a filter",
        )


if __name__ == "__main__":
    unittest.main()
