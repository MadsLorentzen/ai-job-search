"""Guards for /apply's source host verification rule in Step 1 (#431).

Pins the invariants from the maintainer design in issue #431:
- URLs must be verified before drafting against installed portal boards or known ATS apexes.
- The 6 standard ATS apex domains must be checked: greenhouse.io, lever.co,
  myworkdayjobs.com (or workday.com), ashbyhq.com, smartrecruiters.com, workable.com.
- Look-alike attacks (prefixes, suffixes, userinfo tricks) must fail closed.
- Any other host must be named plainly in the output as unverified.

The installed-portal half is derived, not copied (#497). Rule 1 in apply.md
defines an installed portal as "any configured job portal in `.agents/skills/`",
so the source of truth is the skills tree: the host literals in each
`*-search/cli/src/**/*.ts`. A hand-copied set in this file went stale the moment
a portal was added or dropped, and a new portal CLI fetching from a host the
copy lacked had its postings classified "unverified" with no test failing.
The ATS apex list stays the fixed set it is.
"""

import re
import unittest
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent.parent
APPLY_COMMAND_FILE = REPO / ".claude" / "commands" / "apply.md"
SKILLS_DIR = REPO / ".agents" / "skills"

# A host literal in a CLI source file. Portal CLIs build every request URL from
# a BASE_URL / SEARCH_URL constant, so this is where the board's host lives.
HOST_LITERAL = re.compile(r"https?://([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
# Hosts a source file may name that are not the portal: schema vocabularies,
# RFC example domains, loopback. Extend if a CLI ever embeds another one.
NON_PORTAL_HOSTS = {"schema.org", "www.w3.org", "example.com", "localhost"}


def installed_portal_skills() -> list[Path]:
    """Every `*-search` skill with a CLI source tree, enabled or not.

    Rule 1 says "configured job portal in `.agents/skills/`" - a portal that is
    installed but `enabled: false` for /scrape is still a legitimate board for
    a posting the user pastes into /apply, so discovery is by installation.
    """
    return sorted(
        d for d in SKILLS_DIR.glob("*-search") if (d / "cli" / "src").is_dir()
    )


def portal_enabled(skill_dir: Path) -> bool:
    """The `enabled:` frontmatter flag /scrape honours; a missing key means enabled."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return True
    match = re.search(r"^enabled:\s*(true|false)\b", skill_md.read_text(encoding="utf-8"), re.M)
    return match is None or match.group(1) == "true"


def portal_hosts(skill_dir: Path) -> set[str]:
    """The board hosts a portal CLI fetches from, as registrable names.

    A leading `www.` is dropped so the classifier's exact-or-subdomain rule
    accepts both `jobindex.dk` and `www.jobindex.dk` (the CLI builds its URLs
    with the latter; postings link to both).
    """
    hosts: set[str] = set()
    for source in (skill_dir / "cli" / "src").rglob("*.ts"):
        for host in HOST_LITERAL.findall(source.read_text(encoding="utf-8")):
            host = host.lower()
            if host in NON_PORTAL_HOSTS:
                continue
            hosts.add(host[4:] if host.startswith("www.") else host)
    return hosts


def discover_installed_portal_hosts() -> set[str]:
    return set().union(*(portal_hosts(d) for d in installed_portal_skills()))


INSTALLED_PORTAL_HOSTS = discover_installed_portal_hosts()

KNOWN_ATS_APEXES = {
    "greenhouse.io",
    "lever.co",
    "myworkdayjobs.com",
    "workday.com",
    "ashbyhq.com",
    "smartrecruiters.com",
    "workable.com",
}



def classify_posting_host(url_str: str, installed_portals: set[str] | None = None) -> tuple[str, str]:
    """Reference implementation of the host provenance rule in /apply Step 1.

    `installed_portals` defaults to the set discovered from the skills tree, so
    the classifier can never lag a portal that /add-portal installed.

    Returns (tier, host), where tier is one of:
      - 'installed_portal'
      - 'official_ats'
      - 'unverified'
    """
    if installed_portals is None:
        installed_portals = INSTALLED_PORTAL_HOSTS
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
        # A regional subdomain and the bare apex must both pass for every portal;
        # the derived set is what makes this hold for a portal added by /add-portal.
        urls = [
            "https://www.jobindex.dk/jobannonce/12345",
            "https://dk.linkedin.com/jobs/view/999999",
            "https://jobnet.dk/find-job/8888",
            "https://freehire.me/jobs/golang-zensar-2bxu6dxm",
        ]
        for url in urls:
            tier, host = classify_posting_host(url)
            self.assertEqual(tier, "installed_portal", f"{url} should classify as installed_portal, got {tier}")

    def test_classifier_default_is_the_discovered_set_not_a_copy(self):
        self.assertEqual(classify_posting_host.__defaults__, (None,))
        self.assertTrue(INSTALLED_PORTAL_HOSTS, "discovery found no portal hosts under .agents/skills/")
        # An explicit set still overrides, which is how a fork's test can probe a candidate portal.
        self.assertEqual(
            classify_posting_host("https://jobs.newboard.test/x", {"newboard.test"})[0], "installed_portal"
        )
        self.assertEqual(classify_posting_host("https://jobs.newboard.test/x")[0], "unverified")


class InstalledPortalsAreVerifiedTests(unittest.TestCase):
    """Every installed portal CLI's board host must classify as installed_portal.

    This is the assertion the hand-copied set could not make: a portal added
    by /add-portal fetches from a host the copy never heard of, and its
    postings reached /apply flagged "unverified" while the suite stayed green.
    """

    def test_every_installed_portal_has_a_discoverable_host(self):
        skills = installed_portal_skills()
        self.assertTrue(skills, "no *-search skill with a cli/src tree under .agents/skills/")
        for skill in skills:
            with self.subTest(portal=skill.name):
                self.assertTrue(
                    portal_hosts(skill),
                    f"{skill.name}/cli/src has no host literal - the classifier cannot verify its postings",
                )

    def test_every_installed_portals_host_classifies_as_installed_portal(self):
        for skill in installed_portal_skills():
            for host in sorted(portal_hosts(skill)):
                for url in (f"https://{host}/job/1", f"https://www.{host}/job/1", f"https://sub.{host}/job/1"):
                    with self.subTest(portal=skill.name, url=url, enabled=portal_enabled(skill)):
                        tier, _ = classify_posting_host(url)
                        self.assertEqual(tier, "installed_portal", f"{url} classified as {tier}")

    def test_portal_hosts_are_registrable_names_without_www(self):
        for skill in installed_portal_skills():
            for host in portal_hosts(skill):
                with self.subTest(portal=skill.name, host=host):
                    self.assertFalse(host.startswith("www."), host)
                    self.assertRegex(host, r"^[a-z0-9.-]+\.[a-z]{2,}$")

    def test_enabled_flag_reads_like_scrape(self):
        # /scrape: "a missing key means enabled". Both shipped states occur in the tree.
        states = {skill.name: portal_enabled(skill) for skill in installed_portal_skills()}
        self.assertTrue(any(states.values()), f"no enabled portal among {states}")
        self.assertIsInstance(portal_enabled(SKILLS_DIR / "does-not-exist-search"), bool)

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
