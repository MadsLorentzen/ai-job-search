from __future__ import annotations

import dataclasses
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[3] / "data"
SESSION_DIR = DATA_DIR / "browser_sessions"


@dataclasses.dataclass
class ApplyResult:
    status: str  # "applied" | "dry_run_ready" | "needs_manual" | "failed"
    detail: str


def ensure_session_dir() -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)


def linkedin_storage_state_path(user_id: int) -> Path:
    # Per-user, not a single shared file: this stores a real logged-in
    # LinkedIn browser session. A shared path would mean the second account
    # to run an apply cycle silently reuses -- and applies as -- the first
    # account's LinkedIn login.
    return SESSION_DIR / f"linkedin_storage_state_{user_id}.json"


# Shared by discovery.py (classifying a posting's applyUrl at scrape time) and
# linkedin.py (classifying the real destination discovered by clicking Apply
# live -- see linkedin.py's module docstring for why the scrape-time value
# alone is not reliable: LinkedIn's public/unauthenticated job page doesn't
# expose the real external redirect target, so it always comes back null even
# for postings that definitely redirect externally).
APPLY_DOMAIN_PATTERNS = {
    "greenhouse.io": "greenhouse",
    "job-boards.greenhouse.io": "greenhouse",
    "jobs.lever.co": "lever",
    "myworkdayjobs.com": "workday",
    "icims.com": "icims",
    "jobs.ashbyhq.com": "ashby",
    "indeed.com": "indeed",
}

# Some employers front Greenhouse (or another known ATS) with their own
# branded domain -- confirmed live: stripe.com/careers/apply/... is actually
# Greenhouse, given away only by the `gh_src=` tracking parameter Greenhouse
# appends, not by the domain. Domain matching alone misses these; check for
# platform-specific URL fingerprints as a fallback.
APPLY_URL_FINGERPRINTS = {
    "gh_src=": "greenhouse",
    "gh_jid=": "greenhouse",
}


def detect_platform_from_url(url: str | None, default: str = "other") -> str:
    if not url:
        return default
    for domain, platform in APPLY_DOMAIN_PATTERNS.items():
        if domain in url:
            return platform
    for fingerprint, platform in APPLY_URL_FINGERPRINTS.items():
        if fingerprint in url:
            return platform
    return default
