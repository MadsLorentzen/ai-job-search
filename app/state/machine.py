"""Explicit workflow transitions."""

from datetime import datetime, timezone
from typing import Dict, Set

from app.state.models import (
    ApplicationStatus,
    FailureStage,
    WorkflowStage,
    WorkflowState,
)


VALID_TRANSITIONS: Dict[WorkflowStage, Set[WorkflowStage]] = {
    WorkflowStage.DISCOVERED: {WorkflowStage.NORMALIZED},
    WorkflowStage.NORMALIZED: {WorkflowStage.FILTERED},
    WorkflowStage.FILTERED: {WorkflowStage.RANKED},
    WorkflowStage.RANKED: {WorkflowStage.SHORTLISTED},
    WorkflowStage.SHORTLISTED: {WorkflowStage.ANALYZING},
    WorkflowStage.ANALYZING: {WorkflowStage.DRAFTING},
    WorkflowStage.DRAFTING: {WorkflowStage.REVIEWING},
    WorkflowStage.REVIEWING: {WorkflowStage.DRAFTING, WorkflowStage.READY_FOR_APPROVAL},
    WorkflowStage.READY_FOR_APPROVAL: {WorkflowStage.COMPILING},
    WorkflowStage.COMPILING: {WorkflowStage.VALIDATING},
    WorkflowStage.VALIDATING: {WorkflowStage.READY_TO_ARCHIVE},
    WorkflowStage.READY_TO_ARCHIVE: {WorkflowStage.ARCHIVED},
    WorkflowStage.ARCHIVED: set(),
}


class StateMachine:
    def __init__(self, state: WorkflowState):
        self.state = state

    def transition_to(
        self,
        next_stage: WorkflowStage,
        status: ApplicationStatus = ApplicationStatus.RUNNING,
    ) -> WorkflowState:
        if next_stage not in VALID_TRANSITIONS.get(self.state.stage, set()):
            raise ValueError(
                f"Invalid transition from '{self.state.stage.value}' "
                f"to '{next_stage.value}'"
            )
        self.state.stage = next_stage
        self.state.status = status
        self.state.timestamps[next_stage.value] = datetime.now(timezone.utc).isoformat()
        return self.state

    def mark_failed(self, failure_type: FailureStage, reason: str) -> WorkflowState:
        self.state.status = ApplicationStatus.FAILED
        self.state.errors.append(f"[{failure_type.value}] {reason}")
        self.state.timestamps[f"failed_{failure_type.value}"] = (
            datetime.now(timezone.utc).isoformat()
        )
        return self.state