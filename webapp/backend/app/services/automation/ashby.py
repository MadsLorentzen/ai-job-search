"""AshbyHQ application connector.

Verified live against a real posting (Directive, "Senior Revenue Operations
Manager"): the job-listing page's "Apply for this Job" control navigates to
a `/application` URL where the actual form lives -- the connector must
click through, not assume the given URL is the form itself (same class of
gap as Workday before it). Ashby's standard fields use stable
`_systemfield_*` identifiers (`_systemfield_name` and `_systemfield_email`
as `name` attributes; `_systemfield_resume` as an `id` instead -- that
field has no `name` at all, and a second, unrelated file input exists
higher on the page for a separate "autofill from resume" shortcut, so
matching the wrong one silently uploads to nothing). Phone has no stable
name or id, matched by `type=tel` instead. Everything past that (screening
questions, EEO section) is employer-defined and handled by the same shared
form_filling.py logic Workday and LinkedIn use, not custom per-board code.

Some Ashby boards embed a reCAPTCHA on the application form (confirmed
live: a `g-recaptcha-response` field is present even before any challenge
is shown). An invisible/v2-checkbox reCAPTCHA can pass silently for a
normal browsing session, but this is not guaranteed -- if the submit click
doesn't produce a real success signal, this reports needs_manual rather
than assuming success, per this project's "never claim applied without
positive confirmation" standard (see the `_looks_submitted` check below).
"""

from __future__ import annotations

from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app import models
from app.services.automation import form_filling
from app.services.automation.base import ApplyResult

SYSTEM_FIELD_SELECTORS = {
    "name": "input[name='_systemfield_name']",
    "email": "input[name='_systemfield_email']",
}


def _settle(page: Page, timeout_ms: int = 8_000) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except PlaywrightTimeoutError:
        pass
    page.wait_for_timeout(1_500)


def _fill_and_verify(locator, value: str, attempts: int = 3) -> bool:
    """Fills a field and confirms the value actually stuck before moving on
    -- confirmed live this matters: a field can be found (`.count() > 0`)
    and `.fill()` can return without error, yet the value doesn't persist
    on a re-check moments later, the same class of timing race seen
    elsewhere in this project's connectors. Silently trusting one fill
    attempt let a required Email field reach Review empty on a real run.
    """
    for _ in range(attempts):
        try:
            locator.first.click()
            locator.first.fill(value)
            if locator.first.input_value() == value:
                return True
        except Exception:
            pass
    return False


