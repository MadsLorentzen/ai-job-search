"""iCIMS application connector -- best-effort, per the plan's disclosed
limitation #3 (grouped with Workday as a lower-reliability target). iCIMS
boards vary significantly by employer configuration; this handles the
common simple-form case and falls through to needs_manual otherwise.
Unverified against a live posting -- see linkedin.py's module docstring for
the same "run dry_run first" caveat.
"""

from __future__ import annotations

from playwright.sync_api import sync_playwright

from app import models
from app.services.automation.base import ApplyResult

FIELD_SELECTORS = {
    "first_name": "input[name='firstname'], #firstName",
    "last_name": "input[name='lastname'], #lastName",
    "email": "input[name='email'], #email",
    "phone": "input[name='phone'], #phone",
}


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

        name_parts = profile.name.split(" ", 1)
        first_name, last_name = name_parts[0], name_parts[1] if len(name_parts) > 1 else ""
        field_values = {
            "first_name": first_name, "last_name": last_name,
            "email": profile.email, "phone": profile.phone,
        }
        filled_any = False
        for field, selector in FIELD_SELECTORS.items():
            locator = page.locator(selector)
            if locator.count() > 0:
                locator.first.fill(field_values[field])
                filled_any = True

        if not filled_any:
            browser.close()
            return ApplyResult(
                status="needs_manual", detail="No recognized iCIMS fields found -- this board's template isn't handled."
            )

        resume_input = page.locator("input[type='file']")
        if resume_input.count() > 0:
            resume_input.first.set_input_files(resume_pdf_path)

        submit_button = page.get_by_role("button", name="Submit", exact=False)
        if submit_button.count() == 0:
            browser.close()
            return ApplyResult(status="needs_manual", detail="No submit button found on the iCIMS form.")

        if dry_run:
            browser.close()
            return ApplyResult(
                status="dry_run_ready",
                detail=f"iCIMS form filled at {url} -- stopped short of submit per dry-run mode.",
            )

        submit_button.first.click()
        browser.close()
        return ApplyResult(status="applied", detail=f"Submitted via iCIMS at {url}.")
