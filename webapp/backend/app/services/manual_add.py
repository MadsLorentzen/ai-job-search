"""Best-effort page fetch for manually-added job postings -- discovery via
the linkedin-search CLI is automated, but the user will sometimes hit a
posting some other way (their own LinkedIn browsing, a direct company
careers-page link) and want it tracked the same as anything auto-discovered.

A plain GET + crude HTML stripping is intentionally simple: this is the same
class of static-fetch diagnostic used elsewhere in this codebase (see
discovery.py, rubric_config.py's own notes on unauthenticated scrapes), not a
full browser render, so JS-rendered pages will yield sparse or empty text.
That's an acceptable tradeoff for "give the evaluation engine something to
match keywords against," not a claim of complete extraction.
"""

from __future__ import annotations

import re
import urllib.request
from urllib.parse import urlparse

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def fetch_page_text(url: str, timeout: int = 10) -> tuple[str, str]:
    """Returns (title, visible_text)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""

    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return title, text


def guess_company_from_title(title: str) -> str:
    """Many job-detail <title> tags end with "... | CompanyName" -- a cheap,
    imperfect heuristic, good enough as a prefillable default the user can
    correct rather than leaving the field blank.
    """
    if "|" in title:
        return title.rsplit("|", 1)[1].strip()
    return ""


TITLE_NOISE_SUFFIXES = [" job details", " job posting", " job description", " career details"]


def clean_job_title(title: str) -> str:
    """Strips the "| CompanyName" breadcrumb and common boilerplate suffixes
    (e.g. "CRM Manager Job Details | CRH" -> "CRM Manager") -- same
    prefillable-default philosophy as guess_company_from_title.
    """
    candidate = title.split("|", 1)[0].strip()
    lowered = candidate.lower()
    for suffix in TITLE_NOISE_SUFFIXES:
        if lowered.endswith(suffix):
            candidate = candidate[: -len(suffix)].strip()
            break
    return candidate


def _humanize_slug(slug: str) -> str:
    """Workday URL slugs use "---" where the real title/location has a comma
    or colon, and single "-" for spaces (e.g. "Corporate---Atlanta" ->
    "Corporate - Atlanta", "Senior-Manager---Customer-Experience" ->
    "Senior Manager - Customer Experience"). The two substitutions must not
    collide -- replacing "-{2,}" with " - " first and then blindly replacing
    every remaining "-" with " " would destroy the dash it just inserted, so
    the multi-dash groups are parked behind a placeholder until the
    single-dash pass is done.
    """
    slug = re.sub(r"-{2,}", "\0", slug)
    slug = slug.replace("-", " ")
    slug = slug.replace("\0", " - ")
    return re.sub(r"\s+", " ", slug).strip()


def parse_workday_url_hints(url: str) -> tuple[str, str, str]:
    """Workday postings are a JS-rendered SPA -- a plain GET returns an
    empty shell (confirmed live: title/company/location all came back
    "Unknown" for a real posting), so this falls back to Workday's own very
    consistent URL structure instead:
    https://{company}.wd#.myworkdayjobs.com/{portal}/job/{location-slug}/{title-slug}_{req-id}
    Returns ("", "", "") if the URL doesn't match that shape.
    """
    parsed = urlparse(url)
    host_match = re.match(r"^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$", parsed.netloc, re.IGNORECASE)
    if not host_match:
        return "", "", ""
    company = host_match.group(1).replace("-", " ").title()

    path_match = re.search(r"/job/([^/]+)/([^/]+?)(?:_[A-Za-z]*-?\d+)?$", parsed.path)
    if not path_match:
        return company, "", ""
    location = _humanize_slug(path_match.group(1))
    title = _humanize_slug(path_match.group(2))
    return company, title, location
