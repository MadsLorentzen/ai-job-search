"""LinkedIn Easy Apply automation.

IMPORTANT -- read before enabling this for real: these selectors are written
from documented/observed LinkedIn UI patterns, not verified against a live
authenticated session. Verifying them requires real LinkedIn credentials,
which only the account owner can provide (via the Settings page -- never by
typing a password into a chat conversation with an assistant). Until someone
runs this once with dry_run=True and reviews the resulting
`application_event` log, treat every selector here as unverified. Do not
flip dry_run off for this connector before that review happens.

Also stated plainly for whoever reads this file later: automating LinkedIn
at all is against LinkedIn's Terms of Service and risks the account being
rate-limited or suspended. That was an explicit, informed decision by the
account owner made earlier in this project, not an oversight -- see the
project's own notes on this tradeoff before assuming it's safe to widen.

Redirect handoff: `job.detected_platform` from discovery is usually just
"linkedin" regardless of the posting's real apply mechanism -- LinkedIn's
public/unauthenticated job page doesn't expose the real external redirect
target, so the discovery-time scrape can't tell an Easy Apply posting from
an external-redirect one (verified empirically against a known
external-redirect posting; see discovery.py's docstring). So when there's no
Easy Apply button, this module clicks the real "Apply" button live (now that
we're logged in) and re-detects the platform from wherever it actually goes,
handing off to the matching connector with the real URL if one exists.
"""

from __future__ import annotations

import re

from playwright.sync_api import BrowserContext, Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app import models
from app.services import credentials as cred_service
from app.services.automation import ashby, form_filling, greenhouse, icims, lever, workday
from app.services.automation.base import (
    SESSION_DIR,
    ApplyResult,
    detect_platform_from_url,
    ensure_session_dir,
    linkedin_storage_state_path,
)

REDIRECT_CONNECTORS = {"greenhouse": greenhouse, "lever": lever, "workday": workday, "icims": icims, "ashby": ashby}

LOGIN_URL = "https://www.linkedin.com/login"
LOGIN_TIMEOUT_MS = 15_000
MAX_FORM_STEPS = 10  # hard cap so an unrecognized form can never loop forever


def _is_logged_in(page: Page) -> bool:
    try:
        page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=10_000)
    except Exception:
        # A live capture showed the post-login page mid-transition (a bare
        # loading spinner) when this ran -- LinkedIn's own client-side
        # redirect was still in flight and our forced navigation to /feed
        # raced it, producing net::ERR_ABORTED. Falling back to whatever URL
        # we're already on is more honest than treating that race as a hard
        # failure and crashing the whole apply attempt.
        pass
    return "linkedin.com/feed" in page.url


def _login(page: Page, user_id: int) -> tuple[bool, str]:
    username = cred_service.get_credential("linkedin_username", user_id)
    password = cred_service.get_credential("linkedin_password", user_id)
    if not username or not password:
        return False, "LinkedIn credentials not configured -- set them in Settings first."

    page.goto(LOGIN_URL, wait_until="domcontentloaded")
    try:
        # LinkedIn's login page is a JS-hydrated SPA with React-generated
        # per-load element IDs (confirmed via a live fetch of the actual page
        # -- no stable #username/#password ids exist, and the submit control
        # is type="button", not type="submit"). autocomplete attributes are
        # set at server-render time for browser autofill/accessibility and
        # are far more stable than generated ids or button markup, and
        # pressing Enter in the password field sidesteps needing to identify
        # the submit button's exact selector at all. The page also appears to
        # render two matching copies of each field (likely duplicate
        # responsive-layout markup, only one shown via CSS) -- Playwright's
        # fill() fails outright on a selector matching more than one element,
        # so this scopes to the one actually visible.
        page.locator("input[autocomplete='username']:visible").first.fill(username)
        page.locator("input[autocomplete='current-password']:visible").first.fill(password)
        page.keyboard.press("Enter")
        page.wait_for_load_state("domcontentloaded", timeout=LOGIN_TIMEOUT_MS)
    except PlaywrightTimeoutError:
        return False, "Login form didn't behave as expected -- LinkedIn may have changed its login page."

    # A live capture showed a bare loading spinner right after submit --
    # domcontentloaded fires on that shell before LinkedIn's client-side
    # post-login redirect actually completes. Give the SPA transition time
    # to settle before checking anything, so this doesn't race the redirect
    # the way the immediate _is_logged_in() check used to (net::ERR_ABORTED).
    try:
        page.wait_for_load_state("networkidle", timeout=LOGIN_TIMEOUT_MS)
    except PlaywrightTimeoutError:
        pass  # best-effort settle; fall through to check whatever state we're in

    if "checkpoint" in page.url or "challenge" in page.url:
        # 2FA / security checkpoint -- this must never be automated around.
        return False, "LinkedIn presented a security checkpoint (2FA/captcha) -- requires manual login."

    # Capture the actual post-submit landing page BEFORE calling
    # _is_logged_in() -- that function itself navigates to /feed, which would
    # silently overwrite page.url and destroy this diagnostic information.
    landing_url = page.url
    screenshot_path = SESSION_DIR / "last_login_attempt.png"
    try:
        page.screenshot(path=str(screenshot_path))
    except Exception:
        pass  # diagnostics only -- never let a screenshot failure mask the real result

    if _is_logged_in(page):
        return True, "Logged in."
    return False, f"Login did not reach the feed page -- landed on {landing_url} after submit (screenshot: {screenshot_path})."


