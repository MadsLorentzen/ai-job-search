import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models
from app.services.automation.qa_matching import answer_for_question


def entry(pattern, answer, is_regex=False):
    return models.QABankEntry(question_pattern=pattern, answer=answer, is_regex=is_regex)


def test_substring_match():
    bank = [entry("years of experience", "8 years")]
    assert answer_for_question("How many years of experience do you have?", bank) == "8 years"


def test_regex_match():
    bank = [entry(r"sponsorship|visa", "No, I do not require sponsorship.", is_regex=True)]
    assert answer_for_question("Will you now or in the future require visa sponsorship?", bank) == (
        "No, I do not require sponsorship."
    )


def test_no_match_returns_none():
    bank = [entry("years of experience", "8 years")]
    assert answer_for_question("What is your desired salary?", bank) is None


def test_first_match_wins():
    bank = [entry("salary", "Open to discussion"), entry("desired salary", "should not reach here")]
    assert answer_for_question("What is your desired salary?", bank) == "Open to discussion"
