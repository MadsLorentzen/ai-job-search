"""Deterministic User Profile v1 contract for job-search intent and preferences."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any


USER_PROFILE_VERSION = "user-profile.v1"
REMOTE_PREFERENCES = frozenset({
    "no_preference",
    "remote_only",
    "remote_preferred",
    "hybrid_preferred",
    "onsite_preferred",
    "remote_or_hybrid",
})
SENIORITY_LEVELS = frozenset({
    "intern", "graduate", "entry", "junior", "associate", "mid", "senior",
    "staff", "principal", "lead", "manager", "head", "director", "vp", "executive",
})
EMPLOYMENT_TYPES = frozenset({
    "full_time", "part_time", "contract", "temporary", "freelance", "internship",
    "apprenticeship", "graduate", "volunteer",
})
COMPENSATION_PERIODS = frozenset({"hour", "day", "month", "year"})
LIST_FIELDS = (
    "target_roles",
    "locations",
    "seniority_levels",
    "industries",
    "employment_types",
    "search_terms",
    "source_preferences",
)
ALLOWED_FIELDS = frozenset({
    "schema_version",
    *LIST_FIELDS,
    "remote_preference",
    "recency_days",
    "compensation",
})
MAX_LIST_ITEMS = 50
MAX_TEXT_LENGTH = 200
MAX_COMPENSATION = 1_000_000_000_000
_CURRENCY = re.compile(r"^[A-Z]{3}$")


class UserProfileValidationError(ValueError):
    def __init__(self, errors: str | list[str]):
        self.errors = [errors] if isinstance(errors, str) else errors
        super().__init__("; ".join(self.errors))


def normalize_user_profile(value: Any) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(value, dict):
        raise UserProfileValidationError("$: must be an object")
    for field in sorted(set(value) - ALLOWED_FIELDS, key=str):
        errors.append(f"$.{field}: unsupported field")
    if "schema_version" in value and value.get("schema_version") != USER_PROFILE_VERSION:
        errors.append(f"$.schema_version: must be {USER_PROFILE_VERSION!r}")

    normalized: dict[str, Any] = {"schema_version": USER_PROFILE_VERSION}
    for field in LIST_FIELDS:
        normalized[field] = _normalize_string_list(value.get(field, []), field, errors)

    remote_preference = value.get("remote_preference", "no_preference")
    if remote_preference not in REMOTE_PREFERENCES:
        errors.append(
            "$.remote_preference: must be one of " + ", ".join(sorted(REMOTE_PREFERENCES))
        )
    normalized["remote_preference"] = remote_preference

    _enum_list(normalized["seniority_levels"], SENIORITY_LEVELS, "seniority_levels", errors)
    _enum_list(normalized["employment_types"], EMPLOYMENT_TYPES, "employment_types", errors)

    recency_days = value.get("recency_days", 14)
    if isinstance(recency_days, bool) or not isinstance(recency_days, int) or not 1 <= recency_days <= 365:
        errors.append("$.recency_days: must be an integer from 1 to 365")
    normalized["recency_days"] = recency_days
    normalized["compensation"] = _normalize_compensation(value.get("compensation"), errors)

    if errors:
        raise UserProfileValidationError(errors)
    return normalized


def user_profile_content_id(profile: Any) -> str:
    normalized = normalize_user_profile(profile)
    material = json.dumps(
        normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    )
    return "userprofile_" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:20]


def _normalize_string_list(value: Any, field: str, errors: list[str]) -> list[str]:
    if not isinstance(value, list):
        errors.append(f"$.{field}: must be an array")
        return []
    if len(value) > MAX_LIST_ITEMS:
        errors.append(f"$.{field}: must contain at most {MAX_LIST_ITEMS} items")
    output: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value[:MAX_LIST_ITEMS]):
        if not isinstance(item, str):
            errors.append(f"$.{field}[{index}]: must be a string")
            continue
        text = _one_line(item)
        if not text:
            errors.append(f"$.{field}[{index}]: must not be empty")
            continue
        if len(text) > MAX_TEXT_LENGTH:
            errors.append(f"$.{field}[{index}]: must contain at most {MAX_TEXT_LENGTH} characters")
            continue
        identity = text.casefold()
        if identity not in seen:
            seen.add(identity)
            output.append(text)
    return output


def _one_line(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())


def _enum_list(values: list[str], allowed: frozenset[str], field: str, errors: list[str]) -> None:
    for index, value in enumerate(values):
        if value not in allowed:
            errors.append(f"$.{field}[{index}]: must be one of {', '.join(sorted(allowed))}")


def _normalize_compensation(value: Any, errors: list[str]) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        errors.append("$.compensation: must be an object or null")
        return None
    allowed = {"currency", "minimum", "period"}
    for field in sorted(set(value) - allowed, key=str):
        errors.append(f"$.compensation.{field}: unsupported field")
    for field in sorted(allowed - set(value)):
        errors.append(f"$.compensation.{field}: required field is missing")
    currency_value = value.get("currency")
    currency = _one_line(currency_value).upper() if isinstance(currency_value, str) else ""
    if not _CURRENCY.fullmatch(currency):
        errors.append("$.compensation.currency: must be a three-letter currency code")
    minimum = value.get("minimum")
    if (
        isinstance(minimum, bool)
        or not isinstance(minimum, int)
        or not 0 <= minimum <= MAX_COMPENSATION
    ):
        errors.append(
            f"$.compensation.minimum: must be an integer from 0 to {MAX_COMPENSATION}"
        )
    period = value.get("period")
    if period not in COMPENSATION_PERIODS:
        errors.append(
            "$.compensation.period: must be one of " + ", ".join(sorted(COMPENSATION_PERIODS))
        )
    return {"currency": currency, "minimum": minimum, "period": period}
