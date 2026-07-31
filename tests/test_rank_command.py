"""Guards for the /rank command spec.

The command is a markdown spec (the spec IS the implementation), so these
tests pin the invariants that would break silently: the header format that
lint_skills.py enforces, and the persistence of scoring-agent gaps/strengths
into seen_jobs.json (previously computed in Step 2 and thrown away after
Step 5's terminal output).
"""
import subprocess
import sys
import unittest
from pathlib import Path

try:
    import yaml  # noqa: F401 - only probing availability for the lint integration test
    _HAVE_YAML = True
except ImportError:
    _HAVE_YAML = False

REPO = Path(__file__).resolve().parent.parent
COMMAND = REPO / ".claude" / "commands" / "rank.md"
SCRAPER_SKILL = REPO / ".claude" / "skills" / "job-scraper" / "SKILL.md"


def _sections(text: str) -> dict[str, str]:
    """Split a command spec into {heading: body} by '##' headers.

    Splitting this way lets a fork's extra sections (e.g. this fork's
    '## Blocker logging') sit between the ones under test without shifting
    which text a given assertion sees.
    """
    parts = text.split("\n## ")
    result = {}
    for part in parts[1:]:
        heading, _, body = part.partition("\n")
        result[heading.strip()] = body
    return result


class RankCommandSpec(unittest.TestCase):
    def test_command_file_exists_with_lint_compliant_header(self):
        self.assertTrue(COMMAND.is_file(), "command spec missing")
        first_line = COMMAND.read_text(encoding="utf-8").splitlines()[0]
        self.assertTrue(
            first_line.startswith("# /rank"),
            f"header must start with '# /rank' (lint_skills.py enforces it), got: {first_line!r}",
        )

    def test_step4_persists_gaps_and_strengths(self):
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step4 = sections.get("Step 4: Update State", "")
        self.assertIn('"gaps"', step4, "Step 4 must persist the gaps array into seen_jobs.json")
        self.assertIn('"strengths"', step4, "Step 4 must persist the strengths array into seen_jobs.json")

    def test_step4_documents_verbatim_no_accumulate_and_untrusted_data_rules(self):
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step4 = sections.get("Step 4: Update State", "")
        self.assertIn("verbatim", step4, "Step 4 must require storing gaps/strengths verbatim, never reformatted")
        self.assertIn("replaces", step4, "Step 4 must state that --all re-scoring replaces, not accumulates, the arrays")
        self.assertIn("untrusted data", step4, "Step 4 must restate that stored gaps/strengths are untrusted data")

    def test_important_rules_link_honest_scoring_to_persistence(self):
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        rules = sections.get("Important Rules", "")
        self.assertIn(
            "persisted with it",
            rules,
            "Rule 5 must note that gaps are persisted (Step 4), not just printed (Step 5)",
        )

    def test_job_scraper_schema_note_mentions_strengths_and_gaps(self):
        text = SCRAPER_SKILL.read_text(encoding="utf-8")
        self.assertIn("strengths", text)
        self.assertIn("gaps", text)
        self.assertIn(
            "readers tolerate their absence",
            text,
            "schema note must say old entries lacking strengths/gaps are tolerated, never backfilled",
        )

    @unittest.skipUnless(
        _HAVE_YAML,
        "PyYAML not installed (the CI Python-test job omits it; the lint job runs lint_skills.py directly)",
    )
    def test_lint_skills_passes(self):
        result = subprocess.run(
            [sys.executable, str(REPO / "tools" / "lint_skills.py")],
            cwd=REPO,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, f"lint_skills.py failed:\n{result.stdout}{result.stderr}")


if __name__ == "__main__":
    unittest.main()
