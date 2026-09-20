"""Tests for tools/job_key.py - the canonical seen_jobs.json key function.

/scrape's key rule was prose only, so runs slugified inconsistently and the
state file accumulated two failures: keys carrying "/", "," and "&" that break
the archive-folder path `/apply`/`/outcome` derive from company+role, and the
same job stored twice under two different truncations of a long title. These
pin the fix - a pure, deterministic function of company+title(+url) - and the
audit that finds both failure classes in an existing file.
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from job_key import is_canonical, is_legacy_shape, make_key, slugify  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
TOOL = REPO / "tools" / "job_key.py"


class Slugify(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(slugify("Acme Corp"), "acme-corp")

    def test_strips_punctuation_that_breaks_paths(self):
        self.assertEqual(slugify("Ops Consulting, LLC"), "ops-consulting-llc")
        self.assertEqual(slugify("Penetration Tester / Red Teamer"), "penetration-tester-red-teamer")
        self.assertEqual(slugify("Junior Cybersecurity Analyst (OT/IoT)"), "junior-cybersecurity-analyst-ot-iot")

    def test_non_latin_script_reduces_to_empty(self):
        self.assertEqual(slugify("시큐리온"), "")
        self.assertEqual(slugify("Код Безопасности"), "")


class MakeKey(unittest.TestCase):
    def test_shape(self):
        key = make_key("Acme Corp", "SOC Analyst (L2)")
        self.assertEqual(key, "acme-corp_soc-analyst-l2")
        self.assertTrue(is_canonical(key))

    def test_deterministic_across_calls(self):
        title = "Cyber Intelligence Center Security Analyst with an unusually long title"
        self.assertEqual(make_key("Deloitte", title), make_key("Deloitte", title))

    def test_long_titles_never_collide_after_truncation(self):
        """The bug that produced two Deloitte entries for one posting: two
        runs truncated the same long title at different points. A hash of the
        full slug makes truncation deterministic instead of lossy."""
        a = make_key("Deloitte", "Cyber Intelligence Center Security Analyst with trailing text A")
        b = make_key("Deloitte", "Cyber Intelligence Center Security Analyst with trailing text B")
        self.assertNotEqual(a, b)

    def test_non_latin_title_falls_back_to_the_portal_job_id(self):
        key = make_key(
            "SecuriON",
            "안드로이드 앱(악성코드) 분석가 채용",
            url="https://kr.linkedin.com/jobs/view/x-4461771225",
        )
        self.assertEqual(key, "securion_4461771225")

    def test_non_latin_title_with_no_url_id_still_produces_a_canonical_key(self):
        key = make_key("SecuriON", "안드로이드 앱 분석가", url="")
        self.assertTrue(is_canonical(key))
        self.assertNotEqual(key, "securion_")

    def test_non_latin_company_falls_back_without_producing_a_bare_prefix(self):
        key = make_key("Код Безопасности", "Malware Analytic", url="")
        self.assertTrue(is_canonical(key))
        self.assertFalse(key.startswith("_"))


class CompanyFallbackCLI(unittest.TestCase):
    def key_for(self, company, url="https://example.com/jobs/123456"):
        proc = subprocess.run(
            [sys.executable, str(TOOL), "--company", company,
             "--title", "Software Engineer", "--url", url],
            capture_output=True, text=True, check=True,
        )
        return proc.stdout.strip()

    def test_distinct_non_latin_companies_have_distinct_keys(self):
        keys = [self.key_for(company) for company in ("腾讯", "阿里巴巴", "")]
        self.assertEqual(len(set(keys)), 3)
        self.assertTrue(all(is_canonical(key) for key in keys))

    def test_company_fallback_is_stable_across_case_normalization_and_urls(self):
        for first, second in (("КОМПАНИЯ", "компания"), ("ガンホー", "カ\u3099ンホー")):
            with self.subTest(first=first, second=second):
                self.assertEqual(
                    self.key_for(first),
                    self.key_for(second, "https://example.com/jobs/654321"),
                )

    def test_missing_company_and_existing_ascii_keys_are_unchanged(self):
        self.assertEqual(self.key_for(""), "unknown-company_software-engineer")
        self.assertEqual(self.key_for("  "), "unknown-company_software-engineer")
        self.assertEqual(self.key_for("Acme Corp"), "acme-corp_software-engineer")


class CanonicalAndLegacyShape(unittest.TestCase):
    def test_canonical_accepts_company_underscore_title(self):
        self.assertTrue(is_canonical("acme-corp_soc-analyst"))

    def test_canonical_rejects_path_breaking_characters(self):
        for bad in ("deloitte_junior-cybersecurity-analyst-(ot/iot)",
                    "neverhack-estonia_penetration-tester-/-red-teamer",
                    "ops-consulting,-llc_malware-analyst",
                    "",
                    "securion_"):
            self.assertFalse(is_canonical(bad), f"{bad!r} should not be canonical")

    def test_legacy_three_part_shape_is_flagged_separately_from_malformed(self):
        self.assertTrue(is_legacy_shape("nviso-security_soc-analyst_athens"))
        self.assertFalse(is_canonical("nviso-security_soc-analyst_athens"))
        # A malformed key (bad characters) is never also reported as legacy shape.
        self.assertFalse(is_legacy_shape("deloitte_junior-cybersecurity-analyst-(ot/iot)"))


class AuditCLI(unittest.TestCase):
    def run_audit(self, seen: dict) -> tuple[dict, int]:
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"seen": seen}, fh)
            path = fh.name
        proc = subprocess.run(
            [sys.executable, str(TOOL), "--audit", path], capture_output=True, text=True
        )
        return json.loads(proc.stdout), proc.returncode

    def test_clean_state_exits_zero(self):
        report, code = self.run_audit({"acme_soc-analyst": {"company": "Acme", "title": "SOC Analyst"}})
        self.assertEqual(code, 0)
        self.assertEqual(report["malformed_keys"], [])
        self.assertEqual(report["duplicate_urls"], {})

    def test_malformed_key_exits_nonzero(self):
        report, code = self.run_audit(
            {"deloitte_junior-cybersecurity-analyst-(ot/iot)": {"company": "Deloitte", "title": "x"}}
        )
        self.assertEqual(code, 1)
        self.assertIn("deloitte_junior-cybersecurity-analyst-(ot/iot)", report["malformed_keys"])

    def test_duplicate_url_exits_nonzero(self):
        report, code = self.run_audit(
            {
                "a": {"company": "Acme", "title": "x", "url": "https://x/1"},
                "b": {"company": "Acme", "title": "y", "url": "https://x/1"},
            }
        )
        self.assertEqual(code, 1)
        self.assertIn("https://x/1", report["duplicate_urls"])

    def test_legacy_shape_alone_does_not_fail_the_audit(self):
        """Harmless drift, not damage - the sweep-worthy rewrite is a decision
        the maintainer makes, not something the audit enforces."""
        report, code = self.run_audit({"acme_soc-analyst_athens": {"company": "Acme", "title": "x"}})
        self.assertEqual(code, 0)
        self.assertIn("acme_soc-analyst_athens", report["legacy_three_part_keys"])


if __name__ == "__main__":
    unittest.main()
