from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class OnboardingTransitionError(Exception):
    """Raised when a walkthrough state transition is not legal from the
    current state. The caller (service layer / API) is responsible for
    translating this into a 4xx response -- the engine itself has no
    knowledge of HTTP."""


_VALID_DISMISSAL_REASONS = frozenset({"skip", "dont_show_again", "close"})


@dataclass(frozen=True)
class WalkthroughStep:
    step_id: str
    target: str
    title: str
    body: str
    placement: str = "auto"


@dataclass(frozen=True)
class WalkthroughDefinition:
    walkthrough_id: str
    version: int
    title: str
    steps: tuple[WalkthroughStep, ...]
    trigger: str | None = None

    def __post_init__(self) -> None:
        if not self.steps:
            raise ValueError("a walkthrough must have at least one step")


def initial_progress(definition: WalkthroughDefinition, now: str) -> dict[str, Any]:
    return {
        "walkthrough_version": definition.version,
        "status": "not_started",
        "current_step_index": 0,
        "dismissal_reason": None,
        "started_at": None,
        "last_interacted_at": now,
        "completed_at": None,
        "times_completed": 0,
        "times_started": 0,
    }


def begin(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    if progress["status"] == "in_progress":
        raise OnboardingTransitionError("walkthrough is already in progress")
    return {
        **progress,
        "walkthrough_version": definition.version,
        "status": "in_progress",
        "current_step_index": 0,
        "dismissal_reason": None,
        "started_at": now,
        "last_interacted_at": now,
        "times_started": progress["times_started"] + 1,
    }


def advance(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    _require_in_progress(progress)
    next_index = progress["current_step_index"] + 1
    if next_index >= len(definition.steps):
        raise OnboardingTransitionError(
            "no further step to advance to; call complete() on the final step"
        )
    return {
        **progress,
        "current_step_index": next_index,
        "last_interacted_at": now,
    }


def go_back(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    _require_in_progress(progress)
    if progress["current_step_index"] == 0:
        raise OnboardingTransitionError("already at the first step")
    return {
        **progress,
        "current_step_index": progress["current_step_index"] - 1,
        "last_interacted_at": now,
    }


def interrupt(progress: dict[str, Any], now: str) -> dict[str, Any]:
    # Deliberately a near no-op: interruption (nav away, reload, close)
    # must never change status or step. It only records that contact
    # happened, so "resume" has a timestamp to reason about.
    return {**progress, "last_interacted_at": now}


def resume(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    if progress["status"] != "in_progress":
        raise OnboardingTransitionError(
            "only an in_progress walkthrough can be resumed"
        )
    return {**progress, "last_interacted_at": now}


def complete(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    _require_in_progress(progress)
    if progress["current_step_index"] != len(definition.steps) - 1:
        raise OnboardingTransitionError(
            "cannot complete before reaching the final step"
        )
    return {
        **progress,
        "status": "completed",
        "dismissal_reason": None,
        "last_interacted_at": now,
        "completed_at": now,
        "times_completed": progress["times_completed"] + 1,
    }


def skip(
    progress: dict[str, Any],
    definition: WalkthroughDefinition,
    now: str,
    *,
    reason: str,
) -> dict[str, Any]:
    _require_in_progress(progress)
    if reason not in _VALID_DISMISSAL_REASONS:
        raise OnboardingTransitionError(f"unknown dismissal reason: {reason!r}")
    return {
        **progress,
        "status": "skipped",
        "dismissal_reason": reason,
        "last_interacted_at": now,
    }


def replay(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    if progress["status"] not in ("completed", "skipped"):
        raise OnboardingTransitionError(
            "only a completed or skipped walkthrough can be replayed"
        )
    return {
        **progress,
        "walkthrough_version": definition.version,
        "status": "in_progress",
        "current_step_index": 0,
        "dismissal_reason": None,
        "started_at": now,
        "last_interacted_at": now,
        "times_started": progress["times_started"] + 1,
    }


def _require_in_progress(progress: dict[str, Any]) -> None:
    if progress["status"] != "in_progress":
        raise OnboardingTransitionError(
            f"walkthrough must be in_progress for this transition, "
            f"got {progress['status']!r}"
        )


WALKTHROUGH_REGISTRY: dict[str, WalkthroughDefinition] = {}


def register_walkthrough(definition: WalkthroughDefinition) -> None:
    WALKTHROUGH_REGISTRY[definition.walkthrough_id] = definition


def get_walkthrough(walkthrough_id: str) -> WalkthroughDefinition:
    return WALKTHROUGH_REGISTRY[walkthrough_id]
