"""Guards for /apply's source host verification rule in Step 1 (#431).

Pins the invariants from the maintainer design in issue #431:
- URLs must be verified before drafting against installed portal boards or known ATS apexes.
- The 6 standard ATS apex domains must be checked: greenhouse.io, lever.co,
  myworkdayjobs.com (or workday.com), ashbyhq.com, smartrecruiters.com, workable.com.
- Look-alike attacks (prefixes, suffixes, userinfo tricks) must fail closed.
- Any other host must be named plainly in the output as unverified.
"""

import re
import unittest
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent.parent
APPLY_COMMAND_FILE = REPO / ".claude" / "commands" / "apply.md"

KNOWN_ATS_APEXES = {
    "greenhouse.io",
    "lever.co",
    "myworkdayjobs.com",
    "workday.com",
    "ashbyhq.com",
    "smartrecruiters.com",
    "workable.com",
}

SHIPPED_PORTAL_HOSTS = {
    "jobindex.dk",
    "linkedin.com",
    "jobnet.dk",
    "jobbank.dk",
    "jobdanmark.dk",
    "freehire.me",
}


def classify_posting_host(url_str: str, installed_portals: set[str] = SHIPPED_PORTAL_HOSTS) -> tuple[str, str]:
    """Reference implementation of the host provenance rule in /apply Step 1.

    Returns (tier, host), where tier is one of:
      - 'installed_portal'
      - 'official_ats'
      - 'unverified'
    """
    try:
        parsed = urlparse(url_str)
        host = (parsed.hostname or "").lower().strip()
    except Exception:
        return "unverified", ""

    if not host:
        return "unverified", ""

    # Check installed portal boards (exact match or subdomain match)
    for portal in installed_portals:
        if host == portal or host.endswith(f".{portal}"):
            return "installed_portal", host

    # Check known official ATS apexes (exact match or subdomain match)
    for apex in KNOWN_ATS_APEXES:
        if host == apex or host.endswith(f".{apex}"):
            return "official_ats", host

    return "unverified", host


class ApplyHostVerificationSpecTests(unittest.TestCase):
    def setUp(self):
        self.text = APPLY_COMMAND_FILE.read_text(encoding="utf-8")
        step1_match = re.search(r"## Step 1: DRAFTER - Evaluate Fit(.*?)(?=## Step 2:)", self.text, re.DOTALL)
        self.assertTrue(step1_match, "Step 1 must exist in apply.md")
        self.step1_text = step1_match.group(1)

    def test_step1_contains_source_host_verification_heading(self):
        self.assertIn("Source Host Verification", self.step1_text)

    def test_step1_documents_all_six_ats_apexes(self):
        for apex in ["greenhouse.io", "lever.co", "myworkdayjobs.com", "ashbyhq.com", "smartrecruiters.com", "workable.com"]:
            self.assertIn(apex, self.step1_text, f"Step 1 must specify ATS apex: {apex}")

    def test_step1_documents_look_alike_fail_closed_rules(self):
        self.assertIn("evil-greenhouse.io", self.step1_text)
        self.assertIn("fail closed", self.step1_text)

    def test_step1_requires_unverified_hosts_to_be_named_plainly(self):
        self.assertIn("Unverified source host", self.step1_text)

    def test_classifier_identifies_official_ats_subdomains(self):
        urls = [
            "https://boards.greenhouse.io/acme/jobs/12345",
            "https://job-boards.greenhouse.io/acme/jobs/12345",
            "https://jobs.lever.co/corp/67890",
            "https://acme.myworkdayjobs.com/en-US/Careers/job/1",
            "https://jobs.ashbyhq.com/startup/abc-123",
            "https://jobs.smartrecruiters.com/Enterprise/456",
            "https://apply.workable.com/tech-corp/j/789/",
        ]
        for url in urls:
            tier, host = classify_posting_host(url)
            self.assertEqual(tier, "official_ats", f"{url} should classify as official_ats, got {tier}")

    def test_classifier_identifies_installed_portal_hosts(self):
        urls = [
            "https://www.jobindex.dk/jobannonce/12345",
            "https://www.linkedin.com/jobs/view/999999",
            "https://jobnet.dk/find-job/8888",
            "https://jobbank.dk/job/7777",
            "https://freehire.me/job/6666",
        ]
        for url in urls:
            tier, host = classify_posting_host(url)
            self.assertEqual(tier, "installed_portal", f"{url} should classify as installed_portal, got {tier}")

    def test_classifier_fails_closed_on_look_alikes_and_unverified_hosts(self):
        suspicious = [
            "https://evil-greenhouse.io/job/1",
            "https://boards.greenhouse.io.evil.com/job/1",
            "https://boards.greenhouse.io@evil-domain.com/job/1",
            "https://myworkdayjobs.com.phishing.net/login",
            "https://lever.co.attacker.org/apply",
            "https://unknown-board.example.com/posting/123",
        ]
        for url in suspicious:
            tier, host = classify_posting_host(url)
            self.assertEqual(tier, "unverified", f"{url} must fail closed as unverified, got {tier}")


if __name__ == "__main__":
    unittest.main()
