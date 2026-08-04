"""Offline tests for tools/robots_check.py.

No network: every case exercises the parser against literal robots.txt bodies,
matching the repo's CI policy of making no live portal requests.

The cases marked FAIL-OPEN REGRESSION are the ones Python's own
urllib.robotparser gets wrong. They are pinned here because getting them wrong
means the browser-header retry runs against a site that said no, which is the
exact boundary this tool exists to hold.
"""

import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

from robots_check import allowed  # noqa: E402


# Real body served by privatebank.barclays.com: blank lines sit between the
# User-agent line and its rules. Python's robotparser treats those as record
# separators and drops every rule, so /cs/ reads as allowed.
BARCLAYS = "User-agent: *\n\n\nAllow: /\n\nDisallow: /cs/\n\nSitemap: https://x/sitemap.xml\n"

# jobup.ch: the case a community fork was asked to ship opt-in.
JOBUP = "User-agent: *\nDisallow: /api/\n"


class TestPathRules(unittest.TestCase):
    def test_blank_lines_inside_record_do_not_end_it(self):
        """FAIL-OPEN REGRESSION: /cs/ is disallowed despite the blank lines."""
        self.assertFalse(allowed(BARCLAYS, "*", "/cs/"))

    def test_allowed_path_on_same_site_still_allowed(self):
        self.assertTrue(allowed(BARCLAYS, "*", "/careers/"))

    def test_longest_match_wins_over_rule_order(self):
        """FAIL-OPEN REGRESSION: 'Allow: /' precedes 'Disallow: /cs/' in the
        file; specificity must win, not position."""
        body = "User-agent: *\nAllow: /\nDisallow: /cs/\n"
        self.assertFalse(allowed(body, "*", "/cs/deep/page"))

    def test_longest_match_can_unblock(self):
        body = "User-agent: *\nDisallow: /\nAllow: /jobs/\n"
        self.assertTrue(allowed(body, "*", "/jobs/x"))
        self.assertFalse(allowed(body, "*", "/other"))

    def test_equal_specificity_tie_goes_to_disallow(self):
        """Cautious tie-break: Google resolves ties to Allow, we do not."""
        self.assertFalse(allowed("User-agent: *\nDisallow: /a\nAllow: /a\n", "*", "/a"))

    def test_api_block_and_sibling_path(self):
        self.assertFalse(allowed(JOBUP, "*", "/api/v1/public/search"))
        self.assertTrue(allowed(JOBUP, "*", "/en/jobs/"))

    def test_wildcard_and_end_anchor(self):
        body = "User-agent: *\nDisallow: /*.pdf$\n"
        self.assertFalse(allowed(body, "*", "/files/cv.pdf"))
        self.assertTrue(allowed(body, "*", "/files/cv.pdf.html"))

    def test_empty_disallow_means_allow_everything(self):
        self.assertTrue(allowed("User-agent: *\nDisallow:\n", "*", "/anything"))

    def test_empty_or_ruleless_robots_allows(self):
        self.assertTrue(allowed("", "*", "/x"))
        self.assertTrue(allowed("# just a comment\n", "*", "/x"))

    def test_comments_are_stripped(self):
        self.assertFalse(allowed("User-agent: *\nDisallow: /x  # nope\n", "*", "/x"))


class TestAgentSelection(unittest.TestCase):
    def test_named_claude_user_opt_out_is_honored(self):
        body = "User-agent: Claude-User\nDisallow: /\n\nUser-agent: *\nAllow: /\n"
        self.assertFalse(allowed(body, "Claude-User", "/a"))
        self.assertTrue(allowed(body, "*", "/a"))

    def test_agent_match_is_case_insensitive(self):
        body = "User-agent: CLAUDE-USER\nDisallow: /x\n"
        self.assertFalse(allowed(body, "claude-user", "/x"))

    def test_falls_back_to_star_when_agent_absent(self):
        self.assertFalse(allowed(JOBUP, "Claude-User", "/api/v1"))

    def test_multiple_agents_share_one_ruleset(self):
        body = "User-agent: A\nUser-agent: Claude-User\nDisallow: /z\n"
        self.assertFalse(allowed(body, "Claude-User", "/z"))
        self.assertFalse(allowed(body, "A", "/z"))


class TestCli(unittest.TestCase):
    def test_module_is_importable_and_cli_exists(self):
        """The doc calls this by path; make sure that entry point stays valid."""
        script = REPO_ROOT / "tools" / "robots_check.py"
        self.assertTrue(script.is_file())
        out = subprocess.run(
            [sys.executable, str(script)], capture_output=True, text=True, timeout=30
        )
        # No URL argument: must fail loudly rather than defaulting to "allowed".
        self.assertNotEqual(out.returncode, 0)


if __name__ == "__main__":
    unittest.main()
