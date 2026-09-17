"""Job discovery via the existing `.agents/skills/*-search` Bun CLIs --
reused as subprocesses rather than rewritten, per the approved plan.

Only `linkedin-search` is enabled by default. The four Danish portals
(jobbank/jobindex/jobnet/jobdanmark-search) are explicitly "not applicable"
for this US-based candidate per the repo's own
`.claude/skills/job-scraper/search-queries.md`, and `freehire-search` is
tech-focused ("less so for pure marketing roles" per the same file) -- both
are left wired up but disabled so enabling them later is a one-line config
change, not new code.

NOTE on `detected_platform`: the value stored here at discovery time is a
best-effort guess from the CLI's scrape of LinkedIn's public job page, which
empirically returns `applyUrl: null` even for postings that definitely
redirect externally (verified against a known external-redirect posting --
the public/unauthenticated page just doesn't expose that link). So this
almost always comes out "linkedin" regardless of the posting's real apply
mechanism. The authoritative check happens later, live, in
automation/linkedin.py, which re-detects the platform by actually clicking
Apply while logged in. Treat this column as a discovery-time hint, not a
reliable classification.
"""

from __future__ import annotations

import json
import subprocess

from sqlalchemy.orm import Session

from app import models
from app.services.automation.base import detect_platform_from_url
from app.services.rubric_config import REPO_ROOT

BUN = "bun"
JOBAGE_DAYS = 14  # matches search-queries.md's "Date Filter: last 14 days"
RESULTS_PER_QUERY = 75

# (query, location) pairs translated from search-queries.md's Priority 1-4
# categories (native linkedin-search CLI flags instead of Google site-search
# syntax). Widened 2026-09-16 at the user's explicit request ("widen
# aggressively") after they noted the observed volume (~7 new LinkedIn jobs/
# hour across this project's history) looked far too low next to LinkedIn's
# real posting rate. This is still a deliberate, bounded list, not every
# query in search-queries.md or an attempt to match LinkedIn's real volume --
# the CLI's own docs are explicit that automated access is against LinkedIn's
# ToS and to "keep volume low, don't use it commercially or for bulk data
# collection." Widening here is a real increase in scraping volume/risk
# against that guidance, accepted as a known, explicit tradeoff -- not a
# default to widen further without another explicit ask.
LINKEDIN_QUERIES: list[tuple[str, str]] = [
    # Priority 1: Core Marketing Leadership
    ("marketing manager", "Atlanta, GA"),
    ("marketing manager", "Remote"),
    ("digital marketing manager", "Atlanta, GA"),
    ("digital marketing manager", "Remote"),
    ("performance marketing manager", "Atlanta, GA"),
    ("performance marketing manager", "Remote"),
    ("growth marketing manager", "Atlanta, GA"),
    ("growth marketing manager", "Remote"),
    # Priority 2: AI-Enabled / Marketing Operations
    ("marketing operations manager", "Atlanta, GA"),
    ("marketing operations manager", "Remote"),
    ("marketing automation manager", "Atlanta, GA"),
    ("marketing automation manager", "Remote"),
    ("AI marketing manager", "Remote"),
    # Priority 3: Adjacent / Specialist Roles
    ("account-based marketing manager", "Remote"),
    ("CRO manager", "Remote"),
    ("regional marketing manager", "Remote"),
    ("digital marketing specialist", "Atlanta, GA"),
    # Priority 4: Broader Net
    ("digital marketing", "Atlanta, GA"),
]

PORTALS = {
    "linkedin-search": {
        "enabled": True,
        "cli_path": REPO_ROOT / ".agents/skills/linkedin-search/cli/src/cli.ts",
        "queries": LINKEDIN_QUERIES,
    },
    "freehire-search": {"enabled": False, "cli_path": REPO_ROOT / ".agents/skills/freehire-search/cli/src/cli.ts", "queries": []},
    "jobbank-search": {"enabled": False, "cli_path": REPO_ROOT / ".agents/skills/jobbank-search/cli/src/cli.ts", "queries": []},
    "jobindex-search": {"enabled": False, "cli_path": REPO_ROOT / ".agents/skills/jobindex-search/cli/src/cli.ts", "queries": []},
    "jobnet-search": {"enabled": False, "cli_path": REPO_ROOT / ".agents/skills/jobnet-search/cli/src/cli.ts", "queries": []},
    "jobdanmark-search": {"enabled": False, "cli_path": REPO_ROOT / ".agents/skills/jobdanmark-search/cli/src/cli.ts", "queries": []},
}

