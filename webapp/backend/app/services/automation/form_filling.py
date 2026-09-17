"""Generic screening-question form filling, shared across connectors.

Originally built for LinkedIn's Easy Apply screening step and extracted
here once Workday's "Application Questions" step needed the exact same
three shapes (free-text/number inputs, dropdowns, radio-button groups)
handled the same way -- keeping one copy avoids the two connectors'
answer-matching behavior drifting apart over time, the same reasoning
`pipeline.py`'s own docstring gives for sharing evaluate/tailor/apply logic
between the API routes and the scheduler.
"""

from __future__ import annotations

from playwright.sync_api import Page
from rapidfuzz import fuzz

from app import models
from app.services.automation.qa_matching import answer_for_question
from app.services.text_utils import contains_phrase


def label_text_for_field(page: Page, field) -> str | None:
    """label[for=id] first, then aria-label -- covers both of the common
    labeling patterns (a real <label> for text/select fields, an aria-label
    on custom-styled controls).
    """
    try:
        field_id = field.get_attribute("id")
        if field_id:
            label = page.locator(f"label[for='{field_id}']")
            if label.count() > 0:
                return label.first.inner_text()
        aria_label = field.get_attribute("aria-label")
        if aria_label:
            return aria_label
    except Exception:
        pass
    return None


def fill_text_fields(page: Page, qa_bank: list[models.QABankEntry], scope: str = "") -> None:
    text_inputs = page.locator(f"{scope} input[type=text]:visible, {scope} input[type=number]:visible, {scope} textarea:visible")
    for i in range(text_inputs.count()):
        field = text_inputs.nth(i)
        try:
            if field.input_value():
                continue  # already has a value (often pre-filled from an existing profile)
        except Exception:
            continue
        label_text = label_text_for_field(page, field)
        answer = answer_for_question(label_text, qa_bank) if label_text else None
        if answer:
            field.fill(answer)
            # Workday's client-side validation doesn't register a filled
            # value until the field blurs -- confirmed live: without this,
            # every field this function filled still showed as "required"
            # after clicking Next, even though input_value() correctly
            # showed the text. Harmless on LinkedIn's simpler forms too.
            # field.press(), not page.keyboard.press() -- this module is
            # also used against Playwright `Frame` objects (an embedded
            # ATS iframe), which have no `.keyboard` of their own; a
            # locator's own .press() works identically on both Page and
            # Frame-scoped fields.
            field.press("Tab")


def _best_matching_option(options: list[str], answer: str) -> str | None:
    """Picks the option that best represents a QA-bank answer, for both
    short-answer and bucketed-range questions.

    Tried in order:
    1. Phrase containment in either direction (the same check
       fill_radio_groups already uses) -- required for short option text
       like "Yes"/"No" against a full-sentence QA-bank answer ("Yes, I will
       require sponsorship in the future."). Confirmed live this matters:
       `fuzz.token_set_ratio("yes", "yes, i will require sponsorship in the
       future.")` scores only ~12/100 -- its char-level comparison is
       dominated by the huge length mismatch even though "yes" is fully
       contained in the answer -- which silently failed every Yes/No
       dropdown/combobox question until this was added.
    2. Fuzzy similarity above a confidence floor, for cases where neither
       phrase contains the other (e.g. "8 years" answer vs. a "5+ years"
       bucketed option) -- a bad match is left blank rather than guessed.
    """
    for option in options:
        if contains_phrase(answer, option) or contains_phrase(option, answer):
            return option
    best_option = max(options, key=lambda opt: fuzz.token_set_ratio(opt.lower(), answer.lower()))
    if fuzz.token_set_ratio(best_option.lower(), answer.lower()) < 50:
        return None
    return best_option


def fill_select_dropdowns(page: Page, qa_bank: list[models.QABankEntry], scope: str = "") -> None:
    selects = page.locator(f"{scope} select:visible")
    for i in range(selects.count()):
        field = selects.nth(i)
        label_text = label_text_for_field(page, field)
        answer = answer_for_question(label_text, qa_bank) if label_text else None
        if not answer:
            continue
        try:
            options = field.locator("option").all_inner_texts()
        except Exception:
            continue
        if not options:
            continue
        best_option = _best_matching_option(options, answer)
        if not best_option:
            continue
        try:
            field.select_option(label=best_option)
        except Exception:
            pass


