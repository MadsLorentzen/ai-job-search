"""Guards for the tracker status vocabulary (issue #298).

The tracker CSV `status` column has a single authoritative definition in
/outcome's "Tracker status vocabulary" block. Every reader that mentions
final or open statuses must defer to that block or explicitly accept both
the canonical underscore spellings and the legacy space spellings on read.

These tests pin the two concrete bugs that opened #298:

1. `offer declined` (space form, written by the old /outcome Step 4) landed
   in no /html-report bucket, silently shrinking the rejection-rate denominator.
2. `interview_only` was listed as a tracker bucket value in /html-report, but
   it belongs to the archive outcome.md Status: enum, never the CSV column.

They follow the CASES-table pattern from test_apply_records_application.py so
that adding a new reader is a one-line addition to READER_CASES.
"""
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COMMANDS = REPO / ".claude" / "commands"

OUTCOME = COMMANDS / "outcome.md"
GMAIL_SYNC = COMMANDS / "gmail-sync.md"
HTML_REPORT = COMMANDS / "html-report.md"
NOTION_SYNC = COMMANDS / "notion-sync.md"
APPLY = COMMANDS / "apply.md"
INTERVIEW = COMMANDS / "interview.md"

VOCAB_ANCHOR = "## Tracker status vocabulary"


def section(path: Path, heading: str) -> str:
    """Body of one markdown section, up to the next heading of any depth."""
    text = path.read_text(encoding="utf-8")
    start = text.index(heading) + len(heading)
    rest = text[start:]
    end = re.search(r"^#{1,4} ", rest, re.MULTILINE)
    return rest[: end.start()] if end else rest


class VocabularyBlockExists(unittest.TestCase):
    """The canonical definition must live in /outcome and nowhere else."""

    def test_outcome_has_vocabulary_block(self):
        self.assertIn(
            VOCAB_ANCHOR,
            OUTCOME.read_text(encoding="utf-8"),
            "/outcome must contain the ## Tracker status vocabulary block — "
            "that block is the single source of truth for tracker CSV spellings",
        )

    def test_vocabulary_block_lists_underscore_canonical_spellings(self):
        vocab = section(OUTCOME, VOCAB_ANCHOR)
        for canonical in ("no_response", "offer_declined"):
            self.assertIn(
                f"`{canonical}`",
                vocab,
                f"The vocabulary block must list `{canonical}` as a canonical spelling",
            )

    def test_vocabulary_block_has_read_tolerance_line(self):
        vocab = section(OUTCOME, VOCAB_ANCHOR)
        self.assertIn(
            "no response",
            vocab,
            "The vocabulary block must mention the legacy space spelling 'no response' "
            "so readers know to accept it on read",
        )
        self.assertIn(
            "offer declined",
            vocab,
            "The vocabulary block must mention the legacy space spelling 'offer declined' "
            "so readers know to accept it on read",
        )

    def test_outcome_step4_writes_underscore_forms(self):
        """The writer must use canonical underscore spellings, never space forms."""
        step4 = section(OUTCOME, "## Step 4: Update the Tracker")
        # The canonical forms must be present as the write target
        self.assertIn(
            "no_response",
            step4,
            "Step 4 must write `no_response` (underscore), not `no response` (space)",
        )
        self.assertIn(
            "offer_declined",
            step4,
            "Step 4 must write `offer_declined` (underscore), not `offer declined` (space)",
        )


