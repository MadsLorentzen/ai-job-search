"""Greenhouse job-board application connector.

Root-caused live against a real posting (Stripe, "Lifecycle Marketing
Manager, Capital") that was silently failing with "no recognized fields"
despite the field selectors themselves being correct:

1. Like Workday and Ashby, the URL discovered from a LinkedIn redirect can
   be a branded *listing* page (`stripe.com/careers/listing/...`), not the
   application form -- confirmed live: it never has any form fields at
   all. The connector must follow the page's own "Apply"/"Apply now"
   control to reach `/careers/apply/...` first.
2. Even on the apply page, the actual Greenhouse form is not in the main
   document -- it's rendered in a genuine iframe
   (`job-boards.greenhouse.io/embed/job_app?...`), confirmed live via the
   page's frame list. `page.locator(...)` only searches the main frame, so
   every field lookup silently found nothing regardless of selector
   correctness. This connector now locates that frame and scopes every
   field operation to it -- falling back to operating on the page directly
   when no such iframe exists (the case for a posting whose discovered URL
   is already a bare `job-boards.greenhouse.io/...` embed with no wrapper).
   Playwright's `Frame` object exposes the same `.locator()`/`.get_by_role()`
   interface `form_filling.py`'s shared helpers already use, so screening
   questions get the same treatment there without any separate iframe-aware
   copy of that logic.
3. The `#first_name`/`#last_name`/`#email`/`#phone`/`#resume` id-based
   selectors this connector already used turned out to be correct for the
   modern embed once actually reachable -- the bug was never the
   selectors, only not finding the frame they live in.

Not yet handled, flagged rather than guessed at: this posting's EEO
section (gender/ethnicity/veteran/disability) renders as free-text inputs
paired with a custom dropdown widget this connector doesn't drive, and the
embed loads an invisible reCAPTCHA -- both are real gaps for a future pass,
not covered by this fix.
"""

from __future__ import annotations

from playwright.sync_api import Frame, Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright
from sqlalchemy.orm import object_session

from app import models
from app.services.automation import form_filling
from app.services.automation.base import ApplyResult

FIELD_SELECTORS = {
    "first_name": "#first_name",
    "last_name": "#last_name",
    "email": "#email",
    "phone": "#phone",
}


def _settle(page: Page, timeout_ms: int = 8_000) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except PlaywrightTimeoutError:
        pass
    page.wait_for_timeout(1_500)


def _find_greenhouse_frame(page: Page) -> Frame | Page:
    """Returns the embedded Greenhouse iframe's Frame if the form is
    embedded (see module docstring point 2), else `page` itself for a
    posting whose form lives directly in the main document.
    """
    for frame in page.frames:
        if "greenhouse.io" in frame.url and "embed/job_app" in frame.url:
            return frame
    return page


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

        if _find_greenhouse_frame(page) is page:
            apply_link = page.get_by_role("link", name="Apply", exact=False)
            if apply_link.count() == 0:
                apply_link = page.get_by_role("button", name="Apply", exact=False)
            if apply_link.count() > 0:
                apply_link.first.click()
                _settle(page)

        target = _find_greenhouse_frame(page)
        # The iframe itself can take a beat longer to finish rendering its
        # own form content after the outer page settles.
        if target is not page:
            try:
                target.wait_for_load_state("networkidle", timeout=8_000)
            except PlaywrightTimeoutError:
                pass
            page.wait_for_timeout(1_500)

        name_parts = profile.name.split(" ", 1)
        first_name, last_name = name_parts[0], name_parts[1] if len(name_parts) > 1 else ""
        field_values = {
            "first_name": first_name,
            "last_name": last_name,
            "email": profile.email,
            "phone": profile.phone,
        }
        filled_any = False
        for field, selector in FIELD_SELECTORS.items():
            locator = target.locator(selector)
            if locator.count() > 0:
                locator.first.fill(field_values[field])
                filled_any = True

        if not filled_any:
            browser.close()
            return ApplyResult(
                status="needs_manual", detail="No recognized Greenhouse fields found -- this board may use a custom template."
            )

        resume_input = target.locator("#resume, input[name='resume']")
        if resume_input.count() > 0:
            resume_input.first.set_input_files(resume_pdf_path)
        cover_letter_input = target.locator("#cover_letter, input[name='cover_letter']")
        if cover_letter_input.count() > 0:
            cover_letter_input.first.set_input_files(cover_letter_pdf_path)
        page.wait_for_timeout(1_000)

        # Education is a react-select "type to search, or add a free-text
        # entry" field, not a small fixed list -- sourced from the same
        # EducationEntry records the resume/cover-letter tailoring already
        # uses, most-recent first, rather than fabricated or left blank.
        session = object_session(profile)
        if session is not None:
            education = (
                session.query(models.EducationEntry).order_by(models.EducationEntry.sort_order.asc()).first()
            )
            if education is not None:
                school_input = target.locator("input#school--0")
                if school_input.count() > 0:
                    try:
                        school_input.first.click()
                        school_input.first.type(education.institution, delay=40)
                        page.wait_for_timeout(600)
                        options = target.get_by_role("option")
                        if options.count() > 0:
                            options.first.click()
                        else:
                            school_input.first.press("Tab")
                    except Exception:
                        pass
                # Unlike School (a searchable database of real institutions,
                # where typing the institution name works), Degree is a
                # small fixed list of ~10 standard options -- confirmed
                # live typing the profile's actual degree text ("MBA,
                # Business (AI concentration)") or even a shortened "MBA"
                # matched zero of Greenhouse's own type-ahead results,
                # since the real option is literally punctuated
                # "Master of Business Administration (M.B.A.)". Opening the
                # list with no typed filter and fuzzy-matching against the
                # full option set (the same approach Workday's State field
                # uses) sidesteps needing to guess Greenhouse's exact
                # wording.
                degree_input = target.locator("input#degree--0")
                if degree_input.count() > 0:
                    form_filling._select_combobox_option(
                        target, degree_input.first, lambda texts: form_filling._best_matching_option(texts, education.degree)
                    )

        empty_required: list[str] = []
        for _ in range(3):
            form_filling.fill_screening_questions(target, qa_bank)
            form_filling.fill_react_select_comboboxes(target, qa_bank)
            page.wait_for_timeout(500)
            empty_required = target.locator(
                "input[required]:visible, textarea[required]:visible, select[required]:visible"
            ).evaluate_all(
                "els => els.filter(e => !e.value).map(e => e.name || e.id || e.placeholder || '(unnamed)')"
            )
            if not empty_required:
                break

        if empty_required:
            browser.close()
            return ApplyResult(
                status="needs_manual",
                detail=f"Required Greenhouse fields still empty before submit: {', '.join(empty_required)}.",
            )

        submit_button = target.get_by_role("button", name="Submit Application", exact=False)
        if submit_button.count() == 0:
            browser.close()
            return ApplyResult(status="needs_manual", detail="No submit button found on the Greenhouse form.")

        if dry_run:
            browser.close()
            return ApplyResult(
                status="dry_run_ready",
                detail=f"Greenhouse form filled at {url} -- stopped short of submit per dry-run mode.",
            )

        submit_button.first.click()
        browser.close()
        return ApplyResult(status="applied", detail=f"Submitted via Greenhouse at {url}.")
