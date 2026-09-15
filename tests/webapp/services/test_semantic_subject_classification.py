"""classify_semantic_subject: maps gate requirement text to a
product/semantic_subject_registry.py key, or None. Phase 4C spec §3
rules 1-5."""

from __future__ import annotations

from webapp.services.decision_policy import classify_semantic_subject


def test_right_to_work_text_classifies():
    assert classify_semantic_subject(
        "gate_flag", ["Must have the right to work in the UK."]
    ) == "work_authorization.right_to_work"


def test_sponsorship_text_classifies():
    assert classify_semantic_subject(
        "gate_flag", ["Visa sponsorship is not available for this role."]
    ) == "work_authorization.sponsorship_required"


def test_driving_licence_text_classifies():
    assert classify_semantic_subject(
        "gate_flag", ["A valid driving licence is required."]
    ) == "licence.driving"


def test_notice_period_text_classifies():
    assert classify_semantic_subject(
        "gate_flag", ["A maximum notice period of one month is required."]
    ) == "employment.notice_period"


def test_dimension_blocker_never_classifies():
    # Rule 1: dimension blockers never receive a semantic subject key in
    # Phase 4C, even if the text looks stable-fact-shaped.
    assert classify_semantic_subject(
        "dimension", ["Must have the right to work in the UK."]
    ) is None


def test_multi_fact_text_fails_restrictive():
    # Rule 3: a single sentence matching more than one registry family
    # classifies to None, not to either family.
    assert classify_semantic_subject(
        "gate_flag",
        ["Must have the right to work in the UK and hold a valid driving licence."],
    ) is None


def test_attestation_action_text_fails_restrictive():
    # Rule 4: employer-specific attestation framing excludes the text
    # before any registry-family match is even attempted.
    assert classify_semantic_subject(
        "gate_flag",
        ["Please disclose any prior visa violations for our compliance review."],
    ) is None


def test_unrecognized_text_classifies_to_none():
    assert classify_semantic_subject(
        "gate_flag", ["Candidates must sign this employer's specific disclosure form."]
    ) is None


def test_empty_texts_classify_to_none():
    assert classify_semantic_subject("gate_flag", []) is None
