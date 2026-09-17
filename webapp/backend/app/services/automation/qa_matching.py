from __future__ import annotations

import re

from app import models
from app.services.text_utils import contains_phrase


def answer_for_question(question_text: str, qa_bank: list[models.QABankEntry]) -> str | None:
    for entry in qa_bank:
        if entry.is_regex:
            if re.search(entry.question_pattern, question_text, re.IGNORECASE):
                return entry.answer
        elif contains_phrase(question_text, entry.question_pattern):
            return entry.answer
    return None
