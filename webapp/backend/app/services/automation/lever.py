"""Lever job-board application connector.

Root-caused live against a real posting (Findem, "Digital Marketing
Manager — Paid Media & Digital Execution") that was failing the same way
as every other connector in this project before it was checked: the job
URL Lever exposes is a listing page, not the application form -- the form
only exists at a separate `/apply` URL reached via the listing's "Apply
for this job" link. This connector used to go straight to `page.goto(url)`
and expect form fields there directly, so it never found any.

Once actually reachable, the field selectors this connector already had
(`input[name='name']`, `'email'`, `'phone'`, `'resume'`) turned out to be
exactly right -- Lever's naming convention really is that stable. The two
gaps were the missing navigation step, and two required fields this
connector didn't know about at all: "Current company" (`input[name='org']`)
and a required "LinkedIn URL" (`input[name='urls[LinkedIn]']`) -- both
filled from real profile/experience data, not left blank or guessed.

Lever's apply page also loads an hCaptcha widget (confirmed live via its
frames), the same risk already disclosed for Ashby and Greenhouse -- an
invisible/enclave-style challenge can pass silently for a normal browsing
session, but isn't guaranteed to.
"""

from __future__ import annotations

from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright
from sqlalchemy.orm import object_session

from app import models
from app.services.automation import form_filling
from app.services.automation.base import ApplyResult

FIELD_SELECTORS = {
    "name": "input[name='name']",
    "email": "input[name='email']",
    "phone": "input[name='phone']",
}


def _settle(page: Page, timeout_ms: int = 8_000) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except PlaywrightTimeoutError:
        pass
    page.wait_for_timeout(1_500)


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

        if page.locator("input[name='name']").count() == 0:
            apply_link = page.get_by_role("link", name="Apply for this job", exact=False)
            if apply_link.count() == 0:
                apply_link = page.get_by_role("link", name="Apply", exact=False)
            if apply_link.count() > 0:
                apply_link.first.click()
                _settle(page)

        field_values = {"name": profile.name, "email": profile.email, "phone": profile.phone}
        filled_any = False
        for field, selector in FIELD_SELECTORS.items():
            locator = page.locator(selector)
            if locator.count() > 0:
                locator.first.fill(field_values[field])
                filled_any = True

        if not filled_any:
            browser.close()
            return ApplyResult(
                status="needs_manual", detail="No recognized Lever fields found -- this board may use a custom template."
            )

        # Real profile/experience data, not screening-question guesses --
        # both fields are required on the board this was verified against.
        linkedin_field = page.locator("input[name='urls[LinkedIn]']")
        if linkedin_field.count() > 0 and profile.linkedin_url:
            linkedin_field.first.fill(profile.linkedin_url)

        org_field = page.locator("input[name='org']")
        if org_field.count() > 0:
            session = object_session(profile)
            if session is not None:
                current_role = (
                    session.query(models.ExperienceEntry).order_by(models.ExperienceEntry.sort_order.asc()).first()
                )
                if current_role is not None:
                    org_field.first.fill(current_role.company)

        resume_input = page.locator("input[name='resume']")
        if resume_input.count() > 0:
            resume_input.first.set_input_files(resume_pdf_path)
        page.wait_for_timeout(1_000)

        form_filling.fill_screening_questions(page, qa_bank)

        empty_required = page.locator(
            "input[required]:visible, textarea[required]:visible, select[required]:visible"
        ).evaluate_all("els => els.filter(e => !e.value).map(e => e.name || e.id || e.placeholder || '(unnamed)')")
        if empty_required:
            browser.close()
            return ApplyResult(
                status="needs_manual",
                detail=f"Required Lever fields still empty before submit: {', '.join(empty_required)}.",
            )

        submit_button = page.get_by_role("button", name="Submit application", exact=False)
        if submit_button.count() == 0:
            browser.close()
            return ApplyResult(status="needs_manual", detail="No submit button found on the Lever form.")

        if dry_run:
            browser.close()
            return ApplyResult(
                status="dry_run_ready",
                detail=f"Lever form filled at {url} -- stopped short of submit per dry-run mode.",
            )

        submit_button.first.click()
        browser.close()
        return ApplyResult(status="applied", detail=f"Submitted via Lever at {url}.")
