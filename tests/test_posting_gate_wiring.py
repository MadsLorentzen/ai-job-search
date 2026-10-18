"""Where the posting integrity gate (tools/posting_guard.py) is wired beyond /apply
Step 0 and /rank Step 2: the archive, /interview, and the trust-boundary rules.

Why this test exists: a gate that only runs in one place is bypassed the moment
a posting reaches the workflow another way - from the archive in /interview, or
pasted by hand. These pins keep each entry point naming the gate, and keep the
archive free of the excerpts the gate removed (counts only), so a stripped
payload is never re-read by a later session.
"""
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APPLY = REPO / ".claude" / "commands" / "apply.md"
INTERVIEW = REPO / ".claude" / "commands" / "interview.md"
RESEARCH = REPO / ".claude" / "skills" / "job-application-assistant" / "09-web-research.md"


class ArchiveWiring(unittest.TestCase):
    def setUp(self):
        text = APPLY.read_text(encoding="utf-8")
        self.step6b = re.search(r"### Step 6b: Record the Application(.*?)(?=### Application-Form Fields)", text, re.DOTALL).group(1)

    def test_archive_stores_cleaned_text_with_counts_only(self):
        item7 = re.search(r"7\. \*\*Archive the posting now\.\*\*(.*?)(?=\n\n|\Z)", self.step6b, re.DOTALL).group(1)
        self.assertIn("verbatim", item7)  # still never a summary (test_apply_records_application pins it too)
        self.assertIn("posting_guard", item7)
        self.assertIn("counts", item7)
        self.assertRegex(item7, r"never .*excerpt", "removed content must not be re-archived as quotes")


class InterviewWiring(unittest.TestCase):
    def test_step1_gates_the_archived_posting_in_text_mode(self):
        text = INTERVIEW.read_text(encoding="utf-8")
        step1 = re.search(r"## Step 1: Load the Application Context(.*?)(?=\n## Step 2)", text, re.DOTALL).group(1)
        self.assertIn("posting_guard", step1)
        self.assertIn("--text", step1)


class TrustBoundaryWiring(unittest.TestCase):
    def test_09_trust_boundary_names_the_gate(self):
        text = RESEARCH.read_text(encoding="utf-8")
        boundary = re.search(r"## Trust boundary(.*?)(?=\n## )", text, re.DOTALL).group(1)
        self.assertIn("posting_guard", boundary)
        self.assertIn("framework_version: 1.1.5", text)


if __name__ == "__main__":
    unittest.main()
