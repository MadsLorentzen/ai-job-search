"""Loads evaluation-rubric reference data from the source-of-truth markdown
files (`.claude/skills/job-application-assistant/04-job-evaluation.md` and
`CLAUDE.md`), the same way `scripts/seed_resume_master.py` loads profile data.
Kept out of the database because this is static scoring configuration, not
user resume content -- editing it means editing the markdown, same as the
interactive Claude Code workflow already does.
"""

from __future__ import annotations

import functools
import re
from pathlib import Path

from app.services.text_utils import contains_any_phrase, split_respecting_parens

REPO_ROOT = Path(__file__).resolve().parents[4]
EVALUATION_MD = REPO_ROOT / ".claude/skills/job-application-assistant/04-job-evaluation.md"
CLAUDE_MD = REPO_ROOT / "CLAUDE.md"

# Atlanta-metro location tokens for the Location & Logistics pass/fail gate.
# Deliberately NOT geocoding the candidate's literal home address against a
# third-party API -- that would leak street-level PII to an external service
# for no real accuracy gain. A curated keyword list has no such exposure and
# is easy for the user to extend directly in this file.
ATLANTA_METRO_TOKENS = [
    "atlanta", "marietta", "kennesaw", "alpharetta", "sandy springs", "roswell",
    "decatur", "duluth", "norcross", "smyrna", "dunwoody", "brookhaven",
    "johns creek", "peachtree corners", "buckhead", "midtown", "gwinnett",
    "cobb county", "fulton county", "dekalb county", "acworth", "woodstock",
    "canton", "lawrenceville", "suwanee", "college park", "east point",
]
RELOCATION_REQUIRED_PHRASES = ["relocation required", "must relocate", "willing to relocate to"]
REMOTE_PHRASES = ["remote", "work from home", "wfh"]
# Checked before REMOTE_PHRASES -- "no remote option" contains "remote" as a plain
# substring but means the opposite. Negation phrases must win that conflict.
NOT_REMOTE_PHRASES = [
    "no remote", "not remote", "without remote", "on-site only", "onsite only",
    "in-office only", "no work from home", "not eligible for remote",
]
HYBRID_PHRASES = ["hybrid"]
# Confirmed live this gap caused a real bad auto-submission: a posting whose
# `location` field literally read "Chennai, Tamil Nadu, India" still passed
# location_pass, because its description also contained the bare word
# "remote" with no country qualifier -- REMOTE_PHRASES has no concept of
# *which* country a "remote" role is based in, and plenty of international
# employers post "remote" roles that are remote only within their own
# country (payroll/tax/legal reasons), not remote-eligible for a US-based
# candidate. Checked only against `location_text` (not the full description,
# which is noisier and more likely to mention unrelated countries in
# company-bio boilerplate) -- and a match there only overrides a plain
# "remote" pass if the haystack doesn't ALSO carry an explicit US-remote
# qualifier.
NON_US_LOCATION_SIGNALS = [
    "india", "pakistan", "philippines", "united kingdom", "canada", "mexico",
    "brazil", "germany", "france", "spain", "poland", "ukraine", "romania",
    "nigeria", "kenya", "south africa", "australia", "singapore", "vietnam",
    "indonesia", "bangladesh", "china", "japan", "south korea", "israel",
    "uae", "united arab emirates", "netherlands", "italy", "portugal",
    "argentina", "colombia", "chile", "egypt", "ireland", "new zealand",
    # City/region names that name a place but not the country -- LinkedIn's
    # own "Greater X Area" convention. Confirmed live this slipped a real job
    # through: location field "Greater Kolkata Area" (Kolkata, India) matched
    # none of the plain country names above, so the India-remote gate never
    # triggered even though the job's own URL (in.linkedin.com/...) and
    # description ("Location: Remote", no US qualifier) both said India.
    # Country-name matching alone is structurally incomplete for this -- see
    # also the LinkedIn-subdomain check in location_pass() below, which
    # catches this class of gap more generally than enumerating cities ever
    # could.
    "kolkata", "bengaluru", "bangalore", "mumbai", "hyderabad", "chennai",
    "pune", "delhi", "gurugram", "gurgaon", "noida", "kolkata area",
    "london", "manchester", "toronto", "vancouver", "montreal", "sydney",
    "melbourne", "dublin", "berlin", "munich", "paris", "madrid", "warsaw",
    "sao paulo", "são paulo", "mexico city", "lagos", "nairobi", "manila",
    "jakarta", "ho chi minh", "shanghai", "beijing", "tokyo", "seoul",
    "tel aviv", "dubai", "abu dhabi",
]
US_REMOTE_QUALIFIER_PHRASES = [
    "remote (us)", "remote - united states", "remote, united states",
    "remote (united states)", "us remote", "us-based remote", "remote - us",
    "remote in the united states", "remote (usa)", "remote - usa",
]
# LinkedIn serves postings under a country-code subdomain for many non-US
# jobs (e.g. `in.linkedin.com` for India, `uk.linkedin.com` for the UK) --
# US/default postings use bare `www.linkedin.com`, no country code. This is
# a structural signal, not text matching, so it catches location strings
# NON_US_LOCATION_SIGNALS' city/country list will always be incomplete for
# (any city, in any language, that list hasn't enumerated).
NON_US_LINKEDIN_SUBDOMAIN = re.compile(r"^https?://([a-z]{2})\.linkedin\.com/", re.IGNORECASE)


