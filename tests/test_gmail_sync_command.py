"""Guards for /gmail-sync's Gmail query semantics and its tracker write.

The command's stated intent is "skip sent/drafts - status signals come
from what employers send you". `in:inbox` does not mean that: it matches
only messages currently IN the inbox, so it also excludes every archived
message - and, self-defeatingly, the mail matched by the very
job-search label Step 3.1 hunts for, because the standard filter that
applies such a label also archives ("skip the inbox"). The correct
operators for the stated intent are `-in:sent -in:drafts` (review
finding F18, 2026-08-19). The failure mode is silent under-detection: a
missed rejection or interview invite just looks like "no updates".

Step 7a's `notes` append is the second concern. It interpolates a raw
email subject into a tracker no writer ever quotes a field of, so an
everyday subject - one with a comma in it - shifts `cv_file`,
`cover_letter_file` and `source` a column left on that row. The shape
tests below parse with `csv.DictReader`, which is what the repo's only
machine reader of the tracker uses (`tools/rank_state.py`), so the
corruption is demonstrated against a real RFC 4180 parser rather than
against a naive split that would make it look worse than it is.
"""
import csv
import io
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GMAIL_SYNC = REPO / ".claude" / "commands" / "gmail-sync.md"

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


class TestNotesAppendIsCsvSafe(unittest.TestCase):
    """Step 7a must strip the two characters that break a flat comma split."""

    # A representative employer acknowledgement: the role named after a comma,
    # the title quoted back. Both offending characters arrive without anyone
    # crafting them - that is the point, not that this exact string was logged.
    SUBJECT = 'Re: Your application, Data Scientist - "next steps"'

    def setUp(self):
        self.step_7a = section(GMAIL_SYNC, "### Step 7a: Write Approved Updates")

    def test_rule_is_stated_where_the_append_happens(self):
        # Scoped to the append instruction, not to Step 7a as a whole. Item 2 of
        # the same step deliberately keeps the subject verbatim in `outcome.md`,
        # so a section-wide assertion would still pass with the rule sitting on
        # the one instruction it must never apply to.
        append_rule = next(
            line for line in self.step_7a.splitlines() if "append to `notes`" in line
        )
        self.assertIn(
            "with every comma, double quote and line break deleted from the subject first",
            append_rule,
            "the escaping rule has to sit on the append instruction itself - a "
            "general note elsewhere in the file is exactly the kind of remembered "
            "step this command keeps failing to perform",
        )

    def test_sanitised_subject_keeps_the_row_parseable(self):
        safe = self.SUBJECT.replace(",", "").replace('"', "")
        rows = self._parse(f'2026-09-12 gmail-sync: acknowledged ("{safe}")')

        self.assertEqual(len(rows), 1, "the note must not end the row early")
        row = rows[0]
        self.assertIsNone(
            row.get(None),
            "a sanitised subject must leave the row no wider than the header",
        )
        self.assertEqual(row["cv_file"], "cv/main_acme_data_scientist.tex")
        self.assertEqual(
            row["cover_letter_file"], "cover_letters/cover_acme_data_scientist.tex"
        )
        self.assertEqual(row["source"], "linkedin")

    def test_raw_subject_is_what_breaks_the_row(self):
        """The defect itself, so the guard above cannot pass vacuously."""
        rows = self._parse(f'2026-09-12 gmail-sync: acknowledged ("{self.SUBJECT}")')
        row = rows[0]
        self.assertIsNotNone(row.get(None), "the unescaped comma must widen the row")
        self.assertNotEqual(row["cv_file"], "cv/main_acme_data_scientist.tex")
        self.assertNotEqual(row["source"], "linkedin")

    def test_a_line_break_in_the_subject_splits_the_row_in_two(self):
        """Why the rule names line breaks too: worse than a comma, not better."""
        rows = self._parse('2026-09-12 gmail-sync: acknowledged ("Re: update\nlater")')
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[0]["cv_file"], "the first row ends mid-note")

    @classmethod
    def _parse(cls, notes):
        """Read the row back the way `tools/rank_state.py` reads the tracker."""
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
