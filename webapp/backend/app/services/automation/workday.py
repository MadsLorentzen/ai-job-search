"""Workday application connector -- best-effort, per the plan's disclosed
limitation #3: Workday is a heavy single-page-app that frequently forces
account creation before an application can even start, sometimes behind
MFA. This connector only handles the common case of a simple public
application form; anything more (account creation, an "Apply with
LinkedIn" button, a step this connector doesn't recognize) correctly falls
through to needs_manual rather than guessing.

Root-caused live against real postings (Autodesk, Tricentis, Manhattan
Associates) that were all silently failing with the same generic "no
recognized fields" message despite being different real situations:

1. The job URL Workday exposes is a listing/description page, not the
   application form -- the form only appears after clicking "Apply" and
   then choosing "Apply Manually" from the resulting menu (the other
   option, "Autofill with Resume", isn't handled here).
2. Like every other JS-heavy SPA connector in this project, it needs a
   settle wait beyond `domcontentloaded`.
3. The account-gate check ("Sign In" text present) used to run on the raw
   listing page, where "Sign In" always appears in Workday's persistent top
   nav regardless of whether the board actually requires an account --
   checked here instead against the actual step-1 heading of the apply
   wizard ("Create Account/Sign In"), the real board-specific signal.
4. The field selectors were pure guesses that matched none of Workday's
   real `data-automation-id` values, which follow the pattern
   `formField-<name>` on a wrapper *div*, with the actual `<input>` nested
   inside it -- not on the input itself.
5. Filling a text field's DOM value isn't enough -- Workday's client-side
   validation only registers a value once the field blurs (confirmed live:
   every field showed as "required" after clicking Next despite
   `input_value()` correctly showing the filled text, until a Tab press
   was added after each fill -- see form_filling.py).
6. State, "How Did You Hear About Us?", and similar fields aren't native
   `<select>` elements -- they're `<button aria-haspopup="listbox">`
   comboboxes that reveal a `role="option"` list on click (see
   form_filling.fill_comboboxes).
7. A full application is a 6-7 step wizard (My Information -> My
   Experience -> Application Questions -> Voluntary Disclosures -> Self
   Identify -> Review), not the single-step form this connector originally
   assumed -- handled here as a generic step loop, dispatching to
   step-specific fillers by the step's own heading text.
"""

from __future__ import annotations

import re

from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright
from sqlalchemy.orm import object_session

from app import models
from app.services.automation import form_filling
from app.services.automation.base import ApplyResult, SESSION_DIR

MAX_WIZARD_STEPS = 8  # real boards seen so far top out at 7; a small buffer above that

# Wrapper div automation-ids for My Information's plain text fields --
# `[data-automation-id='<value>'] input` is the real, fillable element (see
# module docstring point 4). Address/city/postal code are populated from
# the QA bank (see qa_matching.py), same as any other static personal-data
# question, rather than a new CandidateProfile column -- this project has
# no structured address field, and the QA bank is already the place for
# "questions with one fixed, factual answer".
NAME_CONTACT_AUTOMATION_IDS = {
    "first_name": "formField-legalName--firstName",
    "last_name": "formField-legalName--lastName",
    "email": "formField-emailAddress",
    "phone": "formField-phoneNumber",
}


def _settle(page: Page, timeout_ms: int = 10_000) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except PlaywrightTimeoutError:
        pass  # best-effort -- Workday's own persistent connections often never go idle
    page.wait_for_timeout(2_000)


def _dismiss_cookie_banner(page: Page) -> None:
    """Confirmed live this appears at inconsistent points across otherwise
    identical runs against the same posting (sometimes on the initial job
    listing, sometimes only after reaching "Apply Manually", sometimes not
    at all) -- called at every stage rather than once, since an overlay
    banner can intercept clicks on whatever's underneath it.
    """
    decline = page.get_by_role("button", name="Decline", exact=False)
    if decline.count() > 0:
        try:
            decline.first.click(timeout=2_000)
            page.wait_for_timeout(500)
        except Exception:
            pass


def _save_screenshot(page: Page, label: str):
    path = SESSION_DIR / f"workday_{label}.png"
    try:
        page.screenshot(path=str(path))
    except Exception:
        pass
    return path


def _current_step_label(page: Page) -> str:
    """The wizard's progress bar marks the active step with this
    automation-id -- reading its text (e.g. "My Information") is how each
    loop iteration decides which step-specific filler to run.
    """
    try:
        active = page.locator("[data-automation-id='progressBarActiveStep']")
        if active.count() > 0:
            return active.first.inner_text()
    except Exception:
        pass
    return ""