def fill_radio_groups(page: Page, qa_bank: list[models.QABankEntry], scope: str = "") -> None:
    fieldsets = page.locator(f"{scope} fieldset:visible")
    for i in range(fieldsets.count()):
        fieldset = fieldsets.nth(i)
        try:
            legend = fieldset.locator("legend")
            if legend.count() > 0:
                question_text = legend.first.inner_text()
            else:
                # Some radio-group fieldsets use a plain <label> as the
                # question title instead of <legend> (confirmed live: an
                # Ashby board's "years of experience" bucket question) --
                # scoped to a direct child so this doesn't accidentally
                # pick up a per-option label nested deeper in the fieldset.
                label = fieldset.locator("> label")
                question_text = label.first.inner_text() if label.count() > 0 else None
        except Exception:
            question_text = None
        answer = answer_for_question(question_text, qa_bank) if question_text else None
        if not answer:
            continue

        radios = fieldset.locator("input[type=radio]")
        for j in range(radios.count()):
            radio = radios.nth(j)
            radio_label = label_text_for_field(page, radio) or ""
            # The qa_bank answer is a full sentence ("No, I do not require
            # sponsorship."); the radio option is a short word ("No"/"Yes").
            # A word-boundary containment check in either direction handles
            # both without requiring the user to phrase answers to match
            # exact option text.
            if radio_label and (contains_phrase(answer, radio_label) or contains_phrase(radio_label, answer)):
                try:
                    radio.check()
                except Exception:
                    pass
                break


def _select_combobox_option(scope, button, picker) -> None:
    """Clicks a Workday-style combobox button and selects whichever option
    `picker(option_texts)` returns (an option text, or None to close
    without selecting). Retries the whole click-read-select sequence up to
    3 times, verifying the button's own displayed text actually changed --
    confirmed live this combobox pattern is genuinely racy: across
    otherwise-identical runs against the same real posting, a DIFFERENT
    single field would intermittently fail each time (sponsorship one run,
    veteran status the next), pointing at a timing race in the option
    list's async render rather than any one field's matching logic being
    wrong. A fixed wait alone wasn't reliable; verifying and retrying is.

    `scope` is a Page or Frame -- MUST be whatever the button itself lives
    in, not necessarily the top-level Page. Confirmed live this matters:
    called against a combobox inside an embedded Greenhouse iframe with the
    outer Page passed in, `page.get_by_role("option")` searched only the
    main frame and never found the options rendered inside the iframe.
    Frame supports the same `.get_by_role()`/`.wait_for_timeout()` calls
    used here, so passing the right one is enough -- no separate branch
    needed.
    """
    original_text = ""
    try:
        original_text = button.inner_text()
    except Exception:
        pass

    for _ in range(3):
        try:
            button.click()
            scope.wait_for_timeout(500)
            options = scope.get_by_role("option")
            option_count = options.count()
            if option_count == 0:
                scope.wait_for_timeout(500)
                continue
            texts = [options.nth(j).inner_text() for j in range(option_count)]
            chosen = picker(texts)
            if chosen is None:
                button.click()  # close the popup without selecting
                return
            options.nth(texts.index(chosen)).click()
            scope.wait_for_timeout(300)
            new_text = button.inner_text()
            if new_text != original_text:
                return  # confirmed the selection actually registered
        except Exception:
            pass


def fill_comboboxes(page: Page, qa_bank: list[models.QABankEntry], scope: str = "") -> None:
    """Handles the `<button aria-haspopup="listbox">` + `role="option"`
    combobox pattern Workday uses in place of a native `<select>` for
    fields like State and "How Did You Hear About Us?" -- confirmed live
    against a real posting (Tricentis): clicking the button reveals the
    full option list directly (no typing needed), each option exposed via
    `role="option"`, matched the same fuzzy way as a native dropdown.
    """
    buttons = page.locator(f"{scope} button[aria-haspopup='listbox']:visible")
    for i in range(buttons.count()):
        button = buttons.nth(i)
        try:
            wrapper = button.locator("xpath=ancestor::*[@data-automation-id][1]")
            label_el = wrapper.locator("label")
            if label_el.count() > 0:
                label_text = label_el.first.inner_text()
            else:
                # Some combobox questions use a <fieldset><legend> wrapper
                # instead of <label> (confirmed live: Workday's custom
                # "Application Questions" render this way, unlike its own
                # built-in fields like State) -- same fallback shape
                # fill_radio_groups already handles for actual radio
                # questions.
                legend_el = wrapper.locator("legend")
                label_text = legend_el.first.inner_text() if legend_el.count() > 0 else None
        except Exception:
            label_text = None
        answer = answer_for_question(label_text, qa_bank) if label_text else None
        if not answer:
            continue
        _select_combobox_option(page, button, lambda texts: _best_matching_option(texts, answer))