def apply(
    job: models.JobPosting,
    resume_pdf_path: str,
    cover_letter_pdf_path: str,
    profile: models.CandidateProfile,
    qa_bank: list[models.QABankEntry],
    dry_run: bool,
    user_id: int,
) -> ApplyResult:
    ensure_session_dir()
    storage_state_path = linkedin_storage_state_path(user_id)
    # Populated only when the posting turns out to redirect externally --
    # handled via _handle_redirect() AFTER the `with sync_playwright()` block
    # below fully exits. Calling another connector's own sync_playwright()
    # context while this one is still open raises "Playwright Sync API
    # inside the asyncio loop" (confirmed live -- Playwright's sync API does
    # not support nested/reentrant contexts in the same thread), so the
    # handoff must happen strictly after this block, not from inside it.
    redirect_url: str | None = None
    account_gated = False

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context_kwargs = {}
        if storage_state_path.exists():
            context_kwargs["storage_state"] = str(storage_state_path)
        context = browser.new_context(**context_kwargs)
        page = context.new_page()

        if not _is_logged_in(page):
            ok, detail = _login(page, user_id)
            if not ok:
                browser.close()
                return ApplyResult(status="needs_manual", detail=detail)
            context.storage_state(path=str(storage_state_path))

        page.goto(job.url, wait_until="domcontentloaded")
        # The job page is a JS-rendered SPA like the login page (see _login's
        # notes on the same class of bug) -- domcontentloaded can fire before
        # the Apply/Easy Apply buttons actually render, making both checks
        # below come back empty even on a posting that has one. Give it a
        # moment to settle first.
        try:
            page.wait_for_load_state("networkidle", timeout=8_000)
        except PlaywrightTimeoutError:
            pass  # best-effort settle; fall through and check whatever rendered
        # Confirmed live: even after the networkidle attempt above times out
        # (LinkedIn's own persistent connections mean it often never truly
        # goes idle), the Apply/Easy Apply button can still render a beat
        # later -- a real posting's button was reliably present ~2.5s after
        # domcontentloaded but absent immediately after the networkidle
        # timeout with no extra buffer, causing a false "no button found".
        page.wait_for_timeout(2_000)

        already_applied_detail = _already_applied_detail(page)
        if already_applied_detail:
            browser.close()
            return ApplyResult(status="applied", detail=already_applied_detail)

        if _visible_role(page, "button", "Easy Apply").count() == 0:
            redirect_url, account_gated = _discover_redirect_url(context, page)
            browser.close()
        else:
            return _run_easy_apply_flow(browser, page, qa_bank, resume_pdf_path, dry_run)

    if account_gated:
        return ApplyResult(
            status="needs_manual",
            detail=f"Destination at {redirect_url} requires candidate sign-in/account creation -- not automated, apply manually.",
        )
    return _handle_redirect(redirect_url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)


