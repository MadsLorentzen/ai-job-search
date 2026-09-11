from __future__ import annotations

import json
import sys
import time
import urllib.parse
from typing import Any

from playwright.sync_api import Page, sync_playwright

print("[HiringCafe] MODULE LOADING...", flush=True)

HIRING_CAFE_BASE = "https://hiring.cafe/"

# Captured from a manual "Remote only" filter session on hiring.cafe.
# workplace_types=["Remote"] is the actual filter; flexible_regions lets
# in Africa-wide / worldwide listings that have no fixed location too.
REMOTE_LOCATION_FILTER: dict[str, Any] = {
    "formatted_address": "Kenya",
    "types": ["country"],
    "geometry": {"location": {"lat": -0.72104, "lon": 37.15259}},
    "id": "user_country",
    "address_components": [
        {"long_name": "Kenya", "short_name": "KE", "types": ["country"]}
    ],
    "options": {"flexible_regions": ["anywhere_in_continent", "anywhere_in_world"]},
    "workplace_types": ["Remote"],
}

DEFAULT_QUERIES: list[str] = [
    "Data Analyst",
    "Data Engineer",
    "Analytics Engineer",
    "BI Developer",
    "Data Engineer dbt Airflow",
]

# Skill terms pulled from the user's CV/skillset, used to post-filter
# results after search. hiring.cafe's own search is fuzzy enough to
# surface loosely-related roles (e.g. "iOS Engineer" matching a query
# for "Analytics Engineer"), so this checks whether a job's actual text
# content contains real overlap with the user's skillset before keeping it.
SKILL_KEYWORDS: list[str] = [
    "python", "sql", "t-sql", "dax", "power bi", "power query", "power pivot",
    "vba", "dbt", "airflow", "docker", "postgres", "postgresql", "sql server",
    "redis", "duckdb", "bigquery", "snowflake", "databricks", "azure",
    "fabric", "streamlit", "plotly", "fastapi", "pandas", "polars", "excel",
    "reconciliation", "data engineering", "data analyst", "data analytics",
    "analytics engineer", "etl", "elt", "git", "ci/cd", "star schema",
    "data modeling", "data warehouse", "business intelligence", "tableau",
    "looker", "redshift", "mysql", "medallion",
]


def _skill_match_count(job: dict[str, Any]) -> int:
    haystack = " ".join(
        str(job.get(field) or "")
        for field in ("title", "company_blurb", "description_snippet")
    ).lower()
    return sum(1 for kw in SKILL_KEYWORDS if kw in haystack)

# JS helper: from the job link, climb parentElement looking for the card
# container (identified by its distinctive Tailwind classes), falling back
# to a fixed depth of 3 if the class-based match ever fails.
_CLIMB_TO_CARD_JS = """
(el) => {
    let node = el;
    let fallback = null;
    for (let i = 0; i < 10 && node; i++) {
        if (i === 3) fallback = node;
        const cls = node.className || "";
        if (typeof cls === "string" && cls.includes("rounded-xl") && cls.includes("border-gray-200")) {
            return node.innerText;
        }
        node = node.parentElement;
    }
    return fallback ? fallback.innerText : null;
}
"""


def _build_search_url(query: str, location_filter: dict[str, Any] = REMOTE_LOCATION_FILTER) -> str:
    search_state = {"searchQuery": query, "locations": [location_filter]}
    encoded = urllib.parse.quote(json.dumps(search_state))
    return f"{HIRING_CAFE_BASE}?searchState={encoded}"


def _parse_card_text(text: str, href: str, base_url: str, query: str) -> dict[str, Any]:
    lines = [line.strip() for line in text.split("\n") if line.strip()]

    posted = lines[0] if len(lines) > 0 else None
    title = lines[1] if len(lines) > 1 else None
    location = lines[2] if len(lines) > 2 else None

    # Some cards insert an extra salary line (e.g. "$80k-$120k/yr",
    # "€4k-€6k/mo") between location and the workplace-type line, which
    # shifts every field after it by one. Since every result here is
    # Remote-filtered, locate the literal "Remote" line and parse
    # relative to it instead of trusting a fixed position.
    remote_idx = None
    for i in range(3, len(lines)):
        if lines[i].strip().lower() == "remote":
            remote_idx = i
            break

    if remote_idx is not None:
        extra_lines = lines[3:remote_idx]
        salary = extra_lines[0] if extra_lines else None
        work_mode = lines[remote_idx]
        employment_type = lines[remote_idx + 1] if len(lines) > remote_idx + 1 else None
        company_idx = remote_idx + 2
    else:
        # Fallback: shouldn't happen given the Remote-only filter, but
        # keep the old fixed-position behavior rather than crashing.
        salary = None
        work_mode = lines[3] if len(lines) > 3 else None
        employment_type = lines[4] if len(lines) > 4 else None
        company_idx = 5

    company = None
    company_blurb = None
    if len(lines) > company_idx:
        company_line = lines[company_idx]
        if ":" in company_line:
            company, _, company_blurb = company_line.partition(":")
            company = company.strip()
            company_blurb = company_blurb.strip()
        else:
            company = company_line

    description_snippet = " ".join(lines[company_idx + 1 :]) if len(lines) > company_idx + 1 else None

    return {
        "title": title,
        "company": company,
        "company_blurb": company_blurb,
        "location": location,
        "salary": salary,
        "work_mode": work_mode,
        "employment_type": employment_type,
        "posted": posted,
        "description_snippet": description_snippet,
        "url": urllib.parse.urljoin(base_url, href),
        "matched_query": query,
    }


