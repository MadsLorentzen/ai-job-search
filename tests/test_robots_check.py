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

from robots_check import allowed, is_robots_body  # noqa: E402


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

    def test_equal_specificity_tie_goes_to_disallow_when_allow_listed_first(self):
        """The only ordering that exercises the tie-break clause: with Allow
        first, deleting the clause makes the first rule at a given length win
        and Allow would leak through. The Disallow-first sibling above cannot
        detect that mutation (review finding F21, 2026-08-19)."""
        self.assertFalse(allowed("User-agent: *\nAllow: /a\nDisallow: /a\n", "*", "/a"))

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


class TestSoftTwoHundred(unittest.TestCase):
    """A 200 whose body is not a robots.txt used to grant permission.

    Found by adversarial review, not inspection. A misconfigured host answering
    /robots.txt with an HTML error page at status 200 parses to zero rules, and
    zero rules read as "allowed" - so the browser retry ran on permission that
    was never given. FAIL-OPEN REGRESSION.
    """

    def test_html_error_page_is_not_a_robots_file(self):
        self.assertFalse(is_robots_body("<html><body>404 Not Found</body></html>"))

    def test_json_error_body_is_not_a_robots_file(self):
        self.assertFalse(is_robots_body('{"error":"not found"}'))

    def test_soft_200_is_unconfirmed_not_allowed(self):
        import robots_check

        original = robots_check._fetch
        robots_check._fetch = lambda url, ua: ("<html>404</html>", 200)
        try:
            rc, msg = robots_check.gate("https://x.example/jobs")
        finally:
            robots_check._fetch = original
        self.assertEqual(rc, 1)
        self.assertIn("not a robots.txt", msg)

    def test_gate_reads_policy_as_browser_when_honest_request_is_refused(self):
        """09-web-research.md's Barclays-class recovery: the policy file itself
        returns 403 to Claude-User and 200 to a browser, and the checker must
        then read it as a browser and obey it strictly. This is gate()'s UA
        fallback loop, previously untested despite the doc's coverage claim
        (review finding F30, 2026-08-19)."""
        import robots_check

        original = robots_check._fetch

        def waf(url, ua):
            if ua == robots_check.BROWSER:
                return ("User-agent: *\nAllow: /\n", 200)
            return ("<html>403 Forbidden</html>", 403)

        robots_check._fetch = waf
        try:
            rc, msg = robots_check.gate("https://waf.example/jobs")
        finally:
            robots_check._fetch = original
        self.assertEqual(rc, 0)
        self.assertIn("ALLOWED", msg)

    def test_gate_obeys_a_browser_fetched_policy_strictly(self):
        """The fallback must not fail open: a policy readable only as a browser
        still disallows what it disallows."""
        import robots_check

        original = robots_check._fetch

        def waf(url, ua):
            if ua == robots_check.BROWSER:
                return ("User-agent: *\nDisallow: /jobs\n", 200)
            return ("<html>403 Forbidden</html>", 403)

        robots_check._fetch = waf
        try:
            rc, msg = robots_check.gate("https://waf.example/jobs")
        finally:
            robots_check._fetch = original
        self.assertEqual(rc, 1)
        self.assertIn("DISALLOWED", msg)

    def test_a_genuinely_empty_robots_is_still_allow_all(self):
        """RFC 9309: an empty file permits everything. Do not over-correct."""
        self.assertTrue(is_robots_body(""))
        self.assertTrue(is_robots_body("\n\n   \n"))

    def test_a_real_policy_is_recognised(self):
        self.assertTrue(is_robots_body(BARCLAYS))
        self.assertTrue(is_robots_body(JOBUP))

    def test_sitemap_only_file_counts(self):
        self.assertTrue(is_robots_body("Sitemap: https://x.example/sitemap.xml\n"))


class TestPercentEncodedRules(unittest.TestCase):
    """Rule patterns are percent-decoded to match the decoded request path.

    FAIL-OPEN REGRESSION: without this, a site that percent-encodes its own
    Disallow patterns has them silently skipped.
    """

    def test_encoded_space_in_disallow_now_matches(self):
        self.assertFalse(allowed("User-agent: *\nDisallow: /foo%20bar\n", "*", "/foo bar"))

    def test_encoded_rule_does_not_overmatch(self):
        self.assertTrue(allowed("User-agent: *\nDisallow: /foo%20bar\n", "*", "/foobar"))

    def test_plain_rules_are_unaffected(self):
        self.assertFalse(allowed(JOBUP, "*", "/api/x"))
        self.assertTrue(allowed(JOBUP, "*", "/en/jobs/x"))



class TestArgumentHardening(unittest.TestCase):
    """A URL can never be read by curl as an option.

    gate() rebuilds the target as scheme://host/robots.txt, so the gate path was
    never exposed; this pins the "--" terminator for direct _fetch callers and
    confirms a dash-leading argument fails closed end to end.
    """

    def test_curl_argv_ends_with_a_double_dash_before_the_url(self):
        import inspect

        import robots_check

        src = inspect.getsource(robots_check._fetch)
        self.assertIn("'--', url", src)

    def test_a_dash_leading_argument_fails_closed(self):
        script = REPO_ROOT / "tools" / "robots_check.py"
        out = subprocess.run(
            [sys.executable, str(script), "--help"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(out.returncode, 1)
        self.assertNotIn("Usage: curl", out.stdout)

    def test_gate_never_passes_the_caller_url_through_to_curl(self):
        """The robots target is rebuilt from scheme+host, never the raw input."""
        import robots_check

        seen = []

        original = robots_check._fetch

        def spy(url, ua):
            seen.append(url)
            return "User-agent: *\nAllow: /\n", 200

        robots_check._fetch = spy
        try:
            robots_check.gate("https://x.example/-o/evil?q=1")
        finally:
            robots_check._fetch = original
        self.assertEqual(seen[0], "https://x.example/robots.txt")



if __name__ == "__main__":
    unittest.main()
