#!/usr/bin/env python3
"""Fill a job application form from the candidate profile, and optionally submit.

Runs on YOUR machine, in YOUR browser profile, so you stay logged in to
LinkedIn/Greenhouse/Workday and the application is made from your own session.

    # browser visible, fills everything, stops before submitting
    python3 tools/autoapply.py --url https://boards.greenhouse.io/acme/jobs/123 \
        --resume cv/main_acme_coordinator.pdf

    # same, then presses submit
    python3 tools/autoapply.py --url ... --resume ... --submit

    # fills, affirms the certifications, and sends
    python3 tools/autoapply.py --url ... --resume ... --submit --accept-certifications

Two things it will not do on its own:
  * Tick consent / certification / "I agree" checkboxes. Those are your
    declaration, so they are ticked only when you pass --accept-certifications,
    which is you making that declaration as part of the command.
  * Invent an answer. A question it has no value for is left blank and listed.

Setup once:
    pip install playwright && python3 -m playwright install chromium
    cp applicant_answers.example.json applicant_answers.json   # then fill it in
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from typing import Any

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sys.exit("playwright not installed. Run: pip install playwright && python3 -m playwright install chromium")

# Ordered - first match wins, so put the specific patterns above the general ones.
# Keys resolve against the answers file; an "answers." prefix reads its sub-object.
RULES: list[tuple[str, str]] = [
    (r"legal\s*first|first\s*name\s*\(legal", "legal_first_name"),
    (r"legal\s*last|last\s*name\s*\(legal", "legal_last_name"),
    (r"preferred\s*name|nick\s*name", "first_name"),
    (r"full\s*name|^\s*name\s*$|your\s*name", "full_name"),
    (r"first\s*name|given\s*name|forename", "first_name"),
    (r"last\s*name|family\s*name|surname", "last_name"),
    (r"e-?mail", "email"),
    (r"phone|mobile|telephone|contact\s*number", "phone"),
    (r"linked\s*in", "linkedin"),
    (r"git\s*hub", "github"),
    (r"web\s*site|portfolio|personal\s*url", "website"),
    (r"postal|zip", "postal_code"),
    (r"city|town|locality", "address_city"),
    (r"province|state|region", "address_region"),
    (r"country", "address_country"),
    (r"school|university|institution|college", "school"),
    (r"degree", "degree"),
    (r"discipline|major|field\s*of\s*study", "discipline"),
    (r"graduat", "graduation_year"),
    (r"current\s*(employer|company)|^\s*company", "current_company"),
    (r"current\s*title|job\s*title|occupation", "current_title"),
    (r"sponsor", "answers.require_sponsorship"),
    (r"authoriz|authoris|legally\s*(able|entitled)|work\s*permit|right\s*to\s*work", "answers.legally_authorized_canada"),
    (r"relocat", "answers.willing_to_relocate"),
    (r"notice\s*period|available\s*to\s*start|start\s*date", "answers.notice_period"),
    (r"salary|compensation\s*expect|expected\s*pay", "answers.salary_expectation"),
    (r"how\s*did\s*you\s*hear|referral\s*source|^\s*source", "answers.how_did_you_hear"),
    (r"gender", "answers.gender"),
    (r"race|ethnic", "answers.race_ethnicity"),
    (r"veteran", "answers.veteran_status"),
    (r"disab", "answers.disability_status"),
]

CONSENT = re.compile(
    r"agree|consent|certif|acknowledg|terms|privacy|accurate|true\s+and\s+complete|authorize\s+.*verif",
    re.I,
)
SUBMIT_TEXT = re.compile(r"^\s*(submit|submit application|apply|send application)\s*$", re.I)

LABEL_PROBES = (
    "e => { const id=e.id; if(!id) return ''; const l=document.querySelector(`label[for=\"${CSS.escape(id)}\"]`); return l?l.innerText:''; }",
    "e => { const l=e.closest('label'); return l?l.innerText:''; }",
    "e => e.getAttribute('aria-label')||''",
    "e => { const r=e.getAttribute('aria-labelledby'); if(!r) return ''; return r.split(/\\s+/).map(i=>document.getElementById(i)).filter(Boolean).map(n=>n.innerText).join(' '); }",
    "e => e.getAttribute('placeholder')||''",
    "e => e.getAttribute('name')||''",
    "e => e.id||''",
)


def find_chrome() -> str | None:
    """An installed Chromium to drive, or None to let Playwright use its own.

    Playwright pins an exact browser build and refuses to start when the
    installed one differs. Preferring a real binary when we can find one keeps
    the tool working across that mismatch.
    """
    import glob

    if os.environ.get("AUTOAPPLY_CHROME"):
        return os.environ["AUTOAPPLY_CHROME"]
    patterns = [
        os.path.join(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"), "chromium-*/chrome-linux/chrome"),
        os.path.join(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"), "chromium/chrome-linux/chrome"),
    ]
    for pattern in patterns:
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[-1]
    for name in ("google-chrome", "chromium", "chromium-browser"):
        path = shutil.which(name)
        if path:
            return path
    return None


def lookup(answers: dict[str, Any], key: str) -> str:
    if key.startswith("answers."):
        return str(answers.get("answers", {}).get(key.split(".", 1)[1], "") or "")
    return str(answers.get(key, "") or "")


def describe(el) -> str:
    """Best-effort human label for a form control, from every source a form might use."""
    parts = []
    for js in LABEL_PROBES:
        try:
            value = el.evaluate(js)
        except Exception:
            value = ""
        if value:
            parts.append(value)
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def match_rule(label: str) -> str | None:
    low = label.lower()
    for pattern, key in RULES:
        if re.search(pattern, low):
            return key
    return None


def pick_option(el, want: str) -> str | None:
    """Value of the <option> that best matches `want`, or None if nothing fits."""
    options = el.evaluate("e => Array.from(e.options).map(o => ({v: o.value, t: o.text}))")
    wanted = want.strip().lower()
    if not wanted:
        return None
    for opt in options:
        if opt["t"].strip().lower() == wanted:
            return opt["v"]
    for opt in options:
        if wanted in opt["t"].strip().lower():
            return opt["v"]
    if wanted in ("yes", "no"):
        for opt in options:
            if opt["t"].strip().lower().startswith(wanted):
                return opt["v"]
    return None


def find_submit(page):
    for btn in page.query_selector_all("button, input[type=submit]"):
        try:
            tag = btn.evaluate("e => e.tagName.toLowerCase()")
            text = (btn.inner_text() if tag == "button" else btn.get_attribute("value")) or ""
            if SUBMIT_TEXT.match(text) and btn.is_visible() and btn.is_enabled():
                return btn, text.strip()
        except Exception:
            continue
    return None, ""


def fill_form(page, answers, resume, cover_letter):
    filled, skipped, consents = [], [], []
    for el in page.query_selector_all("input, textarea, select"):
        label = ""
        try:
            if not el.is_visible() or not el.is_enabled():
                continue
            tag = el.evaluate("e => e.tagName.toLowerCase()")
            itype = (el.get_attribute("type") or "text").lower()
            if itype in ("hidden", "submit", "button", "image", "reset"):
                continue

            label = describe(el)

            if itype == "file":
                path = cover_letter if (cover_letter and re.search(r"cover", label, re.I)) else resume
                if path and os.path.exists(path):
                    el.set_input_files(os.path.abspath(path))
                    filled.append((label or "(file upload)", os.path.basename(path)))
                else:
                    skipped.append((label or "(file upload)", "no matching file provided"))
                continue

            if itype == "checkbox":
                if CONSENT.search(label):
                    consents.append(label)
                else:
                    skipped.append((label, "checkbox - left for you"))
                continue

            key = match_rule(label)
            if not key:
                skipped.append((label, "no rule matched"))
                continue
            value = lookup(answers, key)
            if not value:
                skipped.append((label, f"no value for '{key}'"))
                continue

            if itype == "radio":
                candidate = f"{el.get_attribute('value') or ''} {label}"
                if value.lower() in candidate.lower():
                    el.check()
                    filled.append((label, value))
                continue

            if tag == "select":
                option = pick_option(el, value)
                if option is None:
                    skipped.append((label, f"no option matching '{value}'"))
                else:
                    el.select_option(option)
                    filled.append((label, value))
                continue

            el.fill(value)
            filled.append((label, value))
        except Exception as exc:
            # One awkward field must never abort the whole run.
            skipped.append((label or "(unknown field)", f"error: {type(exc).__name__}"))
    return filled, skipped, consents


def report(filled, skipped, consents, screenshot):
    print(f"\nFilled {len(filled)} field(s):")
    for label, value in filled:
        print(f"  + {label[:56]:56} = {value[:40]}")
    if consents:
        print(f"\n{len(consents)} consent/certification box(es) NOT ticked - yours to confirm:")
        for label in consents:
            print(f"  ! {label[:100]}")
    if skipped:
        print(f"\n{len(skipped)} field(s) left blank:")
        for label, why in skipped:
            print(f"  - {label[:56]:56} ({why})")
    print(f"\nScreenshot: {screenshot}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--resume", help="resume PDF to upload")
    ap.add_argument("--cover-letter", help="cover letter PDF, for forms with a second upload")
    ap.add_argument("--answers", default="applicant_answers.json")
    ap.add_argument("--profile", default=os.path.expanduser("~/.ai-job-search-browser"),
                    help="persistent browser profile dir, so logins survive between runs")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--submit", action="store_true", help="press submit once the form is filled")
    ap.add_argument("--accept-certifications", action="store_true",
                    help="affirm the form's 'I certify / I agree' statements and tick them. "
                         "Passing this is your declaration, not the tool's.")
    ap.add_argument("--screenshot", default="application.png")
    ap.add_argument("--timeout", type=int, default=30000)
    args = ap.parse_args()

    if not os.path.exists(args.answers):
        sys.exit(f"No answers file at {args.answers}. Copy applicant_answers.example.json and fill it in.")
    answers = json.load(open(args.answers))
    if args.resume and not os.path.exists(args.resume):
        sys.exit(f"No resume at {args.resume}")

    with sync_playwright() as pw:
        launch: dict[str, Any] = {"headless": args.headless, "args": ["--no-sandbox"]}
        chrome = find_chrome()
        if chrome:
            launch["executable_path"] = chrome
        ctx = pw.chromium.launch_persistent_context(args.profile, **launch)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(args.timeout)
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)

        filled, skipped, consents = fill_form(page, answers, args.resume, args.cover_letter)
        page.screenshot(path=args.screenshot, full_page=True)
        report(filled, skipped, consents, args.screenshot)

        if args.submit:
            if consents and args.accept_certifications:
                # Passing the flag is the applicant's own affirmation of these
                # statements; the tool never ticks them on its own initiative.
                for el in page.query_selector_all("input[type=checkbox]"):
                    try:
                        if el.is_visible() and el.is_enabled() and CONSENT.search(describe(el)):
                            el.check()
                    except Exception:
                        pass
                print(f"\nTicked {len(consents)} certification box(es) under --accept-certifications.")
                consents = []
            if consents:
                print("\nNot submitting: the consent boxes above are still unticked.")
                print("Tick them in the open browser and rerun, or pass --accept-certifications")
                print("to affirm them yourself as part of the command.")
            else:
                btn, text = find_submit(page)
                if btn is None:
                    print("\nNo submit button found - the form may be multi-step. Left open for you.")
                else:
                    btn.click()
                    page.wait_for_timeout(4000)
                    page.screenshot(path="application_submitted.png", full_page=True)
                    print(f"\nClicked '{text}'. Confirmation screenshot: application_submitted.png")
        else:
            print("\nStopped before submit. Add --submit to send it.")

        if not args.headless:
            input("\nPress Enter to close the browser...")
        ctx.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
