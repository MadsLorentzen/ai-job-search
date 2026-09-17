"""Job discovery for sources that can't be scraped directly -- Indeed and
Glassdoor both deprecated or never offered a public API and both run
Cloudflare-class anti-bot detection well beyond LinkedIn's public guest pages
(confirmed live: a plain GET on an individual Indeed `viewjob` URL returns
HTTP 401 "Authenticating... Redirecting to login...", and a plain GET on a
Glassdoor `job-listing` URL returns HTTP 403 with Cloudflare's "Security |
Glassdoor" bot-check page -- the same class of request `manual_add.py` uses
successfully against ATS-hosted postings). Scraping either site's search
results page directly is not viable.

The workaround used here: run `site:indeed.com` / `site:glassdoor.com`
queries through a neutral third-party web-search API and treat the *result
links* as newly-discovered postings, rather than ever requesting
indeed.com/glassdoor.com search pages ourselves. This is the same technique
already documented as the manual fallback in
`.claude/skills/job-scraper/search-queries.md`'s "Google site-searches"
section, just automated. Confirmed live (2026-09-14) that this reliably
surfaces real individual posting URLs (Indeed `/viewjob?jk=...`, Glassdoor
`/job-listing/...`) rather than only category/aggregate pages.

IMPORTANT LIMITATION (confirmed live, not theoretical): the discovered URLs
themselves are subject to the *same* anti-bot walls described above once we
try to fetch them for full description text. `fetch_full_description` below
attempts a best-effort plain GET (reusing `manual_add.fetch_page_text`) and
falls back to the search API's own snippet text when that fetch is blocked.
For Indeed and Glassdoor specifically, expect the fallback to fire most of
the time -- `raw_description` for those sources will often be a short search
snippet (a sentence or two) rather than a full posting, which materially
weakens `evaluation_engine.py`'s keyword-based scoring versus a fully-fetched
LinkedIn posting. This is a real, disclosed trade-off, not a bug to silently
paper over.

Provider: Brave Search API (https://api.search.brave.com/res/v1/web/search).
Chosen because, as of this writing, it is the only major search-API provider
still open to new signups -- Bing Web Search API was fully retired by
Microsoft on 2025-08-11 (no replacement drop-in; its successor requires a
full Azure AI Foundry project), and Google's Custom Search JSON API has been
closed to new customers since its Google-announced Jan 2026 deprecation
notice (existing customers only, sunsetting entirely 2027-01-01). Brave's API
requires a credit card on file even to use its small monthly free credit
(no card-free tier as of Feb 2026) -- provisioning that key is a decision for
the user to make, not something this module can do for them. See
`credentials.py`'s `BRAVE_SEARCH_API_KEY` key.

Every source below defaults to `enabled: False`, matching `discovery.py`'s
existing pattern for sources whose reliability hasn't been proven out in
production yet. This module is intentionally standalone (not wired into
`discovery.py`/`pipeline.py`/any router) -- see the task notes for why.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError

from sqlalchemy.orm import Session

from app import models
from app.services import credentials
from app.services.automation.base import detect_platform_from_url
from app.services.manual_add import clean_job_title, fetch_page_text

BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search"
BRAVE_CREDENTIAL_KEY = "brave_search_api_key"
RESULTS_PER_QUERY = 10
REQUEST_TIMEOUT = 10

# Same (query, location) shape and same short, high-signal-only list as
# discovery.py's LINKEDIN_QUERIES -- kept deliberately small given each query
# costs money against a paid API (Brave: ~$5/1000 queries beyond the small
# free monthly credit) and this module has no built-in throttling of its own
# (it isn't wired into the scheduler; whatever calls it controls cadence).
SEARCH_QUERIES: list[tuple[str, str]] = [
    ("marketing manager", "Atlanta, GA"),
    ("digital marketing manager", "Remote"),
    ("marketing operations manager", "Atlanta, GA"),
    ("performance marketing manager", "Remote"),
]

# Domains that are themselves job aggregators, not employers -- used to keep
# the "unconventional listings" broad source (no site: filter) from just
# re-surfacing the big boards under a different name. Live-tested
# 2026-09-14: a broad query like `"marketing manager" Atlanta hiring` still
# ranks these same aggregators at the top even with exclusion terms in the
# query text, so filtering results *after* the fact (here) is load-bearing,
# not redundant with the query string.
AGGREGATOR_DOMAINS = {
    "linkedin.com",
    "indeed.com",
    "glassdoor.com",
    "ziprecruiter.com",
    "careerbuilder.com",
    "simplyhired.com",
    "snagajob.com",
    "monster.com",
    "dice.com",
    "google.com",
}

# Per-source: how to build the site-restricted query, and how to recognize an
# individual job-posting URL vs. a category/search-results page (both portals'
# search results mix the two -- confirmed live 2026-09-14, e.g. Indeed
# surfaces both "/q-marketing-manager-l-atlanta,-ga-jobs.html" (a category
# listing page, must be excluded) and "/viewjob?jk=..." (an individual
# posting, wanted) for the same query).
SOURCES = {
    "indeed-search": {
        "enabled": False,
        "site_filter": "site:indeed.com",
        "job_url_pattern": re.compile(r"indeed\.com/(viewjob|rc/clk)", re.IGNORECASE),
    },
    "glassdoor-search": {
        "enabled": False,
        "site_filter": "site:glassdoor.com/job-listing",
        "job_url_pattern": re.compile(r"glassdoor\.com/job-listing/", re.IGNORECASE),
    },
    "unconventional-search": {
        # Small/niche company career pages that a site:-restricted query
        # wouldn't catch. Left disabled by default even more strongly than
        # the other two: live testing found that without company-name-seeded
        # queries, broad searches just re-rank the same major aggregators
        # (filtered out here via AGGREGATOR_DOMAINS, which leaves few or no
        # results for a generic role+location query). This becomes useful
        # once a target-company list exists to seed per-company queries;
        # until then it's wired up but not expected to surface much.
        "enabled": False,
        "site_filter": "",
        "job_url_pattern": None,  # no portal-specific URL shape to check
    },
}


def build_search_query(query: str, location: str, site_filter: str) -> str:
    """Builds the Brave `q` parameter. site_filter may be "" for the
    unconventional/broad source.
    """
    parts = [site_filter, f'"{query}"', location]
    return " ".join(p for p in parts if p)


def _domain(url: str) -> str:
    netloc = urllib.parse.urlparse(url).netloc.lower()
    return netloc[4:] if netloc.startswith("www.") else netloc


def is_aggregator_url(url: str) -> bool:
    domain = _domain(url)
    return any(domain == d or domain.endswith("." + d) for d in AGGREGATOR_DOMAINS)


def is_individual_job_url(url: str, source_name: str) -> bool:
    """True if `url` looks like a single posting (not a category/search page)
    for the given source. The unconventional source has no fixed URL shape to
    check against, so anything that isn't an aggregator domain passes.
    """
    source = SOURCES[source_name]
    pattern = source["job_url_pattern"]
    if pattern is None:
        return not is_aggregator_url(url)
    return bool(pattern.search(url))


def extract_company_from_search_title(title: str, source_name: str) -> str:
    """Glassdoor search-result titles follow a fairly consistent
    "{Company} hiring {Role} Job in {City}, {ST} | Glassdoor" or
    "{Role} Job in {City}, {ST} | Glassdoor" shape (confirmed live
    2026-09-14, e.g. "Voltline Atlanta hiring Marketing Manager Job in
    Atlanta, GA | Glassdoor" vs. "Marketing Manager Job in Atlanta, GA |
    Glassdoor" when no employer name is given). Indeed's search-result
    titles do *not* reliably include the company name at all (confirmed
    live: e.g. "Marketing Manager - Atlanta, GA 30326 - Indeed.com"), so
    guessing one there would be fabrication -- always return "" for Indeed
    and let the user fill it in, same as manual_add.py's own philosophy for
    unknown fields.
    """
    if source_name != "glassdoor-search":
        return ""
    match = re.match(r"^(.*?)\s+hiring\s+.+?\s+Job in\s", title, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return ""


def _brave_search(query: str, api_key: str) -> dict | None:
    params = urllib.parse.urlencode({"q": query, "count": RESULTS_PER_QUERY})
    req = urllib.request.Request(
        f"{BRAVE_API_URL}?{params}",
        headers={"Accept": "application/json", "X-Subscription-Token": api_key},
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return None


def parse_search_results(raw_response: dict) -> list[dict]:
    """Extracts {title, url, snippet} dicts from a Brave web-search JSON
    response. Missing/malformed `web.results` yields an empty list rather
    than raising -- a shape change or empty result set from a third-party API
    shouldn't crash discovery.
    """
    results = raw_response.get("web", {}).get("results", [])
    parsed = []
    for item in results:
        url = item.get("url")
        if not url:
            continue
        parsed.append({
            "title": item.get("title", ""),
            "url": url,
            "snippet": item.get("description", ""),
        })
    return parsed


def fetch_full_description(url: str) -> str:
    """Best-effort full-page fetch, reusing manual_add's plain-GET fetcher.
    Returns "" on any failure (auth wall, bot-check block, timeout, etc.) so
    callers can fall back to the search snippet instead. Deliberately does
    not distinguish failure reasons -- from the caller's perspective a 401
    "Authenticating..." page and a 403 Cloudflare block are the same "we
    didn't get real content" outcome.
    """
    try:
        _title, text = fetch_page_text(url)
    except Exception:
        return ""
    # A blocked/challenge page still returns HTTP 200 sometimes with a tiny
    # body ("Authenticating... Redirecting to login." is 41 chars) -- treat
    # suspiciously short bodies as failures too rather than storing them as
    # if they were real descriptions.
    if len(text) < 200:
        return ""
    return text


def discover_via_search_api(db: Session, user_id: int) -> dict:
    """Runs all enabled SOURCES' configured queries through the Brave Search
    API and ingests newly-discovered postings, mirroring discovery.py's
    discover_jobs() shape (same stats dict keys, same dedup-by-URL approach)
    so the two can eventually share a caller. Returns immediately with a
    single error entry if no Brave API key is configured -- this must never
    raise just because the user hasn't provisioned a key yet.
    """
    stats = {"portals_run": 0, "queries_run": 0, "results_seen": 0, "new_jobs": 0, "errors": []}

    api_key = credentials.get_credential(BRAVE_CREDENTIAL_KEY, user_id)
    if not api_key:
        stats["errors"].append(
            f"No Brave Search API key configured (credential key '{BRAVE_CREDENTIAL_KEY}') -- skipped."
        )
        return stats

    seen_urls: set[str] = set()

    for source_name, source in SOURCES.items():
        if not source["enabled"]:
            continue
        stats["portals_run"] += 1
        for query, location in SEARCH_QUERIES:
            stats["queries_run"] += 1
            search_query = build_search_query(query, location, source["site_filter"])
            raw_response = _brave_search(search_query, api_key)
            if not raw_response:
                stats["errors"].append(f"{source_name}: search failed for '{search_query}'")
                continue

            for result in parse_search_results(raw_response):
                stats["results_seen"] += 1
                url = result["url"]
                if not is_individual_job_url(url, source_name):
                    continue
                if url in seen_urls or db.query(models.JobPosting).filter_by(url=url, user_id=user_id).first():
                    continue
                seen_urls.add(url)

                description = fetch_full_description(url) or result["snippet"]
                job = models.JobPosting(
                    user_id=user_id,
                    source_portal=source_name,
                    url=url,
                    company=extract_company_from_search_title(result["title"], source_name),
                    title=clean_job_title(result["title"]),
                    location=location,
                    raw_description=description,
                    detected_platform=detect_platform_from_url(url, default="other"),
                )
                db.add(job)
                stats["new_jobs"] += 1
        db.commit()

    return stats