def _already_applied_detail(page: Page) -> str | None:
    """Detects LinkedIn's own "Application status: Application submitted"
    panel, which replaces the Apply/Easy Apply button entirely once a
    posting has already been applied to. Confirmed live: a real retry
    against a posting we'd already submitted to (in a prior run that failed
    to record success -- see this function's reason for existing) showed no
    Easy Apply button and no Apply button at all, and without this check
    that silence was mis-reported as "No Easy Apply button and no external
    redirect could be determined", masking a genuine prior success as a
    failure. Checked before any button-presence logic runs.
    """
    try:
        text = page.locator("body").inner_text(timeout=2_000)
    except Exception:
        return None
    if "Application submitted" not in text:
        return None
    idx = text.find("Application status")
    snippet = re.sub(r"\s+", " ", text[idx : idx + 120]).strip() if idx != -1 else "Application submitted"
    return f"Already applied -- LinkedIn shows a prior submission ({snippet})."


def _visible_role(page: Page, role: str, name: str):
    """Role-based locator scoped to visible elements only. LinkedIn renders
    duplicate hidden copies of interactive elements (confirmed live twice
    now: the login form's username/password fields, and this Easy Apply
    flow's Next button) -- `.first` on an unscoped role locator can silently
    grab the invisible duplicate, which doesn't respond to clicks the same
    way a real user's click would.
    """
    return page.get_by_role(role, name=name, exact=False).and_(page.locator("*:visible"))


def _modal_text(page: Page) -> str:
    """Full-page text, not scoped to a specific modal container. Confirmed
    live this matters: `[role='dialog']` doesn't match LinkedIn's actual Easy
    Apply modal markup, so a scoped lookup silently returned "" on every
    call -- comparing "" == "" always looked like "no change" and falsely
    reported a stall after the very first click, regardless of whether the
    form had actually advanced. Whole-page text is slightly coarser but
    doesn't depend on guessing the modal's exact ARIA structure.
    """
    try:
        return page.locator("body").inner_text(timeout=2_000)
    except Exception:
        return ""


def _save_easy_apply_screenshot(page: Page, label: str):
    path = SESSION_DIR / f"easy_apply_{label}.png"
    try:
        page.screenshot(path=str(path))
    except Exception:
        pass
    return path


def _run_easy_apply_flow(
    browser, page: Page, qa_bank: list[models.QABankEntry], resume_pdf_path: str, dry_run: bool
) -> ApplyResult:
    """Runs the Easy Apply modal's multi-step flow to completion. Always
    closes `browser` before returning -- callers must not close it again.
    """
    easy_apply_button = _visible_role(page, "button", "Easy Apply")
    try:
        easy_apply_button.first.click()
    except PlaywrightTimeoutError:
        browser.close()
        return ApplyResult(status="failed", detail="Could not click the Easy Apply button.")

    for step in range(MAX_FORM_STEPS):
        # Confirmed live: the Easy Apply modal can still be showing a bare
        # loading spinner (no content at all) when this check runs -- a
        # fixed short wait isn't reliably long enough for the step's content
        # to actually render, the same class of SPA-timing issue already
        # fixed for the login page and the job page's own button detection.
        try:
            page.wait_for_load_state("networkidle", timeout=6_000)
        except PlaywrightTimeoutError:
            pass  # best-effort settle; fall through and check whatever rendered
        submit_button = _visible_role(page, "button", "Submit application")
        if submit_button.count() > 0:
            if dry_run:
                browser.close()
                return ApplyResult(
                    status="dry_run_ready", detail="Reached final submit step -- stopped short per dry-run mode."
                )
            submit_button.first.click()
            browser.close()
            return ApplyResult(status="applied", detail="Submitted via LinkedIn Easy Apply.")

        _fill_visible_fields(page, qa_bank, resume_pdf_path)

        next_button = _visible_role(page, "button", "Next")
        review_button = _visible_role(page, "button", "Review")
        advance = next_button if next_button.count() > 0 else review_button
        if advance.count() == 0:
            screenshot_path = _save_easy_apply_screenshot(page, "no_advance_button")
            browser.close()
            return ApplyResult(
                status="needs_manual",
                detail=(
                    "Easy Apply form reached an unrecognized state -- no Next/Review/Submit button found "
                    f"(screenshot: {screenshot_path})."
                ),
            )

        # Detect a stalled step (LinkedIn's own validation silently blocking
        # advance because a required field wasn't filled) instead of blindly
        # exhausting every remaining iteration on a form that was never going
        # to progress -- confirmed live: a real posting hit the step limit
        # with no visible evidence of what actually happened at each step.
        modal_text_before = _modal_text(page)
        advance.first.click()
        page.wait_for_timeout(500)
        if _modal_text(page) == modal_text_before:
            screenshot_path = _save_easy_apply_screenshot(page, "stuck_step")
            browser.close()
            # inner_text() returns the full DOM text regardless of scroll
            # position, unlike the screenshot -- included directly so a stall
            # is diagnosable from the API response alone, without needing to
            # separately open and scroll through the screenshot.
            modal_excerpt = re.sub(r"\s+", " ", modal_text_before).strip()[:600]
            return ApplyResult(
                status="needs_manual",
                detail=(
                    f"Easy Apply form did not advance after step {step + 1} -- likely an unanswered required "
                    f"question of an unhandled type (screenshot: {screenshot_path}). Modal content: {modal_excerpt}"
                ),
            )

    screenshot_path = _save_easy_apply_screenshot(page, "step_limit")
    browser.close()
    return ApplyResult(
        status="needs_manual",
        detail=f"Easy Apply form exceeded the step limit -- likely an unhandled question type (screenshot: {screenshot_path}).",
    )


