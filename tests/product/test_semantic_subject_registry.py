"""product/semantic_subject_registry.py: the versioned, product-level
vocabulary of reusable semantic subjects (spec §3). This registry is the
authority on which semantic_subject_key values may ever exist -- the
classifier in decision_policy.py maps text into this vocabulary, but does
not define it."""

from __future__ import annotations

from product.semantic_subject_registry import (
    SEMANTIC_SUBJECT_REGISTRY_VERSION,
    SEMANTIC_SUBJECTS,
    is_valid_semantic_subject,
)


def test_registry_contains_initial_four_subjects():
    assert set(SEMANTIC_SUBJECTS.keys()) == {
        "work_authorization.right_to_work",
        "work_authorization.sponsorship_required",
        "employment.notice_period",
        "licence.driving",
    }


def test_registry_version_is_a_string():
    assert isinstance(SEMANTIC_SUBJECT_REGISTRY_VERSION, str)
    assert SEMANTIC_SUBJECT_REGISTRY_VERSION == "v1"


def test_is_valid_semantic_subject_accepts_registry_keys():
    assert is_valid_semantic_subject("work_authorization.right_to_work") is True


def test_is_valid_semantic_subject_rejects_unknown_key():
    assert is_valid_semantic_subject("not_a_real_subject") is False


def test_is_valid_semantic_subject_rejects_none():
    assert is_valid_semantic_subject(None) is False