class ReadersBucketMap(unittest.TestCase):
    """Each reader that classifies tracker values must handle both spellings
    and must not include archive-only values in tracker buckets."""

    def test_html_report_bucket_includes_space_and_underscore_forms(self):
        """Read-tolerance: both spellings must reach the Rejected/Closed bucket."""
        text = HTML_REPORT.read_text(encoding="utf-8")
        # The bucket line must carry both spelling variants so no tracker row
        # written by the old /outcome (space form) is silently dropped.
        self.assertIn(
            "no response",
            text,
            "/html-report must accept the legacy 'no response' (space) form so that "
            "existing trackers are not silently excluded from stats",
        )
        self.assertIn(
            "no_response",
            text,
            "/html-report must accept the canonical 'no_response' (underscore) form",
        )
        self.assertIn(
            "offer declined",
            text,
            "/html-report must accept the legacy 'offer declined' (space) form",
        )
        self.assertIn(
            "offer_declined",
            text,
            "/html-report must accept the canonical 'offer_declined' (underscore) form",
        )

    def test_html_report_bucket_does_not_contain_interview_only(self):
        """`interview_only` is the archive outcome.md Status: enum value,
        never a tracker CSV status. Listing it in the tracker bucket map
        confuses the two enums and would classify archive-only values
        that should not appear in the CSV."""
        # We only care about the bucket map section, not the whole file,
        # to avoid false positives from comments or this test file itself.
        step1 = section(HTML_REPORT, "## Step 1: Collect Data")
        self.assertNotIn(
            "interview_only",
            step1,
            "`interview_only` must not appear in /html-report's tracker bucket map — "
            "it is part of the archive `outcome.md` Status: enum, not a tracker CSV value",
        )

    def test_gmail_sync_references_vocabulary_block(self):
        """gmail-sync must defer to /outcome's vocabulary block for the
        open-application set, not hardcode the final-status set with
        space spellings that diverge from the writer."""
        step2_text = section(GMAIL_SYNC, "## Step 2: Load State")
        self.assertIn(
            "Tracker status vocabulary",
            step2_text,
            "/gmail-sync Step 2 must reference the /outcome vocabulary block "
            "instead of restating the final-status set with its own spellings",
        )

    def test_notion_sync_uses_underscore_status_spellings(self):
        """Notion Status select options must match canonical tracker spellings
        so that upserted values are consistent with what /outcome writes."""
        step3_text = section(NOTION_SYNC, "## Step 3: Load Sync State and Locate the Database")
        self.assertIn(
            "no_response",
            step3_text,
            "/notion-sync Step 3 must list `no_response` (underscore) as a Status "
            "option so it matches what /outcome writes to the tracker",
        )
        self.assertIn(
            "offer_declined",
            step3_text,
            "/notion-sync Step 3 must list `offer_declined` (underscore) as a Status "
            "option so it matches what /outcome writes to the tracker",
        )
        self.assertNotIn(
            "no response",
            step3_text,
            "/notion-sync Step 3 must not list 'no response' (space) as the primary "
            "option — Notion creates a distinct select value for each unique string, "
            "so mixing spellings creates duplicate options in the database",
        )


class ReaderCases(unittest.TestCase):
    """Spot-checks across readers that prove the vocabulary block is reachable
    from each command that makes decisions based on tracker status.

    Format: (path, heading_or_None, needle, failure_message)
    """

    CASES = [
        # /outcome owns the vocabulary; its readers must find it there
        (
            OUTCOME,
            VOCAB_ANCHOR,
            "underscores, never spaces",
            "The vocabulary block must state that underscores are canonical and "
            "spaces are not to be written",
        ),
        (
            OUTCOME,
            VOCAB_ANCHOR,
            "Final",
            "The vocabulary block must define the final-status set explicitly",
        ),
        # /html-report Step 2 excludes drafted from stats
        (
            HTML_REPORT,
            "## Step 2: Compute Summary Stats",
            "excluded from every statistic below",
            "drafted rows must be excluded from every statistic, not counted as sent",
        ),
        # /gmail-sync staleness check skips drafted
        (
            GMAIL_SYNC,
            "## Step 9: Staleness Check",
            "Skip `drafted` rows here",
            "the staleness check must skip drafted rows — nothing was sent, "
            "so nobody is late replying",
        ),
    ]

    def test_all_reader_cases(self):
        for path, heading, needle, why in self.CASES:
            with self.subTest(file=path.name, rule=needle):
                haystack = (
                    section(path, heading)
                    if heading
                    else path.read_text(encoding="utf-8")
                )
                self.assertIn(needle, haystack, why)


if __name__ == "__main__":
    unittest.main()
