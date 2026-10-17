"""Regression test for /scrape Step 1 query translation (#536).

The scraper spec (SKILL.md + search-queries.md) is the implementation, so
these tests pin the invariant that broke silently: search-queries.md templates
were written in Google syntax (`site:`, `OR`, quoted phrases) and sent to
portal CLIs, which don't support `OR` or Google-style quoting. The failure was
silent — the search returned hits, just the wrong ones. The fix separates
Portal CLI search terms (plain, one per call) from WebSearch `site:` fallback
queries (labeled as Step 1c only), and SKILL.md Step 1b documents the
per-portal quoting rule.
"""
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUERIES = REPO / ".claude" / "skills" / "job-scraper" / "search-queries.md"
SKILL = REPO / ".claude" / "skills" / "job-scraper" / "SKILL.md"


def _code_blocks(text: str) -> list[str]:
    """Extract contents of all fenced code blocks from markdown."""
    return re.findall(r"```(?:markdown)?\n(.*?)```", text, re.DOTALL)


def _steps(text: str) -> dict[str, str]:
    """Split the skill spec into {heading: body} by '###' step headers."""
    result = {}
    for part in text.split("\n### ")[1:]:
        heading, _, body = part.partition("\n")
        result[heading.strip()] = body
    return result


class TestNoGoogleOperatorsInTemplates(unittest.TestCase):
    """No portal CLI supports OR; templates must not send it to a CLI (#536)."""

    def test_no_OR_in_query_template_code_blocks(self):
        """Every code-block line in search-queries.md must avoid ` OR `."""
        text = QUERIES.read_text(encoding="utf-8")
        blocks = _code_blocks(text)
        self.assertGreaterEqual(len(blocks), 1, "no code blocks found in search-queries.md")
        for block in blocks:
            for line in block.strip().splitlines():
                # `OR` as a standalone word between terms is the bug from #536.
                # Query templates are the only content in these code blocks, so
                # any OR is a portal-incompatible operator.
                self.assertNotRegex(
                    line, r"\bOR\b",
                    f"search-queries.md must not send OR to portal CLIs: {line!r}",
                )


class TestSearchQueriesSeparateCliAndWebSearch(unittest.TestCase):
    """site: queries must be WebSearch fallback only; CLI terms must be plain."""

    def test_has_portal_cli_search_terms_sections(self):
        """Each priority section must list plain CLI search terms per call."""
        text = QUERIES.read_text(encoding="utf-8")
        self.assertIn(
            "Portal CLI search terms", text,
            "search-queries.md must list Portal CLI search terms separately "
            "from site: WebSearch fallback queries",
        )

    def test_site_queries_are_labeled_step1c_only(self):
        """site: query blocks must be introduced as WebSearch fallback only."""
        text = QUERIES.read_text(encoding="utf-8")
        self.assertIn(
            "WebSearch fallback queries", text,
            "search-queries.md must label site: query blocks as WebSearch fallback",
        )
        self.assertIn(
            "Step 1c only", text,
            "search-queries.md must label site: queries as Step 1c only, not CLI input",
        )

    def test_cli_search_term_blocks_have_no_site_prefix(self):
        """Portal CLI search term blocks must not contain site: prefixes."""
        text = QUERIES.read_text(encoding="utf-8")
        blocks = _code_blocks(text)
        cli_blocks = [b for b in blocks if "site:" not in b]
        self.assertGreaterEqual(
            len(cli_blocks), 4,
            "search-queries.md must have at least 4 Portal CLI search term blocks "
            "(one per priority category) without site: prefixes",
        )


class TestSkill1bDocumentsQuotingRules(unittest.TestCase):
    """SKILL.md Step 1b must document per-portal quoting and one-term-per-call."""

    @classmethod
    def setUpClass(cls):
        text = SKILL.read_text(encoding="utf-8")
        steps = _steps(text)
        cls.step1 = steps.get("Step 1: Search", "")
        cls.step1b = cls.step1.partition("#### 1b.")[2]

    def test_step1b_instructs_one_term_per_call(self):
        """Step 1b must say one plain term per CLI call, no OR, no combined strings."""
        lower = self.step1b.lower()
        self.assertTrue(
            "one plain term" in lower or "one term per call" in lower,
            "Step 1b must instruct one plain term per CLI call (no OR, no combined strings)",
        )

    def test_step1b_names_portals_that_support_phrase_quoting(self):
        """Step 1b must name jobindex, jobbank, freehire as phrase-quote portals."""
        lower = self.step1b.lower()
        self.assertIn("quot", lower,
            "Step 1b must mention quoting to document the per-portal rule")
        for portal in ("jobindex", "jobbank", "freehire"):
            self.assertIn(
                portal, self.step1b,
                f"Step 1b must name {portal} as a portal that supports phrase quoting",
            )

    def test_step1b_names_portals_that_dont_support_phrase_quoting(self):
        """Step 1b must instruct omitting quotes on jobnet and LinkedIn."""
        lower = self.step1b.lower()
        self.assertIn("omit quotes", lower,
            "Step 1b must say to omit quotes on portals that don't support phrase matching")
        self.assertIn("linkedin", lower,
            "Step 1b must name LinkedIn as a portal that does not support phrase quoting")


class TestSkill1cLabelsSiteQueriesAsFallbackOnly(unittest.TestCase):
    """Step 1c must use the labeled WebSearch site: blocks, not raw template lines."""

    @classmethod
    def setUpClass(cls):
        text = SKILL.read_text(encoding="utf-8")
        steps = _steps(text)
        cls.step1 = steps.get("Step 1: Search", "")
        cls.step1c = cls.step1.partition("#### 1c.")[2]

    def test_step1c_references_labeled_fallback_blocks(self):
        """Step 1c must point at the 'WebSearch fallback query' blocks, not generic strings."""
        self.assertIn(
            "WebSearch fallback query", self.step1c,
            "Step 1c must reference the labeled WebSearch fallback query blocks from search-queries.md",
        )
        self.assertIn(
            "Step 1c only", self.step1c,
            "Step 1c must reference the Step 1c-only-labeled site: queries",
        )


if __name__ == "__main__":
    unittest.main()