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

    def test_job_scraper_schema_carries_deadline(self):
        """Pins the base field in the seen_jobs.json structure block and the
        never-infer note. Step 2's detail fetch already extracts the deadline, so
        /scrape writes it at first sight instead of leaving it to /rank (#319).
        """
        text = SCRAPER_SKILL.read_text(encoding="utf-8")
        self.assertIn(
            '"deadline": "YYYY-MM-DD" | null',
            text,
            "the seen_jobs.json structure block must carry the deadline field, "
            "or every later run has no stored value to re-derive urgency from",
        )
        self.assertIn(
            "never infer a deadline",
            text,
            "the schema note must forbid guessing a deadline from null or from a missing key",
        )
        self.assertIn(
            "base field rather than a `/rank` extension",
            text,
            "the note must say the deadline is written when the job is first seen, "
            "not only when /rank re-scores it",
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

    def test_step4_persists_deadline(self):
        """Sibling of test_step4_persists_language_gate_and_language_note: the deadline was
        computed in Step 2 and acted on in Step 3, but never written to seen_jobs.json, so
        the urgency marker fired exactly once and a later run had to re-fetch the posting to
        recover the date (#319). Pins the persistence in the Step 4 field list.
        """
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step4 = sections.get("Step 4: Update State", "")
        self.assertIn('"deadline"', step4, "Step 4 must persist the deadline into seen_jobs.json")
        self.assertIn(
            "from the same Step 2 JSON",
            step4,
            "Step 4 must source the persisted deadline from the scoring agent's JSON, not from a guess",
        )
        self.assertIn(
            "absence is not a correction",
            step4,
            "Step 4 must keep an existing stored deadline when the agent returned null, "
            "so a fresh run never blanks a date the scraper already recorded",
        )

    def test_step3_reads_stored_deadline_without_fetch(self):
        """Persisting alone does not re-fire the marker: Step 3 must read the stored
        deadline back so urgency is re-derived on every run without re-reading the
        posting (which is the dead-URL source the field exists to replace).
        """
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step3 = sections.get("Step 3: Aggregate and Rank", "")
        self.assertIn(
            "stored `deadline`",
            step3,
            "Step 3 must take the deadline from seen_jobs.json for a job that already carries one",
        )
        self.assertIn(
            "costs no fetch",
            step3,
            "Step 3 must state that the stored value costs no fetch - that is the entire point of persisting it",
        )

    def test_step3_documents_expiry_sweep_over_ranked_entries(self):
        """Rule 6: entries this run did not re-score still get their stored deadline checked,
        enforcing the only-open-positions rule beyond the moment of fetching.
        """
        sections = _sections(COMMAND.read_text(encoding="utf-8"))
        step3 = sections.get("Step 3: Aggregate and Rank", "")
        self.assertIn(
            "Expiry sweep",
            step3,
            "Step 3 must document a sweep over already-ranked entries this run did not re-score",
        )
        self.assertIn(
            "date comparison against values already on disk",
            step3,
            "the sweep must be a pure on-disk comparison - no fetch, no agent",
        )
        step5 = sections.get("Job Ranking - YYYY-MM-DD", "")
        self.assertIn(
            "Closing soon",
            step5,
            "Step 5's template must name the Closing soon heading rule 6 lists under",
        )

    def test_step3_sweep_states_its_two_boundary_rules(self):
        """The sweep's behaviour on the majority case, and its reversibility.

        Most `seen_jobs.json` entries predate the deadline column and carry no
        `deadline` at all, so "left alone" versus "inferred from first_seen" is
        the difference between a no-op and retiring jobs on a date nobody set.
        And a status change made without a fetch needs a stated way back, or
        `expired` reads as terminal and a wrongly swept job looks unrecoverable.
        """
        step3 = _sections(COMMAND.read_text(encoding="utf-8")).get("Step 3: Aggregate and Rank", "")
        self.assertIn(
            "never guessed at",
            step3,
            "rule 6 must say an entry with no stored deadline is left alone - it is the "
            "majority case, and inferring one would retire jobs on a date nobody set",
        )
        self.assertIn(
            "revived by a later `--all`",
            step3,
            "rule 6 must state that --all re-scores expired entries, or the sweep is an "
            "irreversible automated status change",
        )

    def test_step4_sweep_is_named_as_the_exception_to_idempotency(self):
        """Rule 6 mutates exactly the entries Step 4 says are skipped.

        Step 4's closing line predates the sweep and says already-`ranked` jobs
        are skipped unless `--all` re-scores them. Rule 6 rewrites some of those
        same entries to `expired` with no `--all` and no re-score, so the two
        sections contradict each other unless the exception is named. An
        implementer following Step 4 literally skips the sweep, which is the
        whole feature.
        """
        step4 = _sections(COMMAND.read_text(encoding="utf-8")).get("Step 4: Update State", "")
        self.assertIn(
            "deliberate exception",
            step4,
            "Step 4's idempotency line must name rule 6's sweep as its exception, or the "
            "spec tells the reader both that already-ranked entries are skipped and that "
            "they are swept",
        )

    def test_step4_null_deadline_rule_states_its_interlock_with_the_sweep(self):
        """Absence-is-not-a-correction is load-bearing, not politeness.

        A `null` from a fetch that degraded to a listing page would erase a real
        stored date; because rule 6 leaves an entry with no stored deadline
        alone, that erasure also makes the entry permanently unsweepable. The
        two rules interlock, and an unexplained constraint is the kind that gets
        simplified away later.
        """
        step4 = _sections(COMMAND.read_text(encoding="utf-8")).get("Step 4: Update State", "")
        self.assertIn(
            "immortal to the sweep",
            step4,
            "the null-overwrite rule must state why it matters here: erasing a stored "
            "deadline also removes the entry from rule 6's reach forever",
        )

    def test_step5_reports_the_sweep_counts(self):
        """A background status mutation with no reported count is the failure mode
        this whole change set exists to object to."""
        step5 = _sections(COMMAND.read_text(encoding="utf-8")).get("Job Ranking - YYYY-MM-DD", "")
        self.assertIn(
            "Swept",
            step5,
            "Step 5's template must report how many already-ranked entries the sweep "
            "checked and how many it retired - it rewrites seen_jobs.json silently otherwise",
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
            "retired by Step 3's rule 6 sweep",
            step4,
            "Step 4 must persist the Step 3 rule 6 sweep's expiries, not just the ones "
            "the scoring agents reported",
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
