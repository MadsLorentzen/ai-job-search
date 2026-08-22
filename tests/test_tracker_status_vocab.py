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

They also pin the review findings on the fix itself:

3. The space spellings are the same statuses as the underscore forms (equally
   Final), so a reader applying the lists literally cannot land on "not Final,
   not Open, undefined" - which would otherwise misroute a closed application
   in /apply's append-vs-update decision.
4. The vocabulary block must not split Step 1's numbered list: section-scoped
   reads of Step 1 must still see items 2-4.
5. /html-report's bucket map needs a catch-all so no tracker value drops out of
   the stats silently, and /notion-sync must normalise space forms before
   writing Status (Notion auto-creates a select option per unique string).
6. /apply and /interview make status decisions and must anchor them to the
   block, not restate an ad-hoc set.

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

    def test_vocabulary_block_states_equivalence_of_space_forms(self):
        """The space spellings are the same statuses as the underscore forms, not
        separate values. Without this, a reader applying the Open/Final lists
        literally lands on "not Final, not Open, undefined" for `offer declined`,
        and /apply Step 6b would take the update branch for a closed application
        instead of appending a fresh row - losing the earlier document trail."""
        vocab = section(OUTCOME, VOCAB_ANCHOR)
        self.assertIn(
            "same values",
            vocab,
            "The vocabulary block must state that the space spellings are the same "
            "values as the canonical underscore forms",
        )
        self.assertIn(
            "not separate statuses",
            vocab,
            "The vocabulary block must state that the space spellings are not "
            "separate statuses",
        )
        self.assertIn(
            "equally",
            vocab,
            "The vocabulary block must state that the space spellings are equally "
            "Final, so finality decisions cover them",
        )

    def test_vocabulary_block_defines_open_by_exclusion(self):
        """Open is derived by exclusion from the one explicit Final list, so a new
        status needs updating in a single place and unknown values stay open until
        declared final."""
        vocab = section(OUTCOME, VOCAB_ANCHOR)
        self.assertIn(
            "everything else",
            vocab,
            "The vocabulary block must define Open as everything not in the Final "
            "list, not as a second explicit list that can drift",
        )

    def test_step1_section_contains_all_items(self):
        """The vocabulary block must live as its own section below Step 1's closing
        ---, not between Step 1's numbered items. A block inside the list truncates
        section-scoped reads of Step 1 to item 1, and a future test scoped to Step 1
        would pass against a stub."""
        step1 = section(OUTCOME, "## Step 1: Load State and Identify the Application")
        for needle in ("With an argument", "Without an argument", "Derive the archive"):
            self.assertIn(
                needle,
                step1,
                f"Step 1's numbered list must be intact - '{needle}' must sit inside "
                "Step 1, not under the vocabulary heading",
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
        # Scope to the bucket-map section, not the whole file, so the assertion
        # proves the mapping exists where stats are computed - a stray mention
        # anywhere else in the file would otherwise satisfy it.
        step1 = section(HTML_REPORT, "## Step 1: Collect Data")
        self.assertIn(
            "no response",
            step1,
            "/html-report must accept the legacy 'no response' (space) form so that "
            "existing trackers are not silently excluded from stats",
        )
        self.assertIn(
            "no_response",
            step1,
            "/html-report must accept the canonical 'no_response' (underscore) form",
        )
        self.assertIn(
            "offer declined",
            step1,
            "/html-report must accept the legacy 'offer declined' (space) form",
        )
        self.assertIn(
            "offer_declined",
            step1,
            "/html-report must accept the canonical 'offer_declined' (underscore) form",
        )

    def test_html_report_bucket_map_has_catch_all(self):
        """No tracker value may drop out of the stats silently: unrecognised values
        fall to Rejected/Closed and are named once in the status breakdown."""
        step1 = section(HTML_REPORT, "## Step 1: Collect Data")
        self.assertIn(
            "anything else",
            step1,
            "The bucket map must have a catch-all line for unrecognised tracker values",
        )
        self.assertIn(
            "unrecognised",
            step1,
            "The catch-all must name the unrecognised value once so the drop is "
            "visible instead of silent",
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
        self.assertNotIn(
            "no response",
            step2_text,
            "/gmail-sync Step 2 must not restate the space spellings locally - "
            "the vocabulary block is the single source for what counts as final, "
            "and a second local list is what drifted in #298",
        )

    def test_notion_sync_normalises_status_before_write(self):
        """Step 4 must map legacy space spellings to canonical before setting
        Status. Notion auto-creates a select option per unique string, so pushing
        a space form would give an existing database two options for one status
        and split closed applications across two filter buckets."""
        step4_text = section(NOTION_SYNC, "## Step 4: Upsert Database Rows")
        self.assertIn(
            "never push a space form",
            step4_text,
            "/notion-sync Step 4 must never write a space-form status to Notion",
        )
        self.assertIn(
            "Tracker status vocabulary",
            step4_text,
            "/notion-sync Step 4 must map space forms per the /outcome vocabulary block",
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
        # /apply's append-vs-update decision anchors to the vocabulary
        (
            APPLY,
            "### Step 6b: Record the Application",
            "Tracker status vocabulary",
            "apply.md Step 6b must anchor its final-status decision to the /outcome "
            "vocabulary block — a closed application must never be treated as open "
            "and get its row updated instead of appended",
        ),
        # /interview's live-process set anchors to the vocabulary
        (
            INTERVIEW,
            "## Step 0: Parse Input",
            "Tracker status vocabulary",
            "interview.md Step 0 must anchor its live-process statuses to the "
            "/outcome vocabulary block instead of restating an ad-hoc set",
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
