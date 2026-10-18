"""Guards for the /notion-sync command spec.

The command is a markdown spec (the spec IS the implementation), so these
tests pin the invariants that would break silently: the header format that
lint_skills.py enforces, the gitignore entry that keeps the personal sync
state out of version control, and the privacy rule that forbids syncing
document content to Notion.
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
COMMAND = REPO / ".claude" / "commands" / "notion-sync.md"
GITIGNORE = REPO / ".gitignore"


class NotionSyncCommandSpec(unittest.TestCase):
    def test_command_file_exists_with_lint_compliant_header(self):
        self.assertTrue(COMMAND.is_file(), "command spec missing")
        first_line = COMMAND.read_text(encoding="utf-8").splitlines()[0]
        self.assertTrue(
            first_line.startswith("# /notion-sync"),
            f"header must start with '# /notion-sync' (lint_skills.py enforces it), got: {first_line!r}",
        )

    def test_command_file_is_substantive(self):
        text = COMMAND.read_text(encoding="utf-8")
        for section in ("## Step 0", "## Step 4", "## Important Rules"):
            self.assertIn(section, text, f"spec lost its {section!r} section")

    def test_personal_sync_state_is_gitignored(self):
        self.assertIn(
            "job_scraper/notion_sync.json",
            GITIGNORE.read_text(encoding="utf-8"),
            "notion_sync.json is personal state and must never be committable",
        )

    def test_step2_join_names_the_field_ranked_entries_actually_carry(self):
        # seen_jobs.json entries carry `title` (job-scraper SKILL.md schema), the
        # tracker carries `role`. "matched ... on company + role" read as a
        # lookup of `role` on the entry, which never matches, so one job became
        # two Notion rows with different Keys. The join is role-vs-title.
        text = COMMAND.read_text(encoding="utf-8")
        line = next(l for l in text.splitlines() if "matched to `job_scraper/seen_jobs.json` entries" in l)
        self.assertIn("company + title", line)
        self.assertIn("`title`", line)
        self.assertIn("`role`", line)
        self.assertNotIn("company + role", line)

    def test_privacy_rule_documents_never_sync(self):
        text = COMMAND.read_text(encoding="utf-8")
        self.assertIn(
            "never upload, attach, or embed",
            text,
            "spec lost the rule that CV/cover-letter content never syncs to Notion",
        )

    def test_step2_includes_expired_entries_in_sync_set(self):
        # #597: expired entries were excluded from the sync set, so a job that
        # was synced while ranked and later retired by /rank could never have
        # its Status updated to "expired" (rule 4.4). Step 2 must include them.
        text = COMMAND.read_text(encoding="utf-8")
        step2_line = next(
            l for l in text.splitlines()
            if l.startswith("2. Select `job_scraper/seen_jobs.json`")
        )
        self.assertIn("expired", step2_line,
            "Step 2 must include expired entries so rule 4.4 can fire")

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
