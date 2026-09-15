"""product/semantic_subject_registry.py: the versioned, product-level
vocabulary of reusable semantic subjects (spec §3). This registry is the
authority on which semantic_subject_key values may ever exist -- the
classifier (classify_semantic_subject, also in this module as of a
corrective follow-up fix) maps text into this vocabulary, but does not
define it."""

from __future__ import annotations

from product.semantic_subject_registry import (
    SEMANTIC_SUBJECT_REGISTRY_VERSION,
    SEMANTIC_SUBJECTS,
    classify_semantic_subject,
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


def test_classify_semantic_subject_is_same_object_from_both_import_paths():
    """Fix #1 (layering correction): classify_semantic_subject must be
    ONE function, reachable identically from both of its callers --
    webapp/services/decision_policy.py (backward-compat re-export for
    existing callers) and product/semantic_subject_registry.py itself
    (the new home, and what product/semantic_job_fit.py imports directly
    as a same-layer product-to-product import). This proves the two
    call sites can never silently diverge into two separate
    implementations: webapp.services.decision_policy.classify_semantic_subject
    is a plain import of this module's function, not a second
    definition."""

    from webapp.services.decision_policy import (
        classify_semantic_subject as classify_semantic_subject_via_webapp,
    )

    assert classify_semantic_subject_via_webapp is classify_semantic_subject
