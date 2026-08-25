"""Guards for the company-research cache spec.

/apply Step 3's reviewer agent and /interview Step 2 each independently execute
the Company Research Checklist (04-job-evaluation.md) for the same company when
both commands run against the same application - confirmed by reading both
files, not assumed. The cache lets either consumer reuse a recent result
instead of repeating the search/fetch work. These are markdown specs (the spec
IS the implementation), so these tests pin the invariants that would break
silently: that the cache is actually read before researching, and - the part
most likely to be dropped in a future edit, since it is easy to add the read
half and forget the write half - that fresh research gets written back for
the next consumer to find.
"""
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EVALUATION = REPO / ".claude" / "skills" / "job-application-assistant" / "04-job-evaluation.md"
APPLY = REPO / ".claude" / "commands" / "apply.md"
INTERVIEW = REPO / ".claude" / "commands" / "interview.md"


def _sections(text: str, marker: str) -> dict[str, str]:
    """Split a markdown spec into {heading: body} on a given '\\n<marker> ' prefix."""
    parts = text.split(f"\n{marker} ")
    result = {}
    for part in parts[1:]:
        heading, _, body = part.partition("\n")
        result[heading.strip()] = body
    return result


def _apply_research_step() -> str:
    """apply.md's '### 1. Research the Company' subsection, isolated from the
    other numbered subsections under Step 3."""
    text = APPLY.read_text(encoding="utf-8")
    sections = _sections(text, "###")
    for heading, body in sections.items():
        if heading.startswith("1. Research the Company"):
            return body
    return ""


def _interview_research_step() -> str:
    text = INTERVIEW.read_text(encoding="utf-8")
    sections = _sections(text, "##")
    for heading, body in sections.items():
        if heading.startswith("Step 2: Research the Company"):
            return body
    return ""


class TestCacheDefinition(unittest.TestCase):
    def setUp(self):
        self.text = EVALUATION.read_text(encoding="utf-8")
        self.sections = _sections(self.text, "##")

    def test_evaluation_file_defines_the_cache_section(self):
        self.assertIn(
            "Company Research Cache",
            self.sections,
            "04-job-evaluation.md must define a 'Company Research Cache' section",
        )

    def test_cache_definition_specifies_location_and_ttl(self):
        body = self.sections.get("Company Research Cache", "")
        self.assertIn("company_research/", body, "cache section must name the storage directory")
        self.assertIn("30", body, "cache section must state the TTL (30 days)")
        self.assertIn("fetched_date", body, "cache section must name the freshness field")

    def test_cache_definition_preserves_the_verification_rule(self):
        """The cache must not weaken the existing 'verify before quoting' rule -
        it should explicitly say a cache hit is a lead, not a substitute for it."""
        body = self.sections.get("Company Research Cache", "")
        self.assertIn(
            "lead",
            body,
            "cache section must say a cache hit is a lead, matching the existing "
            "reviewer-agent-research trust model, not a verified source on its own",
        )
        self.assertRegex(
            body,
            r"[Vv]erif",
            "cache section must restate that final-claim verification still applies",
        )

    def test_cache_definition_states_contents_are_data_not_instructions(self):
        """Follow-up requested on PR #349: notes fields are written from fetched web
        content the same way the job posting is, so a later session reading the cache
        must treat them as data to evaluate, never as directions to follow - the same
        trust-boundary rule apply.md Step 0 states for the posting itself."""
        body = self.sections.get("Company Research Cache", "")
        self.assertIn(
            "data, never instructions",
            body,
            "cache section must state cache contents are data, never instructions",
        )


class TestApplyWiring(unittest.TestCase):
    def test_reviewer_prompt_checks_cache_before_researching(self):
        body = _apply_research_step()
        self.assertNotEqual(body, "", "could not locate apply.md's Research the Company step")
        self.assertIn("company_research/", body, "reviewer prompt must reference the cache path")
        self.assertRegex(
            body,
            r"[Cc]heck the cache",
            "reviewer prompt must instruct checking the cache before researching",
        )

    def test_reviewer_prompt_writes_back_after_fresh_research(self):
        body = _apply_research_step()
        self.assertRegex(
            body,
            r"write.*company_research/|company_research/.*write",
            "reviewer prompt must instruct writing fresh research back to the cache "
            "- the write half is the one most likely to be dropped silently",
        )

    def test_reviewer_prompt_restates_verification_still_applies_to_a_cache_hit(self):
        """New one-line restatement inside the cache-check paragraph itself, distinct
        from the grounding-audit rule elsewhere in the prompt - Mads flagged this as
        the one part of the cache wiring with no dedicated pin (PR #349 follow-up)."""
        body = _apply_research_step()
        self.assertRegex(
            body,
            r"still applies",
            "the cache-check paragraph must restate that verification still applies "
            "to a cache hit, not just to fresh research",
        )


class TestInterviewWiring(unittest.TestCase):
    def test_step_2_checks_cache_before_researching(self):
        body = _interview_research_step()
        self.assertNotEqual(body, "", "could not locate interview.md's Step 2")
        self.assertIn("company_research/", body, "Step 2 must reference the cache path")
        self.assertRegex(
            body,
            r"[Cc]heck the cache",
            "Step 2 must instruct checking the cache before researching",
        )

    def test_step_2_writes_back_after_fresh_research(self):
        body = _interview_research_step()
        self.assertRegex(
            body,
            r"write.*cache|cache file with",
            "Step 2 must instruct writing fresh research back to the cache",
        )

    def test_step_2_still_requires_verification_before_using_a_claim(self):
        """Pre-existing rule (unrelated to this cache) that must survive: the
        cache must not be presented as a substitute for it."""
        body = _interview_research_step()
        self.assertIn(
            "Verify before using",
            body,
            "Step 2 must keep its existing verification requirement",
        )

    def test_step_2_cache_paragraph_restates_verification_still_applies(self):
        """New one-line restatement inside the cache-check paragraph itself - distinct
        from test_step_2_still_requires_verification_before_using_a_claim above, which
        pins the older, pre-existing 'Verify before using' rule further down. Mads
        flagged this new one-liner as unpinned (PR #349 follow-up)."""
        body = _interview_research_step()
        self.assertRegex(
            body,
            r"still applies",
            "the cache-check paragraph must restate that verification still applies "
            "to a cache hit, not just to fresh research",
        )


if __name__ == "__main__":
    unittest.main()
