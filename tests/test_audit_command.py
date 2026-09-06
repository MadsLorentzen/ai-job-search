"""Tests for the /audit command specification."""

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AUDIT_COMMAND_FILE = REPO_ROOT / ".claude" / "commands" / "audit.md"


class AuditCommandTests(unittest.TestCase):
    def test_audit_command_file_exists(self):
        self.assertTrue(AUDIT_COMMAND_FILE.exists(), "audit.md must exist under .claude/commands/")

    def test_audit_command_file_starts_with_correct_header(self):
        text = AUDIT_COMMAND_FILE.read_text(encoding="utf-8")
        first_line = text.lstrip().splitlines()[0]
        self.assertTrue(
            first_line.startswith("# /audit"),
            f"Command file must start with '# /audit', got: {first_line!r}",
        )

    def test_audit_covers_core_diagnostic_steps(self):
        text = AUDIT_COMMAND_FILE.read_text(encoding="utf-8")
        self.assertIn("Step 0: Environment & Binary Availability", text)
        self.assertIn("Step 1: Candidate Profile & Onboarding Completeness", text)
        self.assertIn("Step 2: Portal Search Skills Status", text)
        self.assertIn("Step 3: Application Tracker & Archives Integrity", text)
        self.assertIn("Step 4: Upstream Updates & Security Guards", text)
        self.assertIn("Step 5: Diagnostic Report & Actionable Next Steps", text)

    def test_audit_tracker_header_matches_canonical_header(self):
        text = AUDIT_COMMAND_FILE.read_text(encoding="utf-8")
        canonical = (
            "date,company,role,status,source,fit,salary,contact_person,"
            "application_deadline,interview_date,notes,cv_file,cover_letter_file,archive_folder"
        )
        self.assertIn(canonical, text, "audit.md must enforce the canonical 14-column tracker header")


if __name__ == "__main__":
    unittest.main()