def _looks_submitted(page: Page) -> bool:
    """Ashby replaces the form with a confirmation message on success
    (confirmed live: the applicant name field's wrapper disappears from the
    DOM entirely) -- checked instead of trusting the submit click alone,
    since a reCAPTCHA challenge or validation error can leave the form
    visibly unchanged after a click that looked like it worked.
    """
    try:
        return page.locator("input[name='_systemfield_name']").count() == 0
    except Exception:
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

        if page.locator(SYSTEM_FIELD_SELECTORS["name"]).count() == 0:
            apply_button = page.get_by_role("button", name="Apply for this Job", exact=False)
            if apply_button.count() > 0:
                apply_button.first.click()
                _settle(page)

        name_field = page.locator(SYSTEM_FIELD_SELECTORS["name"])
        if name_field.count() == 0:
            browser.close()
            return ApplyResult(
                status="needs_manual", detail="No recognized Ashby fields found -- this board's template isn't handled."
            )

        _fill_and_verify(name_field, profile.name)
        page.keyboard.press("Tab")

        email_field = page.locator(SYSTEM_FIELD_SELECTORS["email"])
        if email_field.count() > 0:
            _fill_and_verify(email_field, profile.email)
            page.keyboard.press("Tab")

        # Confirmed live: some Ashby boards render the phone field as a
        # plain `input[type='text']#phone_number` instead of `type='tel'`
        # (Too Good To Go's board) -- checking both, `type='tel'` first
        # since that's the more common pattern already validated live.
        phone_field = page.locator("input[type='tel']")
        if phone_field.count() == 0:
            phone_field = page.locator("input#phone_number, input[name='phone_number']")
        if phone_field.count() > 0:
            _fill_and_verify(phone_field, profile.phone)
            page.keyboard.press("Tab")

        # LinkedIn is real profile data (like name/email/phone), not a
        # screening question -- filled directly rather than depending on a
        # QA-bank entry that would need duplicating per field label variant.
        # `:has-text`, not `:text-is` -- confirmed live a real board (Too
        # Good To Go) labels this field "LinkedIn Profile", not the bare
        # "LinkedIn" an exact-text match required, which silently skipped a
        # field this connector already knew how to fill correctly.
        linkedin_field = page.locator("label.ashby-application-form-question-title:has-text('LinkedIn')").locator(
            "xpath=following-sibling::div//input"
        )
        if linkedin_field.count() > 0 and profile.linkedin_url:
            _fill_and_verify(linkedin_field, profile.linkedin_url)
            page.keyboard.press("Tab")

        # Location is a search-and-select autocomplete, not a plain text
        # field -- confirmed live (Directive's board) typing a query reveals
        # `role=option` suggestions that must be clicked, a plain .fill()
        # leaves it unselected and blocks submission. Sourced from the same
        # city/state QA-bank entries Workday's address fields use, since
        # this project has no structured address field on CandidateProfile.
        location_field = page.locator("input[placeholder='Start typing...']")
        if location_field.count() > 0:
            from app.services.automation.qa_matching import answer_for_question

            city = answer_for_question("city", qa_bank)
            state = answer_for_question("state", qa_bank)
            if city and state:
                try:
                    location_field.first.click()
                    location_field.first.type(f"{city}, {state}", delay=60)
                    page.wait_for_timeout(1_000)
                    options = page.get_by_role("option")
                    match = next(
                        (options.nth(j) for j in range(options.count()) if state in options.nth(j).inner_text()),
                        options.first if options.count() > 0 else None,
                    )
                    if match is not None:
                        match.click()
                except Exception:
                    pass

        # The screening-question fill pass proved racy across whole-page
        # re-renders (confirmed live: different required fields, including
        # the resume upload, came up empty on different runs of otherwise
        # identical code) -- retried as a whole, not just per-field, since
        # a second full pass has reliably closed these gaps everywhere else
        # in this project (Workday's combobox selection, its step-advance
        # click). Each retry re-attempts only what's still missing.
        empty_required: list[str] = []
        for _ in range(3):
            # Matched by id, not name -- confirmed live this field has
            # `id="_systemfield_resume"` but no `name` attribute at all,
            # unlike name/email which use `_systemfield_*` as the name. A
            # second, unrelated file input ("Autofill from resume" at the
            # top of the page) also exists, and the old name-based selector
            # matched neither, silently falling through to a generic
            # `input[type=file]` that grabbed that wrong one instead.
            resume_input = page.locator("input[type='file']#_systemfield_resume")
            if resume_input.count() == 0:
                resume_input = page.locator("input[type='file']")
            try:
                resume_input.first.set_input_files(resume_pdf_path)
            except Exception:
                pass

            # Confirmed live (Too Good To Go): some boards have a separate,
            # optional-looking-but-actually-required "Cover Letter" file
            # upload (`id='cover_letter'`) distinct from the resume input --
            # the old code only ever touched `_systemfield_resume`, so this
            # second upload slot sat empty and blocked submission every
            # time. Uses the same tailored cover letter PDF already passed
            # into every connector's `apply()` signature.
            cover_letter_input = page.locator("input[type='file']#cover_letter, input[type='file'][name='cover_letter']")
            if cover_letter_input.count() > 0:
                try:
                    cover_letter_input.first.set_input_files(cover_letter_pdf_path)
                except Exception:
                    pass
            page.wait_for_timeout(1_000)

            form_filling.fill_screening_questions(page, qa_bank)
            form_filling.fill_comboboxes(page, qa_bank)
            form_filling.check_acknowledgment_boxes(page)
            # Confirmed live: unlike workday.py, this connector never called
            # this at all -- EEO/voluntary-disclosure questions (gender,
            # race/ethnicity, veteran, disability) only ever got filled if
            # the QA bank happened to have an entry matching that specific
            # employer's exact question wording, which is rare. Selects the
            # decline-to-answer option by default, same as every other
            # connector that calls this.
            form_filling.decline_voluntary_disclosures(page)
            page.wait_for_timeout(500)

            empty_required = page.locator(
                "input[required]:visible, textarea[required]:visible"
            ).evaluate_all(
                "els => els.filter(e => !e.value).map(e => e.name || e.id || e.placeholder || '(unnamed)')"
            )
            if not empty_required:
                break

        if empty_required:
            browser.close()
            return ApplyResult(
                status="needs_manual",
                detail=f"Required Ashby fields still empty before submit: {', '.join(empty_required)}.",
            )

        submit_button = page.get_by_role("button", name="Submit Application", exact=False)
        if submit_button.count() == 0:
            submit_button = page.get_by_role("button", name="Submit", exact=False)
        if submit_button.count() == 0:
            browser.close()
            return ApplyResult(status="needs_manual", detail="No submit button found on the Ashby form.")

        if dry_run:
            browser.close()
            return ApplyResult(
                status="dry_run_ready",
                detail=f"Ashby form filled at {url} -- stopped short of submit per dry-run mode.",
            )

        submit_button.first.click()
        page.wait_for_timeout(2_500)
        try:
            page.wait_for_load_state("networkidle", timeout=6_000)
        except PlaywrightTimeoutError:
            pass

        if _looks_submitted(page):
            browser.close()
            return ApplyResult(status="applied", detail=f"Submitted via Ashby at {url}.")

        browser.close()
        return ApplyResult(
            status="needs_manual",
            detail=(
                f"Ashby submit click at {url} produced no confirmation -- possibly blocked by reCAPTCHA or an "
                "unfilled required field this connector doesn't recognize. Not marked applied without confirmation."
            ),
        )
