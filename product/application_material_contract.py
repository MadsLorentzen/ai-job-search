"""Shared deterministic v1 contract for substantive application material."""
from __future__ import annotations

import unicodedata


CV_UNIT_TYPES = frozenset({"cv_bullet", "cv_summary_line"})
COVER_LETTER_UNIT_TYPES = frozenset({"cover_letter_paragraph"})
ELIGIBLE_STATUSES = frozenset({"READY", "NEEDS_REVIEW"})
COMPLETION_CONTRACT_VERSION = "substantive-completion.v1"

MIN_CV_UNITS = 2
MIN_CV_WORDS = 20
MIN_COVER_LETTER_PARAGRAPHS = 1
MIN_COVER_LETTER_WORDS = 40

INSUFFICIENT_CV_UNITS = "insufficient_cv_units"
MISSING_CV_BULLET = "missing_cv_bullet"
INSUFFICIENT_CV_WORDS = "insufficient_cv_words"
INSUFFICIENT_COVER_LETTER_PARAGRAPHS = "insufficient_cover_letter_paragraphs"
INSUFFICIENT_COVER_LETTER_WORDS = "insufficient_cover_letter_words"

WORD_NORMALIZATION_DESCRIPTION = (
    "NFKC; collapse Unicode whitespace; trim Unicode punctuation at token edges"
)


def substantive_completion_contract() -> dict[str, object]:
    return {
        "version": COMPLETION_CONTRACT_VERSION,
        "minimum_cv_units": MIN_CV_UNITS,
        "requires_cv_bullet": True,
        "minimum_cv_words": MIN_CV_WORDS,
        "minimum_cover_letter_paragraphs": MIN_COVER_LETTER_PARAGRAPHS,
        "minimum_cover_letter_words": MIN_COVER_LETTER_WORDS,
        "word_normalization": WORD_NORMALIZATION_DESCRIPTION,
    }


def normalized_word_tokens(text: str) -> list[str]:
    """Return deterministic NFKC-normalized, punctuation-edge-trimmed words."""
    if not isinstance(text, str):
        return []
    collapsed = " ".join(unicodedata.normalize("NFKC", text).split())
    words: list[str] = []
    for raw_token in collapsed.split(" "):
        start = 0
        end = len(raw_token)
        while start < end and unicodedata.category(raw_token[start]).startswith("P"):
            start += 1
        while end > start and unicodedata.category(raw_token[end - 1]).startswith("P"):
            end -= 1
        token = raw_token[start:end]
        if token:
            words.append(token)
    return words