MAX_REDIRECT_HOPS = 3  # branded wrapper landing pages in front of the real ATS are common


def _looks_like_account_gate(page: Page) -> bool:
    """Detects a candidate-account sign-in/creation wall -- confirmed live
    against a real posting (Murata's careers portal shows "Career
    Opportunities: Sign In" / "Create an account to apply" before any
    application can start). No connector attempts this: creating an account
    on an arbitrary employer's site on the candidate's behalf is a
    materially bigger action than filling out a stateless form, and isn't
    something this automates -- it's a legitimate needs_manual case, not a
    bug to route around.
    """
    try:
        has_password_field = page.locator("input[type='password']").count() > 0
        text = page.locator("body").inner_text(timeout=2_000).lower()
    except Exception:
        return False
    signals = ["sign in", "create an account", "create account", "already have an account", "register"]
    return has_password_field and any(signal in text for signal in signals)


def _discover_redirect_url(context: BrowserContext, page: Page) -> tuple[str | None, bool]:
    """Clicks the posting's real Apply button (now that we're logged in) and
    follows it through successive "Apply" hops. Confirmed live: some
    employers front their real ATS with a branded wrapper/landing page (a
    Jibe-style career site sitting in front of an iCIMS instance, in the case
    that surfaced this) that itself needs another Apply click to reach the
    real application form -- a single-hop check landed on the wrapper page
    and mis-reported "no automated connector" when the real destination was
    actually a supported platform one click further in.

    Stops once a recognized ATS domain is reached, no further Apply control
    is found, a click produces no progress, or the hop limit is hit. Returns
    (None, False) if nothing observable happens on the very first hop.
    Returns (url, True) if the final destination looks like an account
    sign-in/creation wall.

    Root-caused live against a real posting (Murata) that this used to
    mis-report as having no redirect at all: clicking "Apply" often reveals
    LinkedIn's own "Job search safety reminder" interstitial in the SAME
    page (not a new tab) -- the real external destination only opens (in a
    new tab) after clicking that interstitial's "Continue applying" control,
    which is a `<a target="_blank">` link, not a button. Without accounting
    for this extra step, the initial click produces no observable new tab
    and no same-page navigation, so `next_page.url` stayed equal to the
    still-on-LinkedIn current page and got misread as "bounced back to
    LinkedIn" / no progress on the very first hop.
    """
    current_page = page
    last_url: str | None = None

    for _ in range(MAX_REDIRECT_HOPS):
        target = _visible_role(current_page, "button", "Apply")
        if target.count() == 0:
            target = _visible_role(current_page, "link", "Apply")
        if target.count() == 0:
            break

        # Try the direct case first (the click itself opens a new tab) with
        # a short timeout -- if that's what's going to happen, it happens
        # almost immediately, so a short budget here leaves the bulk of the
        # time for the interstitial-handling fallback below.
        opened_page = None
        try:
            with context.expect_page(timeout=4_000) as new_page_info:
                target.first.click()
            opened_page = new_page_info.value
        except PlaywrightTimeoutError:
            pass

        if opened_page is None:
            continue_link = _visible_role(current_page, "link", "Continue applying")
            if continue_link.count() > 0:
                try:
                    with context.expect_page(timeout=8_000) as new_page_info:
                        continue_link.first.click()
                    opened_page = new_page_info.value
                except PlaywrightTimeoutError:
                    pass

        next_page = current_page
        if opened_page is not None:
            next_page = opened_page
            try:
                next_page.wait_for_load_state("domcontentloaded", timeout=8_000)
            except PlaywrightTimeoutError:
                pass
        else:
            try:
                current_page.wait_for_load_state("domcontentloaded", timeout=3_000)
            except PlaywrightTimeoutError:
                pass  # navigated in place rather than opening a new tab, or nothing happened

        # "linkedin.com" broadly, not just "/jobs/view/" -- confirmed live a
        # closed/expired posting's Apply click bounced to
        # linkedin.com/jobs/search-results/ (a similar-jobs page), which the
        # narrower check missed and then mis-reported as "redirects
        # externally to <a LinkedIn search page>", implying a real employer
        # destination that never existed.
        # chrome-error:// means the navigation itself failed (DNS/connection
        # error, page crash) -- confirmed live this got recorded as a "real"
        # destination and then mis-reported as "no automated connector for
        # that platform", falsely implying an actual unsupported site was
        # reached rather than a failed navigation to nowhere.
        if next_page.url == last_url or "linkedin.com" in next_page.url or next_page.url.startswith("chrome-error://"):
            break  # no progress, bounced back to LinkedIn, or navigation failed

        last_url = next_page.url
        current_page = next_page

        if detect_platform_from_url(last_url, default="other") != "other":
            break  # reached a recognized ATS -- no need to keep clicking

    return last_url, _looks_like_account_gate(current_page)


