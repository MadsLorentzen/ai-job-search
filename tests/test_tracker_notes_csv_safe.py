"""Guards for the rule that keeps free-form `notes` from breaking a tracker row.

No writer in this framework emits a quoted tracker field, so a comma inside
`notes` splits the row - for the `csv.DictReader` in `tools/rank_state.py` as
much as for a naive split - and shifts `cv_file`, `cover_letter_file` and
`source` a column left. A line break is worse: it ends the row. Two writers put
free-form text into `notes`: `/gmail-sync` Step 7a copies an email subject, and
`/outcome` Step 4 writes a short note of its own. The fixed-format writers
(`followed up YYYY-MM-DD`, `stale resolved no_response (YYYY-MM-DD)`,
`redrafted`) cannot contain the characters and are not listed.

The spec IS the implementation, so the guard is `CASES`: each rule must sit on
the line that instructs the append, not merely somewhere in the section. The
shape tests below it parse with `csv.DictReader` and document why the rule
exists; they pass on master too.
"""
import csv
import io
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COMMANDS = REPO / ".claude" / "commands"
GMAIL_SYNC = COMMANDS / "gmail-sync.md"
OUTCOME = COMMANDS / "outcome.md"

TRACKER_HEADER = (
    "date,company,sector,role,role_type,channel,status,contact_person,"
    "fit_rating,notes,cv_file,cover_letter_file,source,deadline"
)


def section(path, heading):
    """The body of one markdown section, up to the next heading of any depth."""
    text = path.read_text(encoding="utf-8")
    start = text.index(heading) + len(heading)
    rest = text[start:]
    end = re.search(r"^#{1,4} ", rest, re.MULTILINE)
    return rest[: end.start()] if end else rest


class FreeFormNotesWritersStateTheRule(unittest.TestCase):
    """Format: (path, heading, line_anchor, rule, why)"""

    CASES = [
        (
            GMAIL_SYNC,
            "### Step 7a: Write Approved Updates",
            "append to `notes`",
            "with every comma, double quote and line break deleted from the subject first",
            "Step 7a item 2 deliberately keeps the subject verbatim in `outcome.md`, "
            "so the rule must sit on the tracker append, not anywhere in the step",
        ),
        (
            OUTCOME,
            "## Step 4: Update the Tracker",
            "append a short dated note",
            "containing no commas, double quotes or line breaks",
            "Step 4 is the primary status-update path and its note is written "
            "free-form - `rejected, no feedback given` is the natural sentence",
        ),
    ]

    def test_rule_is_stated_where_the_append_happens(self):
        for path, heading, anchor, rule, why in self.CASES:
            with self.subTest(path=path.name, heading=heading):
                lines = [l for l in section(path, heading).splitlines() if anchor in l]
                self.assertEqual(len(lines), 1, f"expected one append instruction: {why}")
                self.assertIn(rule, lines[0], why)


class NotesShapeUnderTheShippedReader(unittest.TestCase):
    """Why the rule exists, demonstrated with the reader the repo ships."""

    SUBJECT = 'Re: Your application, Data Scientist - "next steps"'

    def test_sanitised_note_keeps_the_row_parseable(self):
        safe = self.SUBJECT.replace(",", "").replace('"', "")
        rows = self._parse(f'2026-09-12 gmail-sync: acknowledged ("{safe}")')

        self.assertEqual(len(rows), 1, "the note must not end the row early")
        row = rows[0]
        self.assertIsNone(row.get(None), "the row must be no wider than the header")
        self.assertEqual(row["cv_file"], "cv/main_acme_data_scientist.tex")
        self.assertEqual(
            row["cover_letter_file"], "cover_letters/cover_acme_data_scientist.tex"
        )
        self.assertEqual(row["source"], "linkedin")

    def test_a_comma_in_the_note_shifts_the_columns(self):
        for note in (
            f'2026-09-12 gmail-sync: acknowledged ("{self.SUBJECT}")',
            "2026-09-12 rejected, no feedback given",
        ):
            with self.subTest(note=note):
                row = self._parse(note)[0]
                self.assertIsNotNone(row.get(None), "the comma must widen the row")
                self.assertNotEqual(row["cv_file"], "cv/main_acme_data_scientist.tex")
                self.assertNotEqual(row["source"], "linkedin")

    def test_a_line_break_in_the_note_splits_the_row_in_two(self):
        rows = self._parse('2026-09-12 gmail-sync: acknowledged ("Re: update\nlater")')
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[0]["cv_file"], "the first row ends mid-note")

    @classmethod
    def _parse(cls, notes):
        stream = io.StringIO(TRACKER_HEADER + "\n" + cls._row(notes) + "\n")
        return list(csv.DictReader(stream))

    @staticmethod
    def _row(notes):
        return ",".join(
            [
                "2026-09-01",
                "Acme",
                "tech",
                "Data Scientist",
                "full_time",
                "portal",
                "applied",
                "",
                "8",
                notes,
                "cv/main_acme_data_scientist.tex",
                "cover_letters/cover_acme_data_scientist.tex",
                "linkedin",
                "2026-09-30",
            ]
        )


if __name__ == "__main__":
    unittest.main()
