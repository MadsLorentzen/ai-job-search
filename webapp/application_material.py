"""Pure completion checks for reviewed, user-usable application material."""
from __future__ import annotations

from typing import Any

from product.application_material_contract import (
    COVER_LETTER_UNIT_TYPES,
    CV_UNIT_TYPES,
    ELIGIBLE_STATUSES,
    INSUFFICIENT_COVER_LETTER_PARAGRAPHS,
    INSUFFICIENT_COVER_LETTER_WORDS,
    INSUFFICIENT_CV_UNITS,
    INSUFFICIENT_CV_WORDS,
    MIN_COVER_LETTER_PARAGRAPHS,
    MIN_COVER_LETTER_WORDS,
    MIN_CV_UNITS,
    MIN_CV_WORDS,
    MISSING_CV_BULLET,
    normalized_word_tokens,
)

MATERIAL_COLLECTIONS = ("cv_content", "cover_letter_content")


def _acknowledged_content_unit_ids(payload: dict[str, Any]) -> set[str]:
    review_record = payload.get("review_record")
    decisions = review_record.get("decisions_consulted", []) if isinstance(review_record, dict) else []
    return {
        decision["domain_item_id"]
        for decision in decisions
        if isinstance(decision, dict)
        and decision.get("review_item_type") == "content_unit"
        and decision.get("disposition") == "acknowledged_and_proceed"
        and isinstance(decision.get("domain_item_id"), str)
        and bool(decision["domain_item_id"])
    }


def _qualifying_units(
    payload: dict[str, Any], collection: str, allowed_types: frozenset[str]
) -> list[dict[str, Any]]:
    acknowledged_ids = _acknowledged_content_unit_ids(payload)
    units = payload.get(collection, [])
    if not isinstance(units, list):
        return []
    qualifying: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for unit in units:
        if not isinstance(unit, dict):
            continue
        unit_id = unit.get("unit_id")
        if (
            not isinstance(unit_id, str)
            or not unit_id
            or unit_id in seen_ids
            or unit_id not in acknowledged_ids
            or unit.get("unit_type") not in allowed_types
            or unit.get("status") not in ELIGIBLE_STATUSES
            or not isinstance(unit.get("profile_evidence_ids"), list)
            or not normalized_word_tokens(unit.get("text"))
        ):
            continue
        seen_ids.add(unit_id)
        qualifying.append(unit)
    return qualifying


def usable_application_units(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return _qualifying_units(payload, "cv_content", CV_UNIT_TYPES) + _qualifying_units(
        payload, "cover_letter_content", COVER_LETTER_UNIT_TYPES
    )


def application_material_completion(payload: dict[str, Any]) -> dict[str, Any]:
    cv_units = _qualifying_units(payload, "cv_content", CV_UNIT_TYPES)
    cover_letter_paragraphs = _qualifying_units(
        payload, "cover_letter_content", COVER_LETTER_UNIT_TYPES
    )
    cv_word_count = sum(len(normalized_word_tokens(unit["text"])) for unit in cv_units)
    cover_letter_word_count = sum(
        len(normalized_word_tokens(unit["text"])) for unit in cover_letter_paragraphs
    )
    issues: list[str] = []
    if len(cv_units) < MIN_CV_UNITS:
        issues.append(INSUFFICIENT_CV_UNITS)
    if not any(unit["unit_type"] == "cv_bullet" for unit in cv_units):
        issues.append(MISSING_CV_BULLET)
    if cv_word_count < MIN_CV_WORDS:
        issues.append(INSUFFICIENT_CV_WORDS)
    if len(cover_letter_paragraphs) < MIN_COVER_LETTER_PARAGRAPHS:
        issues.append(INSUFFICIENT_COVER_LETTER_PARAGRAPHS)
    if cover_letter_word_count < MIN_COVER_LETTER_WORDS:
        issues.append(INSUFFICIENT_COVER_LETTER_WORDS)
    return {
        "status": "INCOMPLETE" if issues else "READY",
        "issues": issues,
        "qualifying_cv_unit_count": len(cv_units),
        "cv_word_count": cv_word_count,
        "qualifying_cover_letter_paragraph_count": len(cover_letter_paragraphs),
        "cover_letter_word_count": cover_letter_word_count,
    }


def application_material_is_completion_ready(payload: dict[str, Any]) -> bool:
    return application_material_completion(payload)["status"] == "READY"
