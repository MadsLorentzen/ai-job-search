from __future__ import annotations

import pytest

from product.user_profile import (
    USER_PROFILE_VERSION,
    UserProfileValidationError,
    normalize_user_profile,
    user_profile_content_id,
)


def test_empty_input_normalizes_to_explicit_v1_defaults():
    assert normalize_user_profile({}) == {
        "schema_version": USER_PROFILE_VERSION,
        "target_roles": [],
        "locations": [],
        "remote_preference": "no_preference",
        "seniority_levels": [],
        "industries": [],
        "employment_types": [],
        "search_terms": [],
        "source_preferences": [],
        "recency_days": 14,
        "compensation": None,
    }


def test_normalization_collapses_whitespace_and_deduplicates_without_losing_priority():
    profile = normalize_user_profile({
        "target_roles": ["  Project   Manager ", "project manager", "Planner"],
        "locations": [" Aberdeen, UK ", "Aberdeen, UK"],
        "remote_preference": "remote_or_hybrid",
        "seniority_levels": ["senior", "lead"],
        "industries": ["Energy", " energy "],
        "employment_types": ["full_time", "contract"],
        "search_terms": ["Primavera   P6", "primavera p6"],
        "source_preferences": ["linkedin-search", "freehire-search"],
        "recency_days": 30,
        "compensation": {"currency": " gbp ", "minimum": 60000, "period": "year"},
    })

    assert profile["target_roles"] == ["Project Manager", "Planner"]
    assert profile["locations"] == ["Aberdeen, UK"]
    assert profile["industries"] == ["Energy"]
    assert profile["search_terms"] == ["Primavera P6"]
    assert profile["compensation"] == {
        "currency": "GBP", "minimum": 60000, "period": "year",
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("remote_preference", "sometimes"),
        ("seniority_levels", ["wizard"]),
        ("employment_types", ["gig-ish"]),
        ("recency_days", 0),
        ("recency_days", 366),
        ("compensation", {"currency": "pounds", "minimum": 1, "period": "year"}),
        ("compensation", {"currency": "GBP", "minimum": -1, "period": "year"}),
        ("compensation", {"currency": "GBP", "minimum": 1, "period": "weekly"}),
    ],
)
def test_invalid_preferences_are_rejected_deterministically(field, value):
    with pytest.raises(UserProfileValidationError, match=field):
        normalize_user_profile({field: value})


def test_unknown_fields_and_evidence_shaped_fields_are_rejected():
    with pytest.raises(UserProfileValidationError, match="unsupported field"):
        normalize_user_profile({"skills": ["Primavera P6"]})


def test_content_identity_is_stable_for_equivalent_normalized_input():
    first = normalize_user_profile({"target_roles": [" Project   Manager "]})
    second = normalize_user_profile({"target_roles": ["Project Manager"]})

    assert user_profile_content_id(first) == user_profile_content_id(second)
    assert user_profile_content_id(first).startswith("userprofile_")