def _goto_with_retry(page: Page, url: str, attempts: int = 3) -> Any:
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return page.goto(url, wait_until="domcontentloaded", timeout=30000)
        except Exception as exc:
            last_exc = exc
            wait_s = 2 * attempt
            print(
                f"[HiringCafe] goto attempt {attempt}/{attempts} failed: {exc}. "
                f"Retrying in {wait_s}s...",
                flush=True,
            )
            time.sleep(wait_s)
    raise last_exc  # type: ignore[misc]


def _extract_jobs_from_page(page: Page, query: str, limit: int) -> list[dict[str, Any]]:
    try:
        page.wait_for_selector("a[href*='/job/']", timeout=10000)
    except Exception as exc:
        print(f"[HiringCafe] No job links appeared for {query!r}: {exc}", flush=True)
        return []

    links = page.locator("a[href*='/job/']")
    count = links.count()
    print(f"[HiringCafe] {query!r} -> {count} job links found", flush=True)

    results: list[dict[str, Any]] = []
    for i in range(min(count, limit)):
        link = links.nth(i)
        href = link.get_attribute("href")
        if not href:
            continue

        card_text = link.evaluate(_CLIMB_TO_CARD_JS)
        if not card_text:
            print(f"[HiringCafe] Could not extract card text for {href}", flush=True)
            continue

        results.append(_parse_card_text(card_text, href, page.url, query))

    return results


def fetch_hiring_cafe_jobs(
    queries: str | list[str] = DEFAULT_QUERIES,
    limit_per_query: int = 10,
    min_skill_matches: int = 2,
) -> list[dict[str, Any]]:
    """
    Search hiring.cafe across one or more query terms, restricted to
    Remote-only roles (Kenya-based + Africa-wide + worldwide remote,
    per the captured filter), deduped by job URL.

    Navigates directly to URLs with `searchState` baked in (matching the
    site's own SPA links) rather than driving the on-page search box or
    filter UI — programmatic typing/clicking triggers Cloudflare's
    bot-management challenge on the follow-up API call; a direct
    full-page navigation does not.

    After collecting results, each job is scored against SKILL_KEYWORDS
    (title + company blurb + description text) and only kept if it hits
    at least `min_skill_matches` terms — filters out loosely-related
    results hiring.cafe's own fuzzy search lets through (e.g. an "iOS
    Engineer" role matching a query for "Analytics Engineer"). Pass
    min_skill_matches=0 to disable filtering and keep everything.
    Results are sorted by skill_match_count, highest first.
    """
    if isinstance(queries, str):
        queries = [queries]

    print(f"[HiringCafe] FUNCTION STARTED | queries={queries!r}", flush=True)

    all_jobs: dict[str, dict[str, Any]] = {}  # keyed by job URL, dedupes across queries

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=False,
                timeout=15000,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                ],
            )
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1440, "height": 900},
                locale="en-US",
            )
            page = context.new_page()
            page.set_default_timeout(15000)

            for query in queries:
                url = _build_search_url(query)
                print(f"\n[HiringCafe] Navigating to {url}", flush=True)

                try:
                    response = _goto_with_retry(page, url)
                except Exception as exc:
                    print(f"[HiringCafe] Giving up on {query!r}: {exc}", flush=True)
                    continue

                status = response.status if response else None
                print(f"[HiringCafe] Status: {status}", flush=True)

                if status is not None and status >= 400:
                    print(f"[HiringCafe] Non-OK status {status} for {query!r}, skipping.", flush=True)
                    continue

                jobs = _extract_jobs_from_page(page, query, limit_per_query)
                for job in jobs:
                    all_jobs.setdefault(job["url"], job)

                # Small, polite pause between searches.
                time.sleep(2)

            browser.close()

    except Exception as exc:
        print("\n[HiringCafe] !!! EXCEPTION !!!", flush=True)
        print(f"Type: {type(exc).__name__}", flush=True)
        print(f"Message: {exc}", flush=True)
        print("Python executable:", sys.executable, flush=True)

    results = list(all_jobs.values())
    print(f"\n[HiringCafe] {len(results)} unique jobs before skill filtering.", flush=True)

    for job in results:
        job["skill_match_count"] = _skill_match_count(job)

    if min_skill_matches > 0:
        before = len(results)
        results = [j for j in results if j["skill_match_count"] >= min_skill_matches]
        print(
            f"[HiringCafe] {len(results)}/{before} jobs kept "
            f"(min_skill_matches={min_skill_matches}).",
            flush=True,
        )

    results.sort(key=lambda j: j["skill_match_count"], reverse=True)

    print(f"[HiringCafe] Returned {len(results)} jobs across {len(queries)} queries.", flush=True)
    return results


if __name__ == "__main__":
    jobs = fetch_hiring_cafe_jobs()

    for j in jobs:
        print(json.dumps(j, indent=2), flush=True)
