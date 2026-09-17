"""Indeed job-board apply connector.

No login is needed to view a posting or resolve its apply destination --
unlike LinkedIn, Indeed's public job page is fully browsable unauthenticated.
What login IS needed for, confirmed live against real postings pulled from
this project's own discovery pipeline: the large majority use "Indeed Apply"
(the button reads "Apply now" or "Apply with Indeed" depending on the
posting), which is Indeed's own natively-hosted application flow. Clicking it
always lands on `secure.indeed.com/auth` -- a create-account-or-sign-in wall
-- before the real form (at smartapply.indeed.com) is ever reached, even for
employers whose underlying ATS is one of the 5 platforms this project already
knows how to fill out. There is no way to see past that wall without an
Indeed account.

That's a materially different shape than LinkedIn's account-gate case: here
it looks to be the dominant path, not an occasional exception. Per this
project's LinkedIn precedent (see linkedin.py's module docstring), automating
past a login wall requires real credentials that only the account owner can
provide via the Settings page -- never typed into a chat conversation with an
assistant -- and that's an explicit, informed decision about ToS risk, not
something to default into. No Indeed credential fields exist in
`credentials.py`'s ALLOWED_KEYS yet, so today this connector cannot get past
that wall and correctly reports `needs_manual` with a clear explanation
rather than attempting a login it has no credentials for.

What this connector DOES handle for real: postings where the employer has
NOT opted into Indeed Apply and the button points straight at an external URL
(their own career site or ATS) instead of smartapply.indeed.com. That case
needs no credentials at all -- it's structurally identical to LinkedIn's
external-redirect handoff (see linkedin.py's `_discover_redirect_url`/
`_handle_redirect`): resolve the real destination, re-detect its platform,
and route to the matching connector (Greenhouse/Lever/Workday/iCIMS/Ashby) if
there is one.

The apply control's real markup is inconsistent between postings -- confirmed
live against several real jobs in the same session: on some it's a plain
`<a href="https://smartapply.indeed.com/...">`, on others the identical-
looking "Apply now"/"Apply with Indeed" text sits inside a `<button>` with no
href at all (Indeed's own client-side JS handles the navigation on click).
Reading `href` off the nearest `<a>` ancestor only works for the first case
and silently found nothing for the second on 13 of 14 real postings surveyed
-- so this clicks the control and observes where the browser actually ends up
(new tab or same-page navigation), the same approach linkedin.py already uses
for its own redirect discovery, rather than trying to read a link target that
may not exist as a static attribute at all.

Known rough edge: sponsored postings route the apply click through an extra
`indeed.com/pagead/clk?...` ad-tracking hop before the real destination --
`_discover_apply_destination` follows that (see its own docstring), but the
tracking hop's own client-side redirect timing isn't perfectly consistent
live (settles within ~7s most of the time, occasionally longer). When it
doesn't resolve further in time, this reports `needs_manual` naming the
tracking URL rather than the true final destination -- a safe, honest
under-resolution (never a wrong "applied"), just not a complete one. Worth
revisiting if this turns out to affect a meaningful share of postings.
"""

from __future__ import annotations

import re

from playwright.sync_api import BrowserContext, Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app import models
from app.services.automation import ashby, greenhouse, icims, lever, workday
from app.services.automation.base import ApplyResult, detect_platform_from_url

REDIRECT_CONNECTORS = {"greenhouse": greenhouse, "lever": lever, "workday": workday, "icims": icims, "ashby": ashby}

INDEED_GATE_DOMAINS = ("secure.indeed.com", "smartapply.indeed.com")
APPLY_TEXT_PATTERN = re.compile("apply", re.IGNORECASE)


def _settle(page: Page, timeout_ms: int = 8_000) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except PlaywrightTimeoutError:
        pass
    page.wait_for_timeout(1_500)


