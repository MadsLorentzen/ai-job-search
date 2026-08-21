"""Guards for /gmail-sync's Gmail query semantics.

The command's stated intent is "skip sent/drafts - status signals come
from what employers send you". `in:inbox` does not mean that: it matches
only messages currently IN the inbox, so it also excludes every archived
message - and, self-defeatingly, the mail matched by the very
job-search label Step 3.1 hunts for, because the standard filter that
applies such a label also archives ("skip the inbox"). The correct
operators for the stated intent are `-in:sent -in:drafts` (review
finding F18, 2026-08-19). The failure mode is silent under-detection: a
missed rejection or interview invite just looks like "no updates".
"""
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GMAIL_SYNC = REPO / ".claude" / "commands" / "gmail-sync.md"


class TestGmailQueryOperators(unittest.TestCase):
    def setUp(self):
        self.text = GMAIL_SYNC.read_text(encoding="utf-8")

    def test_query_excludes_sent_and_drafts_explicitly(self):
        self.assertIn(
            "-in:sent -in:drafts",
            self.text,
            "the query must exclude sent/drafts with negative operators, "
            "which keep archived and label-filtered mail in scope",
        )

    def test_query_never_restricts_to_the_inbox(self):
        self.assertNotIn(
            "in:inbox",
            self.text.replace("-in:sent", "").replace("-in:drafts", ""),
            "in:inbox silently drops archived mail and everything a "
            "label-and-archive filter routed past the inbox - exactly the "
            "mail the label search in Step 3.1 exists to find",
        )


if __name__ == "__main__":
    unittest.main()