def fill_react_select_comboboxes(page: Page, qa_bank: list[models.QABankEntry], scope: str = "") -> None:
    """Handles the "react-select" combobox pattern (confirmed live on a
    Greenhouse board embedded on stripe.com): an `<input role="combobox"
    aria-haspopup="true">` rather than Workday's `<button
    aria-haspopup="listbox">`, but the same reveal-a-role=option-list-on-
    click behavior once focused/clicked, and -- unlike Ashby's Yes/No
    buttons -- a real `<label for=id>` pointing at the input's own id, so
    the existing label lookup just works. Used for every dropdown-shaped
    Greenhouse question observed (work authorization, sponsorship, EEO
    gender/ethnicity/veteran/disability), none of which are native
    `<select>` elements despite looking like one.
    """
    inputs = page.locator(f"{scope} input[role='combobox']:visible")
    for i in range(inputs.count()):
        field = inputs.nth(i)
        label_text = label_text_for_field(page, field)
        answer = answer_for_question(label_text, qa_bank) if label_text else None
        if not answer:
            continue
        _select_combobox_option(page, field, lambda texts: _best_matching_option(texts, answer))


def fill_yes_no_buttons(page: Page, qa_bank: list[models.QABankEntry], scope: str = "") -> None:
    """Handles Ashby's custom Yes/No question widget: a pair of
    `<button data-option="yes|no" aria-pressed="...">` elements (not
    `<input type=radio>` at all -- there's a hidden decoy checkbox, but the
    buttons are what actually carry the answer), labeled by a `<label>`
    that sits alongside the button pair rather than wrapping it. Confirmed
    live against a real Ashby board (Directive): fill_radio_groups doesn't
    match this at all, since there's no `<fieldset>`/radio input here.
    """
    labels = page.locator(f"{scope} label.ashby-application-form-question-title:visible")
    for i in range(labels.count()):
        label = labels.nth(i)
        try:
            question_text = label.inner_text()
        except Exception:
            continue
        answer = answer_for_question(question_text, qa_bank)
        if not answer:
            continue
        container = label.locator(
            "xpath=following-sibling::*[.//button[@data-option='yes'] or .//button[@data-option='no']][1]"
        )
        if container.count() == 0:
            continue
        wants_yes = contains_phrase(answer, "yes")
        wants_no = contains_phrase(answer, "no")
        option = "yes" if wants_yes and not wants_no else ("no" if wants_no and not wants_yes else None)
        if option is None:
            continue
        button = container.locator(f"button[data-option='{option}']")
        if button.count() > 0:
            try:
                button.first.click()
            except Exception:
                pass


def fill_screening_questions(page: Page, qa_bank: list[models.QABankEntry], scope: str = "") -> None:
    """Runs all three question shapes against whatever's visible in `scope`
    (a CSS selector prefix, or "" for the whole page)."""
    fill_text_fields(page, qa_bank, scope)
    fill_select_dropdowns(page, qa_bank, scope)
    fill_radio_groups(page, qa_bank, scope)
    fill_yes_no_buttons(page, qa_bank, scope)


# Phrases that identify an EEO/voluntary-disclosure option as the
# decline-to-answer choice, in the many ways different ATSes word it.
# Selected by default on every EEO question (gender, race/ethnicity,
# veteran status, disability) -- this project's candidate profile has no
# self-identification data and never fabricates it; declining is the
# honest, standard-practice answer.
DECLINE_TO_ANSWER_PHRASES = [
    "decline to answer",
    "decline to self",
    "prefer not to",
    "do not wish to",
    "do not wish",
    "don't wish to",
    "not wish to disclose",
    "not specified",
    "choose not to",
    "i don't wish",
    "not declared",
    "decline self",
    "rather not",
]


def _is_decline_option(text: str) -> bool:
    lowered = text.lower()
    return any(phrase in lowered for phrase in DECLINE_TO_ANSWER_PHRASES)


# Phrases identifying a checkbox as a standard "I've read this" /
# "I certify/agree" acknowledgment rather than a substantive question --
# checking it only confirms the applicant was shown the referenced policy
# text, which the automation flow has genuinely done by reaching this
# point, so this isn't asserting anything false on the candidate's behalf.
ACKNOWLEDGMENT_PHRASES = [
    "have read and understand",
    "have read, understand",
    "i acknowledge",
    "i certify",
    "i agree",
    "privacy policy",
    "terms and conditions",
    "terms of use",
]


def _is_acknowledgment_label(text: str) -> bool:
    lowered = text.lower()
    return any(phrase in lowered for phrase in ACKNOWLEDGMENT_PHRASES)


