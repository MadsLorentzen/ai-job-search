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
        step2_lines = [l for l in text.splitlines()
                       if l.startswith("2. Select `job_scraper/seen_jobs.json`")
                       or l.startswith("2a.")]
        combined = " ".join(step2_lines)
        self.assertIn("expired", combined,
            "Step 2 must include expired entries so rule 4.4 can fire")

    def test_step2a_expired_entries_are_a_separate_bullet(self):
        # The expired-entries rule must be its own numbered bullet, not buried
        # inside the ranked-entries bullet - a reader scanning Step 2 for the
        # expired rule must find it as a distinct step.
        text = COMMAND.read_text(encoding="utf-8")
        lines = text.splitlines()
        expired_bullet = next(
            (l for l in lines if l.startswith("2a.") and "expired" in l),
            None,
        )
        self.assertIsNotNone(expired_bullet,
            "Step 2a must exist as a separate bullet for expired entries")
        self.assertIn("expired", expired_bullet or "")

    def test_step4_skips_expired_entries_with_no_match(self):
        # An expired entry with no existing page was never synced while ranked,
        # so creating a page for it would pollute the database. Step 4.2 must
        # skip expired entries on the no-match branch.
        text = COMMAND.read_text(encoding="utf-8")
        no_match_line = next(
            l for l in text.splitlines()
            if l.startswith("2. **No match**")
        )
        self.assertIn("expired", no_match_line,
            "Step 4.2 must skip expired entries with no match")

    def test_step5_never_writes_body_for_expired(self):
        # Page bodies are write-once, so a body written for an expired job
        # can never be fixed by a later rebuild. Step 5 must refuse to write
        # a body for expired entries, including under --rebuild.
        text = COMMAND.read_text(encoding="utf-8")
        step5_section = text.split("## Step 5")[1].split("## Step 6")[0]
        self.assertIn("expired", step5_section,
            "Step 5 must refuse to write a body for expired entries")
        self.assertIn("--rebuild", step5_section,
            "Step 5 must explicitly cover the --rebuild case for expired")

    def test_step2_stops_on_expired_only_sync_set(self):
        # An expired-only sync set on a first run has nothing to create (Step
        # 4.2 skips expired with no match) and nothing to update (no existing
        # pages), so the command must stop without creating the database.
        text = COMMAND.read_text(encoding="utf-8")
        step2_lines = [l for l in text.splitlines()
                       if l.startswith("5. **If the sync set is empty**")]
        self.assertTrue(step2_lines,
            "Step 2.5 must exist")
        self.assertIn("expired", step2_lines[0],
            "Step 2.5 must stop on an expired-only sync set")

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