@functools.lru_cache
def load_experience_title_tiers() -> dict[str, list[str]]:
    text = EVALUATION_MD.read_text()
    section = text.split("### 2. Experience Match", 1)[1].split("\n### ", 1)[0]
    tiers = {}
    for tier, label in [("strong", "Strong"), ("moderate", "Moderate"), ("entry-level", "Entry-level")]:
        m = re.search(rf"\*\*{label}:\*\*\s*(.+)", section)
        tiers[tier] = [t.strip() for t in split_respecting_parens(m.group(1))] if m else []
    return tiers


MAX_KEYWORD_WORDS = 4  # longer fragments are prose clauses, not matchable keywords


def _clean_keyword_fragments(text: str) -> list[str]:
    terms = []
    for term in split_respecting_parens(text):
        # " - " (spaced dash) separates a real term from a trailing qualifier
        # clause, e.g. "website/CRO - open to hands-on or strategic scope" --
        # hyphenated compound words like "cross-border" have no surrounding
        # spaces, so this doesn't touch them.
        term = re.split(r"\s+-\s+", term)[0]
        term = term.strip().rstrip(".")
        if term and len(term) > 2 and len(term.split()) <= MAX_KEYWORD_WORDS:
            terms.append(term)
    return terms


@functools.lru_cache
def load_career_alignment_keywords() -> list[str]:
    """Coarse keyword bank for the Career Alignment proxy (see plan limitation
    #1 -- this is not a substitute for genuine judgment about growth/energy fit,
    just a keyword-overlap signal against the user's stated target sectors and
    energizing-task descriptions. Fragments longer than MAX_KEYWORD_WORDS are
    dropped -- a 10-word prose clause will never match a job posting verbatim
    and just wastes a scoring slot.
    """
    keywords: set[str] = set()

    claude_text = CLAUDE_MD.read_text()
    sectors_section = claude_text.split("### Target Sectors", 1)[1].split("\n### ", 1)[0]
    for line in sectors_section.splitlines():
        line = line.strip().lstrip("- ").strip()
        if ":" in line:
            line = line.split(":", 1)[1]
        for term in _clean_keyword_fragments(line):
            if "no specific" not in term.lower():
                keywords.add(term)

    eval_text = EVALUATION_MD.read_text()
    energize_match = re.search(r"Tasks that energize:\s*(.+)", eval_text)
    if energize_match:
        keywords.update(_clean_keyword_fragments(energize_match.group(1)))

    return sorted(keywords)


def location_pass(location_text: str, description_text: str, url: str = "") -> tuple[bool, str]:
    haystack = f"{location_text} {description_text}".lower()

    if contains_any_phrase(haystack, RELOCATION_REQUIRED_PHRASES):
        return False, "Posting requires relocation -- deal-breaker."
    # Negation check must come before the plain REMOTE_PHRASES check --
    # "no remote option" contains "remote" but means the opposite.
    is_explicitly_not_remote = contains_any_phrase(haystack, NOT_REMOTE_PHRASES)
    if not is_explicitly_not_remote and contains_any_phrase(haystack, REMOTE_PHRASES):
        subdomain_match = NON_US_LINKEDIN_SUBDOMAIN.match(url or "")
        is_non_us_subdomain = bool(subdomain_match) and subdomain_match.group(1).lower() != "www"
        is_non_us_location = contains_any_phrase(location_text.lower(), NON_US_LOCATION_SIGNALS) or is_non_us_subdomain
        is_confirmed_us_remote = contains_any_phrase(haystack, US_REMOTE_QUALIFIER_PHRASES)
        if is_non_us_location and not is_confirmed_us_remote:
            reason = (
                f"posting URL uses LinkedIn's '{subdomain_match.group(1)}.' country subdomain"
                if is_non_us_subdomain and not contains_any_phrase(location_text.lower(), NON_US_LOCATION_SIGNALS)
                else f"location field names a non-US place ('{location_text}')"
            )
            return False, (
                f"{reason.capitalize()} and the posting doesn't explicitly confirm US-remote eligibility "
                "-- likely remote within that country only, not for a US-based candidate. Review manually."
            )
        return True, "Remote -- passes regardless of city."
    if contains_any_phrase(haystack, ATLANTA_METRO_TOKENS):
        note = "Hybrid, within Atlanta metro." if contains_any_phrase(haystack, HYBRID_PHRASES) else "Within Atlanta metro."
        return True, note
    return False, "Location not recognized as Atlanta metro, remote, or hybrid-in-metro -- review manually."


def employment_type_flag(description_text: str, preference: str) -> str:
    haystack = description_text.lower()
    is_full_time = "full-time" in haystack or "full time" in haystack
    is_part_time = "part-time" in haystack or "part time" in haystack
    if preference == "part-time" and is_full_time and not is_part_time:
        return "Posting appears full-time; user prefers part-time -- confirm before applying."
    return ""