def _fill_my_information(page: Page, profile: models.CandidateProfile, qa_bank: list[models.QABankEntry]) -> ApplyResult | None:
    """Fills step 1. Returns an ApplyResult to short-circuit `apply()` on a
    hard stop (account gate, no recognizable fields); returns None to let
    the caller proceed to the step-advance loop.
    """
    if page.get_by_text("Create Account/Sign In", exact=False).count() > 0:
        return ApplyResult(
            status="needs_manual",
            detail="Workday requires account creation/sign-in before applying -- not automated.",
        )

    name_parts = profile.name.split(" ", 1)
    first_name, last_name = name_parts[0], name_parts[1] if len(name_parts) > 1 else ""
    # Workday's phone field wants plain local digits -- country code is a
    # separate dropdown field (formField-countryPhoneCode) that already
    # defaults correctly alongside Country. Confirmed live: the profile's
    # formatted "+1 (470) 257-0870" failed Workday's own format validation
    # ("Enter a valid format for Phone Number") until stripped to digits.
    phone_digits = re.sub(r"\D", "", profile.phone)
    if phone_digits.startswith("1") and len(phone_digits) == 11:
        phone_digits = phone_digits[1:]  # drop a leading US country-code digit, kept in the separate field
    field_values = {"first_name": first_name, "last_name": last_name, "email": profile.email, "phone": phone_digits}
    filled_any = False
    for field, automation_id in NAME_CONTACT_AUTOMATION_IDS.items():
        locator = page.locator(f"[data-automation-id='{automation_id}'] input")
        if locator.count() > 0:
            locator.first.click()
            locator.first.fill(field_values[field])
            page.keyboard.press("Tab")  # Workday validation needs the blur -- see module docstring point 5
            filled_any = True

    # Address/source/prior-employment fields vary in whether a given board
    # asks for them at all -- fill_text_fields/fill_comboboxes/
    # fill_radio_groups each no-op on anything not present, so this is safe
    # to run unconditionally rather than needing per-board branching.
    form_filling.fill_text_fields(page, qa_bank)
    form_filling.fill_comboboxes(page, qa_bank)
    form_filling.fill_radio_groups(page, qa_bank)

    if not filled_any:
        return ApplyResult(
            status="needs_manual",
            detail="No recognized Workday fields found -- this board's template isn't handled.",
        )
    return None


def _fill_experience_step(page: Page, profile: models.CandidateProfile, resume_pdf_path: str) -> None:
    """Populates the most recent role from the candidate's existing
    ExperienceEntry records (the same structured data the resume/cover
    letter tailoring already uses) rather than inventing anything. Also
    attaches the resume file if this step exposes its own uploader
    (several Workday boards ask for it again here, separate from the
    initial "Autofill with Resume" option that was intentionally skipped).
    Only the single most recent position is filled -- most boards accept a
    partial work-history entry alongside the attached resume for full
    detail, and this connector doesn't yet drive the "Add Another Position"
    flow for multiple structured entries.
    """
    # Not scoped to :visible -- upload widgets commonly hide the raw
    # <input type=file> behind a styled "Select files" button/dropzone,
    # same as every other connector's resume-upload handling in this repo.
    # Acts directly rather than gating on `.count() > 0` first -- confirmed
    # live this step's file input renders slightly after the step becomes
    # active, and `.count()` is a non-waiting snapshot (unlike `.fill()`/
    # `.set_input_files()`, which auto-wait/retry), so the guard was
    # silently skipping a real, about-to-exist element.
    try:
        page.locator("input[type='file']").first.set_input_files(resume_pdf_path)
        # Confirmed live: the upload finishes ("Successfully Uploaded!")
        # well before Workday's Next button re-enables -- it stays disabled
        # during some further async processing (resume parsing) with no
        # other visible signal, so this waits on the button's own state
        # rather than a fixed delay that risks being too short.
        page.wait_for_timeout(2_000)
        next_button = page.locator("[data-automation-id='pageFooterNextButton']")
        if next_button.count() > 0:
            try:
                next_button.first.wait_for(state="attached", timeout=1_000)
                for _ in range(15):  # up to ~15s
                    if next_button.first.is_enabled():
                        break
                    page.wait_for_timeout(1_000)
            except PlaywrightTimeoutError:
                pass
    except Exception:
        pass

    session = object_session(profile)
    if session is None:
        return
    experience = (
        session.query(models.ExperienceEntry).order_by(models.ExperienceEntry.sort_order.asc()).first()
    )
    if experience is None:
        return

    field_values = {
        "title": experience.title,
        "company": experience.company,
    }
    for automation_id_fragment, value in field_values.items():
        locator = page.locator(f"[data-automation-id*='{automation_id_fragment}'] input:visible")
        if locator.count() > 0:
            try:
                locator.first.click()
                locator.first.fill(value)
                page.keyboard.press("Tab")
            except Exception:
                pass