def _handle_redirect(
    redirect_url: str | None,
    resume_pdf_path: str,
    cover_letter_pdf_path: str,
    profile: models.CandidateProfile,
    qa_bank: list[models.QABankEntry],
    dry_run: bool,
) -> ApplyResult:
    if not redirect_url:
        return ApplyResult(
            status="needs_manual",
            detail="No Easy Apply button and no external redirect could be determined -- apply manually.",
        )
    platform = detect_platform_from_url(redirect_url, default="other")
    connector = REDIRECT_CONNECTORS.get(platform)
    if connector is None:
        return ApplyResult(
            status="needs_manual",
            detail=f"Posting redirects externally to {redirect_url} -- no automated connector for that platform.",
        )
    return connector.apply(redirect_url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)


def _fill_visible_fields(page: Page, qa_bank: list[models.QABankEntry], resume_pdf_path: str) -> None:
    """Handles the three question shapes LinkedIn's Easy Apply screening
    step commonly uses: free-text/number inputs, dropdowns (e.g. "years of
    experience" ranges), and radio-button groups (e.g. work
    authorization/sponsorship yes-no questions). The original version only
    handled free-text inputs -- radio groups and dropdowns were silently
    left blank on every real screening form, which is most of what "the
    questions after Easy Apply" actually means in practice.

    The actual field-matching logic lives in form_filling.py, shared with
    Workday's "Application Questions" step -- see that module's docstring.
    """
    file_inputs = page.locator("input[type=file]")
    for i in range(file_inputs.count()):
        try:
            file_inputs.nth(i).set_input_files(resume_pdf_path)
        except Exception:
            pass  # not every file input on the page is necessarily the resume slot

    form_filling.fill_screening_questions(page, qa_bank)