def detect_platform(apply_url: str | None) -> str:
    return detect_platform_from_url(apply_url, default="linkedin")


def _run_cli(cli_path, *args: str) -> dict | None:
    cmd = [BUN, "run", str(cli_path), *args, "--format", "json"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, cwd=REPO_ROOT)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


PAGE_SIZE = 10  # fixed by the CLI/LinkedIn's guest search page -- one fetch never returns more than this


def search_portal(portal_name: str, query: str, location: str) -> list[dict]:
    """Paginates the CLI (one HTTP fetch per page, 10 results/page) up to
    RESULTS_PER_QUERY. A single un-paginated fetch always caps out at 10
    regardless of `-n` (verified live: `-n 50` on one page still returned
    exactly 10), so reaching a higher target requires walking `--page`.
    Stops early once a page comes back short (fewer than PAGE_SIZE results),
    since that means LinkedIn has no more results left for this query.
    """
    portal = PORTALS[portal_name]
    results: list[dict] = []
    page = 1
    while len(results) < RESULTS_PER_QUERY:
        data = _run_cli(
            portal["cli_path"],
            "search",
            "-q", query,
            "-l", location,
            "--jobage", str(JOBAGE_DAYS),
            "--page", str(page),
            "-n", str(PAGE_SIZE),
        )
        if not data:
            break
        page_results = data.get("results", [])
        results.extend(page_results)
        if len(page_results) < PAGE_SIZE:
            break
        page += 1
    return results[:RESULTS_PER_QUERY]


def fetch_detail(portal_name: str, job_id: str) -> dict | None:
    return _run_cli(PORTALS[portal_name]["cli_path"], "detail", job_id)


def discover_jobs(db: Session, user_id: int) -> dict:
    """Runs all enabled portals' configured queries, ingests new postings
    (deduped by URL *within this user's own jobs* -- two different users can
    legitimately both discover the same real posting) with full detail
    fetched only for genuinely new jobs -- minimizing request volume against
    a ToS-sensitive source.
    """
    stats = {"portals_run": 0, "queries_run": 0, "results_seen": 0, "new_jobs": 0, "errors": []}
    # Tracks URLs inserted earlier in *this* run -- different queries can surface
    # the same posting, and checking only the DB isn't enough within one run
    # unless every insert is flushed first. A local set is cheaper and doesn't
    # depend on session flush timing.
    seen_urls: set[str] = set()

    for portal_name, portal in PORTALS.items():
        if not portal["enabled"]:
            continue
        stats["portals_run"] += 1
        for query, location in portal["queries"]:
            stats["queries_run"] += 1
            results = search_portal(portal_name, query, location)
            if not results:
                stats["errors"].append(f"{portal_name}: no results for '{query}' in '{location}' (or CLI failed)")
                continue
            for result in results:
                stats["results_seen"] += 1
                url = result.get("url")
                if not url or url in seen_urls or db.query(models.JobPosting).filter_by(url=url, user_id=user_id).first():
                    continue
                seen_urls.add(url)

                detail = fetch_detail(portal_name, result["id"])
                description = detail.get("description", "") if detail else ""
                employment_type = detail.get("employmentType", "") if detail else ""
                apply_url = detail.get("applyUrl") if detail else None

                job = models.JobPosting(
                    user_id=user_id,
                    source_portal=portal_name,
                    url=url,
                    company=result.get("company", ""),
                    title=result.get("title", ""),
                    location=result.get("location", ""),
                    employment_type=employment_type,
                    raw_description=description,
                    detected_platform=detect_platform(apply_url),
                )
                db.add(job)
                stats["new_jobs"] += 1
            # Committing once per query (not once for the whole portal) is a
            # direct fix for a real bug: with 18 queries and a slow, subprocess-
            # heavy fetch_detail() call per new posting, one portal's loop can
            # run for many minutes with a single held write transaction --
            # confirmed live this caused a raw "database is locked"
            # OperationalError on collision with any other writer, and worse,
            # silently discarded the ENTIRE cycle's newly-found jobs when that
            # error tore down the session before the one-and-only commit at
            # the end ever ran. Committing after each query shrinks both how
            # long the write lock is held at a time and how much work is lost
            # if a later query in the same cycle does hit a collision.
            db.commit()

    return stats