def _advance_step(page: Page) -> bool:
    """Clicks the wizard's Next/Continue button and reports whether the
    step actually changed -- Workday blocks advancing (client-side) on
    unfilled required fields rather than navigating anywhere, so comparing
    the active-step label before/after is how a stall is told apart from
    real progress (same reasoning as linkedin.py's Easy Apply stall check).
    """
    next_button = page.locator("[data-automation-id='pageFooterNextButton']")
    if next_button.count() == 0:
        next_button = page.get_by_role("button", name="Next", exact=False)
    if next_button.count() == 0:
        return False
    step_before = _current_step_label(page)
    # Workday's client-side validation appears to be debounced -- confirmed
    # live a click can register as a no-op immediately after the last field
    # edit, then succeed on an identical retry a moment later with no
    # visible difference in the form's state either time. One retry (not
    # unbounded) absorbs that without masking a genuine stall.
    for attempt in range(2):
        page.wait_for_timeout(800)
        try:
            next_button.first.click()
        except Exception:
            return False
        page.wait_for_timeout(1_500)
        try:
            page.wait_for_load_state("networkidle", timeout=5_000)
        except PlaywrightTimeoutError:
            pass
        step_after = _current_step_label(page)
        if step_after != step_before or step_after == "":  # "" covers landing on the final Review step
            return True
    return False


def apply(
    url: str,
    resume_pdf_path: str,
    cover_letter_pdf_path: str,
    profile: models.CandidateProfile,
    qa_bank: list[models.QABankEntry],
    dry_run: bool,
) -> ApplyResult:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(url, wait_until="domcontentloaded")
        _settle(page)
        _dismiss_cookie_banner(page)

        apply_button = page.get_by_role("button", name="Apply", exact=True)
        if apply_button.count() == 0:
            browser.close()
            return ApplyResult(status="needs_manual", detail="No Apply button found on the Workday job posting.")
        apply_button.first.click()
        page.wait_for_timeout(1_500)

        manual_option = page.get_by_text("Apply Manually", exact=False)
        if manual_option.count() == 0:
            browser.close()
            return ApplyResult(
                status="needs_manual",
                detail="No 'Apply Manually' option found after clicking Apply -- this board may need a different flow.",
            )
        manual_option.first.click()
        _settle(page, timeout_ms=8_000)
        _dismiss_cookie_banner(page)

        result = _fill_my_information(page, profile, qa_bank)
        if result is not None:
            browser.close()
            return result

        for _ in range(MAX_WIZARD_STEPS):
            _dismiss_cookie_banner(page)
            advanced = _advance_step(page)
            if not advanced:
                screenshot_path = _save_screenshot(page, "stuck_step")
                remaining_errors = page.get_by_text("is required and must have a value", exact=False)
                error_summary = ""
                if remaining_errors.count() > 0:
                    try:
                        error_summary = " First unresolved field: " + remaining_errors.first.inner_text()
                    except Exception:
                        pass
                browser.close()
                return ApplyResult(
                    status="needs_manual",
                    detail=(
                        f"Workday step did not advance -- likely unfilled required fields this connector doesn't "
                        f"recognize (screenshot: {screenshot_path}).{error_summary}"
                    ),
                )

            step_label = _current_step_label(page)
            # The progress-bar label updates before a step's own field
            # content finishes rendering -- confirmed live the Application
            # Questions step showed a bare "Application Questions" heading
            # with no visible question text for several seconds after the
            # step became active, during which this connector's own field
            # fillers found nothing to fill and silently no-op'd.
            _settle(page, timeout_ms=4_000)

            if "Experience" in step_label:
                _fill_experience_step(page, profile, resume_pdf_path)
            elif "Application Question" in step_label:
                form_filling.fill_screening_questions(page, qa_bank)
                form_filling.fill_comboboxes(page, qa_bank)
            elif "Voluntary Disclosure" in step_label or "Self Identify" in step_label:
                form_filling.decline_voluntary_disclosures(page)
                form_filling.check_acknowledgment_boxes(page)
            elif "Review" in step_label or step_label == "":
                submit_button = page.get_by_role("button", name="Submit", exact=False)
                if submit_button.count() == 0:
                    screenshot_path = _save_screenshot(page, "no_submit_at_review")
                    browser.close()
                    return ApplyResult(
                        status="needs_manual",
                        detail=f"Reached Workday's final step but found no Submit button (screenshot: {screenshot_path}).",
                    )
                if dry_run:
                    browser.close()
                    return ApplyResult(
                        status="dry_run_ready",
                        detail=f"Workday application reached the Review step at {url} -- stopped short of submit per dry-run mode.",
                    )
                submit_button.first.click()
                page.wait_for_timeout(2_000)
                browser.close()
                return ApplyResult(status="applied", detail=f"Submitted via Workday at {url}.")

        screenshot_path = _save_screenshot(page, "step_limit")
        browser.close()
        return ApplyResult(
            status="needs_manual",
            detail=f"Workday wizard exceeded the step limit without reaching Review (screenshot: {screenshot_path}).",
        )