def _find_apply_control(page: Page):
    """Locates the apply control regardless of whether Indeed rendered it as
    a `<button>` or an `<a>` this time (see module docstring). Tries
    role-based lookups first (cheap, usually correct), falling back to a
    plain text match -- clicking the matched element is enough even if it's
    an inner `<div>`, since a real click dispatches and bubbles the same way
    a user's click would, triggering whatever ancestor actually handles it.
    """
    for role in ("button", "link"):
        locator = page.get_by_role(role, name=APPLY_TEXT_PATTERN)
        if locator.count() > 0:
            return locator.first
    text_locator = page.get_by_text(APPLY_TEXT_PATTERN)
    if text_locator.count() > 0:
        return text_locator.first
    return None


MAX_REDIRECT_HOPS = 3  # sponsored postings route through an extra indeed.com/pagead/clk tracking hop


def _discover_apply_destination(context: BrowserContext, page: Page) -> str | None:
    """Clicks the apply control and follows successive hops until landing
    somewhere that isn't still an indeed.com page. Confirmed live: a
    sponsored posting's apply click first lands on
    `indeed.com/pagead/clk?...` (an ad-tracking redirect), not the real
    destination -- that tracking link only resolves when clicked in-page
    (carrying referrer/session state), not when re-navigated to directly in
    a fresh context, so this has to keep clicking through within the same
    browser session rather than extracting a URL and jumping to it.
    """
    current_page = page
    last_url: str | None = None

    for _ in range(MAX_REDIRECT_HOPS):
        control = _find_apply_control(current_page)
        if control is None:
            break

        opened_page = None
        try:
            with context.expect_page(timeout=5_000) as new_page_info:
                control.click(timeout=5_000)
            opened_page = new_page_info.value
        except PlaywrightTimeoutError:
            pass
        except Exception:
            break  # element not actually clickable (e.g. matched decorative text)

        next_page = opened_page if opened_page is not None else current_page
        try:
            next_page.wait_for_load_state("domcontentloaded", timeout=8_000)
        except PlaywrightTimeoutError:
            pass
        # A pagead/clk tracking hop is itself a client-side JS redirect, not
        # a static page -- confirmed live it can still be mid-redirect after
        # domcontentloaded + a short fixed wait, which looked identical to
        # "no further apply control on this page" and stopped one hop short
        # of the real destination. Give it a real settle window and re-check
        # the URL before concluding nothing more is happening.
        try:
            next_page.wait_for_load_state("networkidle", timeout=6_000)
        except PlaywrightTimeoutError:
            pass
        next_page.wait_for_timeout(1_500)

        if next_page.url == last_url:
            break  # no progress
        last_url = next_page.url
        current_page = next_page

        if "indeed.com" not in last_url:
            break  # reached the real external destination
        if any(domain in last_url for domain in INDEED_GATE_DOMAINS):
            break  # reached the native-apply login gate

    return last_url


def apply(
    url: str,
    resume_pdf_path: str,
    cover_letter_pdf_path: str,
    profile: models.CandidateProfile,
    qa_bank: list[models.QABankEntry],
    dry_run: bool,
) -> ApplyResult:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--disable-blink-features=AutomationControlled"])
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )
        page = context.new_page()
        page.goto(url, wait_until="domcontentloaded")
        _settle(page)

        destination = _discover_apply_destination(context, page)
        browser.close()

    if not destination:
        return ApplyResult(
            status="needs_manual",
            detail="No apply control found on the Indeed job page -- posting may have expired or changed layout.",
        )

    if any(domain in destination for domain in INDEED_GATE_DOMAINS):
        return ApplyResult(
            status="needs_manual",
            detail=(
                "Posting uses Indeed Apply, which requires signing in to an Indeed account before the "
                "real form is reachable -- not automated (no Indeed credentials configured). Add Indeed "
                "credentials in Settings to enable this, or apply manually."
            ),
        )

    platform = detect_platform_from_url(destination, default="other")
    connector = REDIRECT_CONNECTORS.get(platform)
    if connector is None:
        return ApplyResult(
            status="needs_manual",
            detail=f"Posting redirects externally to {destination} -- no automated connector for that platform.",
        )
    return connector.apply(destination, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)
