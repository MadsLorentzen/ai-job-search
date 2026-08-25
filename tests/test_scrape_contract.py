"""Tests for the /scrape Step 2 search-output contract across portal CLIs.

Mirrors the pattern of test_html_report_command.py: derive the contract from
the spec itself and compare it against the real portal CLIs, so a drift on
either side fails with a clean diff.

Why this test exists: .claude/skills/job-scraper/SKILL.md Step 2 promises
"Search output already includes title, company, location, date, and URL" for
every portal CLI, and Step 4.75's degraded scan flags "company null or empty
on every result" as a half-working parser. A CLI that quietly stops emitting
those fields flags the portal as degraded on every /scrape run while CI stays
green, breaks the seen_jobs.json dedupe (url_or_company_title_key), and leaves
/rank without a posting URL. That failure class landed for real: jobnet-search
emitted only the raw API schema and jobdanmark-search emitted companyName with
no company/location/date keys until both were normalized.

{helpers.ts, commands/search.ts} are the two files where every registered
CLI's search output currently lives (HTML-parsing portals normalize in
helpers.ts, API portals in commands/search.ts). detail.ts is deliberately
excluded: the contract is about the search output /scrape consumes.
"""

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRAPER_SKILL = REPO_ROOT / ".claude" / "skills" / "job-scraper" / "SKILL.md"
PORTAL_CLIS = sorted((REPO_ROOT / ".agents" / "skills").glob("*-search"))

# Derived, never copied: a hardcoded field list drifts in lockstep with
# nothing - if Step 2's prose drops or adds a field, the known-good portals
# and this pin would keep agreeing forever while the contract changed.
_CONTRACT_SENTENCE = re.compile(r"Search output already includes ([a-zA-Z0-9\s,]+)\.", re.MULTILINE)


def derive_contract_fields() -> frozenset[str]:
    text = SCRAPER_SKILL.read_text(encoding="utf-8")
    match = _CONTRACT_SENTENCE.search(text)
    if match is None:
        raise AssertionError("Step 2 contract sentence not found in job-scraper/SKILL.md")
    fields_text = re.sub(r"\s+and\s+", ",", match.group(1))
    fields = {f.strip().lower() for f in fields_text.split(",") if f.strip()}
    return frozenset(fields)


def search_output_source(search_ts: Path) -> str:
    helpers_ts = search_ts.parent.parent / "helpers.ts"
    files = [search_ts, helpers_ts] if helpers_ts.exists() else [search_ts]
    return "\n".join(f.read_text(encoding="utf-8") for f in files)


class ScrapeSearchOutputContractTests(unittest.TestCase):
    """Every portal CLI's search output must carry the Step 2 contract fields."""

    def test_step2_contract_sentence_is_found_in_the_scraper_skill(self):
        """Guards the anchor the field list is derived from."""
        fields = derive_contract_fields()
        self.assertGreaterEqual(fields, {"title", "company", "location", "date", "url"})

    def test_every_portal_cli_emits_the_step2_contract_fields(self):
        contract = derive_contract_fields()
        failures: list[str] = []
        for portal in PORTAL_CLIS:
            search_ts = portal / "cli" / "src" / "commands" / "search.ts"
            if not search_ts.exists():
                failures.append(f"{portal.name}: no cli/src/commands/search.ts")
                continue
            source = search_output_source(search_ts)
            emitted = set(re.findall(r"^\s*([a-zA-Z_][a-zA-Z0-9_]*):", source, re.MULTILINE))
            missing = sorted(contract - emitted)
            if missing:
                failures.append(f"{portal.name}: missing {missing} in search output")
        self.assertEqual([], failures, "; ".join(failures) or "no portal CLIs checked")


if __name__ == "__main__":
    unittest.main()