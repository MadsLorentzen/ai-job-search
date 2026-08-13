"""Guards for /apply's tracker recording step (Step 6b).

The step is part of the /apply markdown spec (the spec IS the
implementation), so these tests pin the invariants that would break
silently. Assertions are scoped to the section they belong to, following
the pattern in test_upskill_skill.py: a whole-file `assertIn` for a word
as common as `drafted` passes on any unrelated mention and guards nothing.

The CSV header is the one rule most easily lost: it must stay
byte-identical to /outcome's, which is the entire reason for reusing it.
How each reader treats `drafted` is pinned per reader below, because the
right answer differs between them.
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

REPO = Path(__file__).resolve().parent.parent
COMMANDS = REPO / ".claude" / "commands"
APPLY = COMMANDS / "apply.md"
OUTCOME = COMMANDS / "outcome.md"
GMAIL_SYNC = COMMANDS / "gmail-sync.md"
HTML_REPORT = COMMANDS / "html-report.md"
NOTION_SYNC = COMMANDS / "notion-sync.md"
SKILL = REPO / ".claude" / "skills" / "job-application-assistant" / "SKILL.md"
SCRAPER = REPO / ".claude" / "skills" / "job-scraper" / "SKILL.md"

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


class ApplyRecordsApplication(unittest.TestCase):
    """/apply Step 6b writes the row that six other commands read."""

    def setUp(self):
        self.step_6b = section(APPLY, "### Step 6b: Record the Application")

    def test_step_writes_a_drafted_row_with_both_document_paths(self):
        for fragment in (
            "| `status` | `drafted` |",
            '| `cv_file`, `cover_letter_file` | the two paths listed under "Files Created"',
        ):
            self.assertIn(
                fragment,
                self.step_6b,
                f"Step 6b's column table lost {fragment!r} - the row it writes would "
                "no longer identify itself as a draft or point at the documents",
            )

    def test_tracker_header_matches_outcome(self):
        """Byte-identical, or the two commands create incompatible CSVs.

        The equality check below is load-bearing, not decoration. `assertIn`
        alone cannot see an *additive* drift: a thirteen-column header is a
        substring of a fourteen-column one, so appending a column to `/apply`
        and forgetting `/outcome` passed this test cleanly until it was added.
        """
        self.assertIn(TRACKER_HEADER, OUTCOME.read_text(encoding="utf-8"))
        self.assertIn(
            TRACKER_HEADER,
            self.step_6b,
            "Step 6b's header drifted from outcome.md's - whichever command ran "
            "first would decide the schema",
        )
        for name, text in (("outcome.md", OUTCOME.read_text(encoding="utf-8")),
                           ("apply.md Step 6b", self.step_6b)):
            header = next(
                (ln.strip() for ln in text.splitlines() if ln.strip().startswith("date,company,")),
                None,
            )
            self.assertEqual(
                header,
                TRACKER_HEADER,
                f"{name}'s header line is not exactly the canonical header - a column "
                "appended to one file and not the other leaves both containing the "
                "shorter header as a substring, which assertIn alone cannot catch",
            )

    def test_deadline_is_appended_last(self):
        """Appended after `source`, never inserted.

        An existing thirteen-column tracker then reads as a row with an empty
        trailing field. Inserted anywhere else, every value in every existing
        row is silently re-labelled by one position.
        """
        self.assertTrue(
            TRACKER_HEADER.endswith(",source,deadline"),
            "deadline must stay the last column, directly after source",
        )

    def test_step_runs_before_the_optional_offer_that_ends_the_turn(self):
        """The optional application-form offer asks the user a question.

        Anything after it only runs if the user answers, so recording the
        application there would reproduce the bug this step fixes.
        """
        text = APPLY.read_text(encoding="utf-8")
        self.assertLess(
            text.index("### Step 6b: Record the Application"),
            text.index("### Application-Form Fields"),
            "Step 6b moved after the optional-artifact offer, which ends the turn "
            "on a question - the tracker row would be skipped whenever the user "
            "never answers",
        )

    def test_matched_row_is_never_moved_backwards(self):
        self.assertIn(
            "never move it backwards",
            self.step_6b,
            "Step 6b lost the rule protecting a submitted row - re-running /apply "
            "to refresh a CV would reset a live interview back to drafted",
        )

    def test_redraft_marker_is_undated(self):
        """/outcome reads the latest dated note as the last activity."""
        self.assertIn(
            "undated `redrafted` marker",
            self.step_6b,
            "a dated redraft marker resets /outcome's days-quiet clock, hiding a "
            "genuinely quiet application from the follow-up offer",
        )

    def test_seen_jobs_is_left_alone(self):
        self.assertIn(
            "Do not modify `job_scraper/seen_jobs.json`",
            self.step_6b,
            "drafting is not applying, and that file has no honest value for either",
        )

    def test_skill_defers_to_apply_rather_than_restating(self):
        """/scrape Step 5 routes into the skill, bypassing /apply entirely."""
        step_3b = section(SKILL, "### Step 3b: Record the Application")
        self.assertIn(
            "`/apply` Step 6b",
            step_3b,
            "the skill's recording step no longer points at the canonical rule, so "
            "the two copies can drift",
        )


class DraftedMeansDraftedToEveryReader(unittest.TestCase):
    """`drafted` is non-final, so readers that mean *submitted* must say so.

    Each of these defines its set by exclusion from the final statuses, so
    a new non-final value joins them all silently. The one exception is
    /gmail-sync, which must keep searching for drafted rows: the user
    submitting by hand and not running /outcome is the failure #269 is
    about, and an employer reply is how it gets caught.
    """

    CASES = [
        (HTML_REPORT, None, "`drafted` → **Drafted**",
         "a status with no bucket is dropped from every statistic"),
        (HTML_REPORT, "## Step 2: Compute Summary Stats",
         "excluded from every statistic below",
         "the headline count would include applications that were never sent"),
        (OUTCOME, "## Step 2b: Follow-Up Branch", "neither final nor `drafted`",
         "it would chase an employer who received nothing"),
        (OUTCOME, "## Step 4: Update the Tracker",
         "overwrite its `date` column with the actual submission date",
         "the drafting date would be reported as the application date"),
        (GMAIL_SYNC, None, "`drafted` rows stay in this set",
         "excluding them discards the row that identifies a submitted-but-"
         "unrecorded application, which is the recovery #269 asks for"),
        (GMAIL_SYNC, "## Step 5", "`drafted` -> `applied`, otherwise",
         "the acknowledgement is the one email that proves a hand-submitted "
         "application was sent; classified as noise, the recovery never fires"),
        (GMAIL_SYNC, "### Step 7a", "also set `date` to the email's date",
         "the row would keep the drafting date after being proved submitted"),
        (GMAIL_SYNC, "## Step 9: Staleness Check", "Skip `drafted` rows here",
         "an unsent draft reported as a forgotten application"),
        (NOTION_SYNC, None, "omit when the status is `drafted`",
         "an 'Applied on' date for a job never applied to"),
        (NOTION_SYNC, None, "not yet submitted",
         "page bodies are write-once, so calling drafts 'submitted documents' "
         "is permanent even after /outcome records the real submission"),
        (SCRAPER, None, "do not add a second row",
         "/scrape would duplicate the row Step 3b just wrote"),
        (APPLY, "### Step 6b: Record the Application", "bare number, 0-100",
         "/upskill divides by fit_rating, so `72/100` or a verdict word breaks it"),
        (APPLY, "### Step 6b: Record the Application", "append a new row",
         "re-applying after a rejection would overwrite the old application"),
    ]

    def test_every_reader_handles_drafted(self):
        for path, heading, needle, why in self.CASES:
            with self.subTest(file=path.name, rule=needle):
                haystack = section(path, heading) if heading else path.read_text(encoding="utf-8")
                self.assertIn(needle, haystack, why)

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


class ApplyArchivesThePosting(unittest.TestCase):
    """Step 6b must also write the posting text it is holding to the archive."""

    CASES = [
        (APPLY, "## Step 0: Parse Input",
         "full posting text verbatim",
         "by Step 6b the model may hold only a summary, so the archive gets a "
         "paraphrase - what /outcome Step 3.2 forbids"),
        (APPLY, "### Step 6b: Record the Application",
         "`documents/applications/<company>_<role>/job_posting.md`",
         "the one moment /apply provably holds the posting is spent again, and "
         "a pasted posting has no recovery path at all"),
        (APPLY, "### Step 6b: Record the Application",
         "never a fresh fetch",
         "a model that no longer holds the text would re-fetch to comply, the "
         "dead-URL path this whole item exists to avoid"),
        (APPLY, "### Step 6b: Record the Application",
         "`/outcome` Step 1.4",
         "the derivation is no longer pinned to /outcome's, so a later edit to "
         "either can silently orphan the archive"),
        (OUTCOME, "## Step 1: Load State and Identify the Application",
         "4. Derive the archive folder name",
         "apply.md item 7 defers its folder derivation to /outcome Step 1.4 by "
         "number; renumbering Step 1 leaves that citation dangling"),
        (APPLY, "### Step 6b: Record the Application",
         "**If the file already exists, leave it**",
         "re-running /apply to refresh a CV would overwrite the posting that "
         "was actually applied against"),
        (APPLY, "### Step 6b: Record the Application",
         "keeps the older posting",
         "the leave-it rule would read as if the folder is always fresh, hiding "
         "that a re-application to the same role collides with the old archive"),
        (APPLY, "### Step 6b: Record the Application",
         "left in place rather than written",
         "the skip discards the current posting silently, and /interview preps "
         "against the earlier application's posting"),
        (APPLY, "### Step 6b: Record the Application",
         "never reconstruct it from memory",
         "a model that reached Step 6b without the text could satisfy none of "
         "item 7's constraints, and would write a remembered posting instead"),
        (SKILL, "### Step 1: Research & Evaluate Fit",
         "full posting text verbatim",
         "the /scrape path never runs /apply Step 0, so nothing stops it "
         "compressing the posting before Step 3b archives it"),
        (SKILL, "### Step 3b: Record the Application",
         "same posting archive",
         "the /scrape path reaches Step 3b without running /apply, and its "
         "closed enumeration of Step 6b's rules would omit the archive write"),
        (OUTCOME, "## Step 3: Archive the Application Materials",
         "if it already exists, leave it",
         "/outcome would overwrite /apply's archived posting with a re-fetch, "
         "the dead-URL branch the /apply write exists to avoid"),
    ]

    def test_posting_is_archived_where_every_reader_looks(self):
        for path, heading, needle, why in self.CASES:
            with self.subTest(file=path.name, rule=needle):
                self.assertIn(needle, section(path, heading), why)


class DeadlineTravelsWithTheApplication(unittest.TestCase):
    """The deadline is extracted, ranked on, and now recorded, or it dies with
    the run that fetched it.

    One case per hop. Step 0 is the only moment `/apply` provably holds the
    posting, the same argument that put the posting archive there in #307, and
    the value table is what stops the new column being written empty forever.
    """

    CASES = [
        (APPLY, "## Step 0: Parse Input", "**application deadline**",
         "extracted later, the value is a guess or a re-fetch of a URL the spec "
         "itself expects to be dead - and a pasted posting has no URL at all"),
        (APPLY, "### Step 6b: Record the Application", "| `deadline` |",
         "the column would exist in the header with no rule saying what goes in "
         "it, so every row /apply writes leaves it empty"),
        (APPLY, "### Step 6b: Record the Application", "leave an existing deadline alone",
         "a re-draft from a posting that no longer states a deadline would erase "
         "the date the first run captured"),
        (OUTCOME, "## Step 1: Load State and Identify the Application", "deadline, days quiet",
         "the open-pipeline table is the one view of every unresolved row, and it "
         "is where a drafted row's only clock becomes visible at all"),
        (OUTCOME, "## Step 1: Load State and Identify the Application",
         "one clock that does apply to a drafted row",
         "without the rule the markers are unspecified and /outcome silently "
         "disagrees with /rank's 7-day threshold"),
        (OUTCOME, "## Step 1: Load State and Identify the Application", "still never chased",
         "surfacing the deadline must not drag drafted rows into the follow-up "
         "offer - all three existing exclusions are correct and stay"),
        (HTML_REPORT, "## Step 1: Collect Data", "`deadline`",
         "the parser's field list is the column's only reader-side contract"),
        (HTML_REPORT, "## Step 1: Collect Data", "thirteen fields",
         "a row written before the column existed must read as empty, never be "
         "dropped and never have a deadline inferred from its date"),
    ]

    def test_deadline_is_recorded_and_read_everywhere(self):
        for path, heading, needle, why in self.CASES:
            with self.subTest(file=path.name, rule=needle):
                self.assertIn(needle, section(path, heading), why)


if __name__ == "__main__":
    unittest.main()
