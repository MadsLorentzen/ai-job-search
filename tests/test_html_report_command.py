"""Tests for the /html-report command and its gitignore rule.

Mirrors the pattern in test_security_guards.py: one class that verifies
properties of the real repo, testing the things CI would catch if the
command file or gitignore rule were wrong.
"""

import re
import subprocess
import sys
import unittest
from pathlib import Path

try:
    import yaml  # noqa: F401 - only probing availability for the lint integration test
    _HAVE_YAML = True
except ImportError:
    _HAVE_YAML = False

REPO_ROOT = Path(__file__).resolve().parent.parent
COMMAND_FILE = REPO_ROOT / ".claude" / "commands" / "html-report.md"
LINT_SCRIPT = REPO_ROOT / "tools" / "lint_skills.py"
GITIGNORE = REPO_ROOT / ".gitignore"


class HtmlReportCommandFileTests(unittest.TestCase):
    """Structural checks on the command file itself."""

    def test_command_file_exists(self):
        self.assertTrue(COMMAND_FILE.exists(), f"{COMMAND_FILE} not found")

    def test_command_file_starts_with_correct_header(self):
        """lint_skills.py rejects command files that don't start with '# /<name>'."""
        text = COMMAND_FILE.read_text(encoding="utf-8")
        first_line = text.lstrip().splitlines()[0]
        self.assertTrue(
            first_line.startswith("# /html-report"),
            f"Command file must start with '# /html-report', got: {first_line!r}",
        )

    def test_command_file_is_non_empty(self):
        text = COMMAND_FILE.read_text(encoding="utf-8").strip()
        self.assertGreater(len(text), 100, "Command file appears suspiciously short")


class HtmlReportTrackerFieldTests(unittest.TestCase):
    """The dashboard is a consumer of every tracker column: the Step 1 field
    enumeration and the Step 3 table columns must stay in phase with the
    canonical 14-column header (apply.md /outcome.md Step 1.1), so a future
    column addition cannot silently vanish from the dashboard the way
    `deadline` did."""

    # Derived, never copied: a header literal repeated in this file drifts in
    # lockstep with the spec it polices - add a 15th column to apply.md and a
    # stale hardcoded 14-column list still passes every comparison here (a
    # 14-column string is a substring of a 15-column header). Reading the
    # canonical line back from apply.md makes the simulated drift fail with a
    # clean list diff naming the missing column instead.
    CANONICAL_HEADER = re.search(
        r"^\s*(date,company,[a-z_,]+)$",
        (REPO_ROOT / ".claude" / "commands" / "apply.md").read_text(encoding="utf-8"),
        re.M,
    ).group(1).split(",")

    def test_step1_parses_every_canonical_tracker_column(self):
        text = COMMAND_FILE.read_text(encoding="utf-8")
        match = re.search(
            r"Parse every row into a record with fields:\n\s+((?:`[^`]+`,?\s*)+)",
            text,
        )
        self.assertIsNotNone(match, "Step 1 field enumeration not found")
        fields = [f.strip() for f in re.findall(r"`([^`]+)`", match.group(1))]
        self.assertEqual(fields, self.CANONICAL_HEADER)

    def test_step3_table_columns_include_deadline_after_date(self):
        """Date · Deadline order is the whole point of the change: the dashboard
        must surface the clock that drives `/rank`'s urgency next to the date.
        A membership pair (both `Date` and `Deadline` present somewhere) cannot
        tell a swapped order from the correct one, and the order is what the
        table shows the reader."""
        text = COMMAND_FILE.read_text(encoding="utf-8")
        match = re.search(r"### Table: columns to include\n\n(.+)\n", text)
        self.assertIsNotNone(match, "Step 3 table column list not found")
        line = match.group(1)
        self.assertIn(
            "`Date` · `Deadline` · `Company`",
            line,
            "Step 3 must offer the Deadline column directly after Date - the "
            "list defines the dashboard's column order, and a swapped order "
            "reads as a different table",
        )


class HtmlReportGitignoreTests(unittest.TestCase):
    """reports/ must be gitignored — it holds personal generated output."""

    def test_funnel_is_computed_from_stage_history_not_current_status(self):
        """status is a current state, not a history: an application that
        interviewed and was then rejected carries status `rejected` and would
        never count as having reached Interview, so a finished search reads
        as though nobody ever interviewed (review finding F10, 2026-08-19).
        The stage checkboxes merged from outcome.md in Step 1.2 are the
        history; the funnel must be told to use them."""
        text = COMMAND_FILE.read_text(encoding="utf-8")
        self.assertIn(
            "stage checkboxes",
            text.split("## Step 3")[0].split("## Step 2")[1],
            "Step 2's funnel definition must derive stage-reached from the "
            "merged outcome.md stage checkboxes",
        )
        self.assertIn(
            "not current status",
            text,
            "the funnel rule must say explicitly that current status alone undercounts",
        )

    def test_rejection_rate_excludes_declined_offers_and_withdrawals(self):
        """offer_declined is the candidate turning an offer down (a success)
        and withdrawn is candidate-initiated; counting either as a rejection
        inflates the rejection rate on a self-assessment dashboard (review
        finding F11, 2026-08-19)."""
        text = COMMAND_FILE.read_text(encoding="utf-8")
        self.assertIn(
            "`offer_declined`",
            text.split("## Step 3")[0].split("## Step 2")[1],
            "the rejection-rate definition must address offer_declined",
        )
        self.assertIn(
            "not rejections",
            text,
            "the rate must exclude candidate-initiated outcomes explicitly",
        )

    def test_reports_folder_is_gitignored(self):
        rules = {line.strip() for line in GITIGNORE.read_text(encoding="utf-8").splitlines()}
        self.assertIn(
            "reports/",
            rules,
            "reports/ must be listed in .gitignore — generated dashboards are personal output",
        )


@unittest.skipUnless(
    _HAVE_YAML,
    "PyYAML not installed (the CI Python-test job omits it; the lint job runs lint_skills.py directly)",
)
class HtmlReportLintIntegrationTests(unittest.TestCase):
    """lint_skills.py must pass after the command is added."""

    def test_lint_passes_on_real_repo(self):
        result = subprocess.run(
            [sys.executable, str(LINT_SCRIPT)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode,
            0,
            f"lint_skills.py failed:\n{result.stdout}{result.stderr}",
        )
        self.assertIn("OK", result.stdout)


if __name__ == "__main__":
    unittest.main()