def check_acknowledgment_boxes(page: Page, scope: str = "") -> None:
    """Checks standard privacy-policy/terms/certification checkboxes --
    confirmed live (Tricentis's final Voluntary Disclosures step) this is
    the last remaining required-field type between a fully filled EEO
    section and Review; unlike EEO questions and screening questions, this
    doesn't vary in intent across employers, just in exact wording.
    """
    checkboxes = page.locator(f"{scope} input[type=checkbox]:visible")
    for i in range(checkboxes.count()):
        checkbox = checkboxes.nth(i)
        try:
            if checkbox.is_checked():
                continue
            label = label_text_for_field(page, checkbox) or ""
            if _is_acknowledgment_label(label):
                checkbox.check()
        except Exception:
            pass

    # Confirmed live on a real Ashby board (Too Good To Go): some employers
    # implement the "I have read and understood our Privacy Notice"
    # acknowledgment as a single-option <fieldset><input type=radio>, not a
    # checkbox -- the fieldset's own question text (read via the same
    # direct-child <label> fallback fill_radio_groups uses) is the
    # acknowledgment phrase itself, and there's no QA-bank entry for a
    # company-specific privacy-notice sentence, so this would otherwise sit
    # required-and-empty forever. No answer content is asserted here beyond
    # what check_acknowledgment_boxes already asserts for the checkbox
    # shape -- checking it only confirms the applicant reached this point.
    fieldsets = page.locator(f"{scope} fieldset:visible")
    for i in range(fieldsets.count()):
        fieldset = fieldsets.nth(i)
        try:
            legend = fieldset.locator("legend")
            question_text = (
                legend.first.inner_text()
                if legend.count() > 0
                else (fieldset.locator("> label").first.inner_text() if fieldset.locator("> label").count() > 0 else "")
            )
        except Exception:
            continue
        if not _is_acknowledgment_label(question_text):
            continue
        radios = fieldset.locator("input[type=radio]")
        if radios.count() == 0:
            continue
        try:
            if not radios.first.is_checked():
                radios.first.check()
        except Exception:
            pass


def decline_voluntary_disclosures(page: Page, scope: str = "") -> None:
    """Selects the decline-to-answer option on every EEO-style radio group
    and dropdown found in `scope`, without needing per-question QA-bank
    entries -- these questions vary in wording across employers, but the
    decline option is always both present (required by EEO regulations)
    and always the right answer given no real self-ID data exists.
    """
    fieldsets = page.locator(f"{scope} fieldset:visible")
    for i in range(fieldsets.count()):
        fieldset = fieldsets.nth(i)
        radios = fieldset.locator("input[type=radio]")
        for j in range(radios.count()):
            radio = radios.nth(j)
            label = label_text_for_field(page, radio) or ""
            if _is_decline_option(label):
                try:
                    radio.check()
                except Exception:
                    pass
                break

        # Confirmed live on a real Ashby board (Too Good To Go): some EEO
        # questions render as a checkbox group instead of radios -- e.g. a
        # sexual-orientation or race/ethnicity question where "I don't wish
        # to answer" is one checkbox among many, not a single yes/no toggle.
        # decline_voluntary_disclosures previously only checked
        # fieldset-scoped radios, so these sat required-and-unchecked. Same
        # decline-phrase match, just against the checkbox's own label
        # instead of a radio's.
        checkboxes = fieldset.locator("input[type=checkbox]")
        for j in range(checkboxes.count()):
            checkbox = checkboxes.nth(j)
            label = label_text_for_field(page, checkbox) or ""
            if _is_decline_option(label):
                try:
                    if not checkbox.is_checked():
                        checkbox.check()
                except Exception:
                    pass
                break

    # Workday's own EEO/self-ID questions ("Please select your gender", race
    #/ethnicity, veteran status) use the same button+listbox combobox
    # pattern as its other custom questions, not a native <select> --
    # confirmed live (Tricentis's gender question). Handled the same way as
    # fill_comboboxes, but selecting the decline phrase instead of a
    # QA-bank answer.
    buttons = page.locator(f"{scope} button[aria-haspopup='listbox']:visible")

    def _pick_decline(texts: list[str]) -> str | None:
        return next((t for t in texts if _is_decline_option(t)), None)

    for i in range(buttons.count()):
        button = buttons.nth(i)
        _select_combobox_option(page, button, _pick_decline)

    selects = page.locator(f"{scope} select:visible")
    for i in range(selects.count()):
        field = selects.nth(i)
        try:
            options = field.locator("option").all_inner_texts()
        except Exception:
            continue
        decline_option = next((opt for opt in options if _is_decline_option(opt)), None)
        if decline_option:
            try:
                field.select_option(label=decline_option)
            except Exception:
                pass
