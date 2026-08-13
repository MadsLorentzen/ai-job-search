"""Guards for the /rank command spec.

The command is a markdown spec (the spec IS the implementation), so these
tests pin the invariants that would break silently: the header format that
lint_skills.py enforces, and the persistence of scoring-agent gaps/strengths
into seen_jobs.json (previously computed in Step 2 and thrown away after
Step 5's terminal output).
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
COMMAND = REPO / ".claude" / "commands" / "rank.md"
SCRAPER_SKILL = REPO / ".claude" / "skills" / "job-scraper" / "SKILL.md"


def _sections(text: str) -> dict[str, str]:
    """Split a command spec into {heading: body} by '##' headers.

    Splitting this way lets a fork's extra sections (e.g. this fork's
    '## Blocker logging') sit between the ones under test without shifting
    which text a given assertion sees.
    """
    parts = text.split("\n## ")
    result = {}
    for part in parts[1:]:
        heading, _, body = part.partition("\n")
        result[heading.strip()] = body
    return result


class RankCommandSpec(unittest.TestCase):
    def test_command_file_exists_with_lint_compliant_header(self):
        self.assertTrue(COMMAND.is_file(), "command spec missing")
        first_line = COMMAND.read_text(encoding="utf-8").splitlines()[0]
        self.assertTrue(
            first_line.startswith("# /rank"),
            f"header must start with '# /rank' (lint_skills.py enforces it), got: {first_line!r}",
        )

    def test_step4_persists_gaps_and_strengths(self):
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step4 = sections.get("Step 4: Update State", "")
        self.assertIn('"gaps"', step4, "Step 4 must persist the gaps array into seen_jobs.json")
        self.assertIn('"strengths"', step4, "Step 4 must persist the strengths array into seen_jobs.json")

    def test_step4_documents_verbatim_no_accumulate_and_untrusted_data_rules(self):
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step4 = sections.get("Step 4: Update State", "")
        self.assertIn("verbatim", step4, "Step 4 must require storing gaps/strengths verbatim, never reformatted")
        self.assertIn("replaces", step4, "Step 4 must state that --all re-scoring replaces, not accumulates, the arrays")
        self.assertIn("untrusted data", step4, "Step 4 must restate that stored gaps/strengths are untrusted data")

    def test_important_rules_link_honest_scoring_to_persistence(self):
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        rules = sections.get("Important Rules", "")
        self.assertIn(
            "persisted with it",
            rules,
            "Rule 5 must note that gaps are persisted (Step 4), not just printed (Step 5)",
        )

    def test_job_scraper_schema_note_mentions_strengths_and_gaps(self):
        text = SCRAPER_SKILL.read_text(encoding="utf-8")
        self.assertIn("strengths", text)
        self.assertIn("gaps", text)
        self.assertIn(
            "readers tolerate their absence",
            text,
            "schema note must say old entries lacking strengths/gaps are tolerated, never backfilled",
        )

    def test_step2_schema_includes_language_gate_fields(self):
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step2 = sections.get("Step 2: Batch-Fetch and Score", "")
        self.assertIn('"language_gate"', step2, "Step 2's scoring-agent JSON must include language_gate")
        self.assertIn('"language_note"', step2, "Step 2's scoring-agent JSON must include language_note")
        self.assertIn(
            '"PASS" | "FAIL" | "FLAG"',
            step2,
            "language_gate must use the same PASS/FAIL/FLAG verdict set as the location veto",
        )
        self.assertIn(
            "distinct from",
            step2,
            "spec must distinguish language_gate/language_note from the pre-existing 'language' field "
            "(which records the posting's own language, not a veto verdict) - the two are easy to conflate",
        )

    def test_step3_documents_language_veto(self):
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step3 = sections.get("Step 3: Aggregate and Rank", "")
        self.assertIn(
            "Language veto",
            step3,
            "Step 3 must document a Language veto rule, mirroring the existing Location veto",
        )
        self.assertIn(
            "excludes the job from the shortlist",
            step3,
            "a language_gate FAIL must be documented as excluding the job, same as a location FAIL",
        )

    def test_step4_persists_language_gate_and_language_note(self):
        """Regression guard: language_gate/language_note were computed in Step 2 and used
        to decide Step 3's veto, but never written to seen_jobs.json - live-debugged and
        fixed once already (a real /rank run showed language_gate: null on every entry
        despite the run reporting real vetoes). This pins the fix in the spec text the
        same way test_step4_persists_gaps_and_strengths pins the sibling strengths/gaps
        persistence bug, so a future edit can't silently reintroduce either loss.
        """
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step4 = sections.get("Step 4: Update State", "")
        self.assertIn('"language_gate"', step4, "Step 4 must persist language_gate into seen_jobs.json")
        self.assertIn('"language_note"', step4, "Step 4 must persist language_note into seen_jobs.json")
        self.assertIn(
            "as important to persist as the score itself",
            step4,
            "Step 4 must call out that the veto fields (location/language_gate/language_note) are not optional extras",
        )

    def test_step4_persists_the_deadline(self):
        """Third instance of the bug class the two tests above pin.

        Step 2's scoring agent returns a deadline, Step 3 rule 5 turns it into the
        urgency marker and the expiry check, and Step 4 wrote eight fields and not
        that one. Because a later run skips already-`ranked` jobs, the marker could
        only ever fire in the run that fetched the posting.
        """
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step4 = sections.get("Step 4: Update State", "")
        self.assertIn('"deadline"', step4, "Step 4 must persist deadline into seen_jobs.json")

    def test_step3_reuses_the_stored_deadline_and_sweeps_unscored_entries(self):
        """Persisting alone changes nothing observable.

        Step 4 skips already-`ranked` jobs and `--all` re-fetches, so unless Step 3
        reads the stored value back the field is write-only and the marker still
        fires exactly once.
        """
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step3 = sections.get("Step 3: Aggregate and Rank", "")
        self.assertIn(
            "stored `deadline`",
            step3,
            "Step 3 must take the deadline from seen_jobs.json for an entry that already "
            "carries one - without a fetch, or nothing is gained by storing it",
        )
        self.assertIn(
            "did not re-score",
            step3,
            "without a sweep over already-ranked entries, a job that closed since it was "
            "ranked stays live until someone happens to run --all",
        )
        self.assertIn(
            "Closing soon",
            step3,
            "the sweep must surface near deadlines, not only expire the passed ones",
        )

    def test_step4_persists_the_sweeps_expiry(self):
        """The sweep must write its result, or it reproduces the very bug it fixes.

        Step 4's expiry line is scoped to what the Step 2 agents returned. The sweep
        runs over entries this run did not re-score, so without its own persistence
        line the transition happens in reasoning only and disk never changes.
        """
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step4 = sections.get("Step 4: Update State", "")
        self.assertIn(
            "sweep",
            step4,
            "Step 4 must persist the Step 3 rule 6 sweep's expiries, not just the ones "
            "the scoring agents reported",
        )

    def test_step5_template_carries_the_closing_soon_heading(self):
        """Step 3 rule 6 names the heading; the template is the only place that says
        what it looks like, so the two drift the moment one moves.

        Same `_sections()` quirk documented in test_step5_documents_language_flag_marker:
        the fenced example template lives under its own "Job Ranking" key.
        """
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        template = sections.get("Job Ranking - YYYY-MM-DD", "")
        self.assertIn(
            "### Closing soon",
            template,
            "the output template lost the Closing soon heading that Step 3 rule 6 promises",
        )

    def test_job_scraper_schema_documents_deadline_as_a_base_field(self):
        text = SCRAPER_SKILL.read_text(encoding="utf-8")
        self.assertIn(
            '"deadline"',
            text,
            "the seen_jobs.json structure block must carry the deadline key - /scrape "
            "extracts it in Step 2 and is its first writer",
        )
        self.assertIn(
            "base field",
            text,
            "the schema note must say deadline is a base field rather than a /rank "
            "extension: a job carries a deadline long before anything ranks it",
        )
        self.assertIn(
            "Never infer a deadline",
            text,
            "a missing key (entry predates the field) and null (posting states none) are "
            "different facts, and neither is ever guessed at",
        )

    def test_step5_documents_language_flag_marker(self):
        # Note: _sections() splits on every "\n## " line, including the "## Job
        # Ranking - YYYY-MM-DD" line inside Step 5's own fenced example template -
        # so the presentation rules that follow that example live under that key,
        # not "Step 5: Present the Shortlist" itself. Matches how the existing
        # gaps/strengths tests above only probe Step 4, never Step 5, for the same
        # reason - documented here since it's easy to trip over when adding a new
        # Step-5-content test.
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step5_rules = sections.get("Job Ranking - YYYY-MM-DD", "")
        self.assertIn(
            "language_gate: FLAG",
            step5_rules,
            "Step 5's presentation rules must document the ⚠ marker + language_note callout "
            "for a shortlisted FLAG job, mirroring the existing location FLAG treatment",
        )

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
