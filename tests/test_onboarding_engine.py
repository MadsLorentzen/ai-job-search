from __future__ import annotations

import pytest

from product.onboarding import (
    OnboardingTransitionError,
    WalkthroughDefinition,
    WalkthroughStep,
    advance,
    begin,
    complete,
    get_walkthrough,
    go_back,
    initial_progress,
    interrupt,
    register_walkthrough,
    replay,
    resume,
    skip,
)


NOW = "2026-08-27T00:00:00+00:00"
LATER = "2026-08-27T00:05:00+00:00"


def _definition(steps=3, walkthrough_id="test_walkthrough", version=1):
    return WalkthroughDefinition(
        walkthrough_id=walkthrough_id,
        version=version,
        title="Test walkthrough",
        steps=tuple(
            WalkthroughStep(
                step_id=f"step_{i}", target=f"[data-onboarding-target=step-{i}]",
                title=f"Step {i}", body=f"Body {i}",
            )
            for i in range(steps)
        ),
    )


def test_initial_progress_is_not_started_at_step_zero():
    definition = _definition()
    progress = initial_progress(definition, NOW)
    assert progress["status"] == "not_started"
    assert progress["current_step_index"] == 0
    assert progress["times_started"] == 0
    assert progress["times_completed"] == 0


def test_begin_moves_to_in_progress_and_stamps_started_at():
    definition = _definition()
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    assert progress["status"] == "in_progress"
    assert progress["current_step_index"] == 0
    assert progress["started_at"] == NOW
    assert progress["times_started"] == 1


def test_advance_moves_to_next_step():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    assert progress["status"] == "in_progress"
    assert progress["current_step_index"] == 1
    assert progress["last_interacted_at"] == LATER


def test_advance_past_last_step_raises():
    definition = _definition(steps=1)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        advance(progress, definition, LATER)


def test_advance_on_final_step_index_still_requires_explicit_complete():
    # A 1-step walkthrough starts already "on" its only step (index 0).
    # advance() must never silently complete the walkthrough -- the caller
    # (frontend "Finish" button) must call complete() explicitly.
    definition = _definition(steps=1)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    assert progress["current_step_index"] == 0
    assert progress["status"] == "in_progress"


def test_go_back_moves_to_previous_step():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    progress = go_back(progress, definition, LATER)
    assert progress["current_step_index"] == 0


def test_go_back_at_step_zero_raises():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        go_back(progress, definition, LATER)


def test_interrupt_never_changes_status_or_step():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    interrupted = interrupt(progress, LATER)
    assert interrupted["status"] == "in_progress"
    assert interrupted["current_step_index"] == 1
    assert interrupted["last_interacted_at"] == LATER


def test_resume_from_in_progress_is_a_no_op_on_step():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    resumed = resume(progress, definition, LATER)
    assert resumed["status"] == "in_progress"
    assert resumed["current_step_index"] == 1


def test_resume_on_not_started_raises():
    definition = _definition()
    progress = initial_progress(definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        resume(progress, definition, LATER)


def test_complete_sets_completed_status_and_increments_counter():
    definition = _definition(steps=2)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    completed = complete(progress, definition, LATER)
    assert completed["status"] == "completed"
    assert completed["completed_at"] == LATER
    assert completed["times_completed"] == 1


def test_complete_before_reaching_final_step_raises():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        complete(progress, definition, LATER)


def test_skip_sets_skipped_status_with_reason_and_never_marks_completed():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    skipped = skip(progress, definition, LATER, reason="skip")
    assert skipped["status"] == "skipped"
    assert skipped["dismissal_reason"] == "skip"
    assert skipped["times_completed"] == 0


def test_skip_with_dont_show_again_reason():
    definition = _definition()
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    skipped = skip(progress, definition, LATER, reason="dont_show_again")
    assert skipped["dismissal_reason"] == "dont_show_again"


def test_skip_rejects_unknown_reason():
    definition = _definition()
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        skip(progress, definition, LATER, reason="not_a_real_reason")


def test_replay_after_completion_resets_step_but_preserves_completion_count():
    definition = _definition(steps=2)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    progress = complete(progress, definition, LATER)
    replayed = replay(progress, definition, LATER)
    assert replayed["status"] == "in_progress"
    assert replayed["current_step_index"] == 0
    assert replayed["times_completed"] == 1  # history preserved
    assert replayed["times_started"] == 2  # replay counts as a new start


def test_replay_after_skip_also_works():
    definition = _definition()
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    skipped = skip(progress, definition, LATER, reason="skip")
    replayed = replay(skipped, definition, LATER)
    assert replayed["status"] == "in_progress"
    assert replayed["current_step_index"] == 0


def test_registry_round_trip():
    definition = _definition(walkthrough_id="registry_test_walkthrough")
    register_walkthrough(definition)
    assert get_walkthrough("registry_test_walkthrough") is definition


def test_get_unknown_walkthrough_raises_key_error():
    with pytest.raises(KeyError):
        get_walkthrough("does_not_exist_walkthrough_id")
