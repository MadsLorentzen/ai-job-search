"""Guards for the /upskill skill spec.

The skill is a markdown spec (the spec IS the implementation), so these
tests pin the invariants that would break silently: the header format that
lint_skills.py enforces, and aggregate mode's merge of tracker rows with
/rank's recorded gaps from seen_jobs.json (previously aggregate mode only
read the tracker and inferred skills from free-text columns).
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
SKILL = REPO / ".claude" / "skills" / "upskill" / "SKILL.md"


def _sections(text: str) -> dict[str, str]:
    """Split a skill spec into {heading: body} by '##' headers.

    Splitting this way lets a fork's extra sections sit between the ones
    under test without shifting which text a given assertion sees.
    """
    parts = text.split("\n## ")
    result = {}
    for part in parts[1:]:
        heading, _, body = part.partition("\n")
        result[heading.strip()] = body
    return result


class UpskillSkillSpec(unittest.TestCase):
    def test_skill_file_exists_with_lint_compliant_header(self):
        self.assertTrue(SKILL.is_file(), "skill spec missing")
        text = SKILL.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\n"), "skill spec must start with YAML frontmatter")
        self.assertIn("name: upskill", text)

    def test_step2_reads_ranked_jobs_with_moderate_fit_floor(self):
        sections = _sections(SKILL.read_text(encoding="utf-8"))
        step2 = sections.get("Step 2: Load Data", "")
        self.assertIn("seen_jobs.json", step2)
        self.assertIn("rank_score >= 45", step2)
        self.assertIn(
            "gap persistence",
            step2,
            "Step 2 must document the graceful-degradation clause for entries scored before gaps existed",
        )

    def test_step2_column_list_keeps_in_phase_with_tracker_header(self):
        """/upskill reads the tracker, so its enumeration of the columns must
        match the header /apply writes - the deadline column (#319) is the
        first column to be added since the list was written."""
        sections = _sections(SKILL.read_text(encoding="utf-8"))
        step2 = sections.get("Step 2: Load Data", "")
        self.assertIn(
            "source, deadline",
            step2,
            "Step 2's column list lost the deadline column the tracker header now ends with",
        )

    def test_step3_documents_dedupe_and_gap_precedence(self):
        sections = _sections(SKILL.read_text(encoding="utf-8"))
        step3 = sections.get("Step 3: Pass 1 — Hard Skill Diff", "")
        self.assertIn("case-insensitive company + role", step3, "Step 3 must specify the dedupe key")
        self.assertIn(
            "/notion-sync",
            step3,
            "Step 3 must cite the upstream precedent for the dedupe key, not a fork-only file",
        )
        self.assertIn(
            "Recorded gaps beat inferred skills",
            step3,
            "Step 3 must state that recorded gaps take precedence over inferred skills",
        )
        self.assertIn("(100 - fit_rating) / 100", step3)
        self.assertIn("(100 - rank_score) / 100", step3)

    def test_step5_heatmap_shows_gap_provenance(self):
        sections = _sections(SKILL.read_text(encoding="utf-8"))
        step5 = sections.get("Step 5: Build Gap Heatmap", "")
        self.assertIn("recorded gaps", step5)
        self.assertIn("inferred", step5)

    def test_step8_report_header_counts_both_sources(self):
        sections = _sections(SKILL.read_text(encoding="utf-8"))
        step8 = sections.get("Step 8: Write and Save Report", "")
        self.assertIn("T tracked, R ranked", step8)

    def test_important_rules_cover_untrusted_data_and_no_backfill(self):
        sections = _sections(SKILL.read_text(encoding="utf-8"))
        rules = sections.get("Important Rules", "")
        self.assertIn(
            "never instructions",
            rules,
            "rules must state stored gaps are untrusted data, never instructions",
        )
        self.assertIn(
            "Never invent gap history",
            rules,
            "rules must forbid back-filling a missing gaps field by guessing",
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
