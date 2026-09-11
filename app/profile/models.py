"""Provider-neutral profile records and approval proposals."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ProfileSource(str, Enum):
    MASTER_CV = "master_cv"
    PREFERENCES = "preferences"
    DOCUMENT = "document"
    MODEL_INFERENCE = "model_inference"


class ProfileCategory(str, Enum):
    HISTORICAL_FACT = "historical_fact"
    APPLICATION_PREFERENCE = "application_preference"
    BEHAVIORAL_SIGNAL = "behavioral_signal"
    WRITING_STYLE = "writing_style"


@dataclass(frozen=True)
class ProfileDocument:
    path: str
    content: str
    source: ProfileSource
    category: ProfileCategory


@dataclass
class ProfileProposal:
    item_id: int
    field: str
    category: ProfileCategory
    current_value: str
    proposed_value: str
    source: str
    reasoning: str
    confidence: float
    requires_confirmation: bool = True


@dataclass
class ApprovalPlan:
    proposals: List[ProfileProposal] = field(default_factory=list)

    def render(self) -> str:
        lines = ["## Proposed Profile Updates", ""]
        for proposal in self.proposals:
            lines.extend(
                [
                    f"[{proposal.item_id}] {proposal.field} / {proposal.category.value}",
                    f"Current: {proposal.current_value or '(empty)'}",
                    f"Proposed: {proposal.proposed_value}",
                    f"Source: {proposal.source}",
                    f"Reasoning: {proposal.reasoning} (confidence: {proposal.confidence:.2f})",
                    "",
                ]
            )
        lines.extend(
            [
                "[A] Approve All",
                "[R] Reject All",
                "[Select numbers, e.g., 1, 3] Approve specific items only",
                "[E #] Edit proposed value manually before applying",
            ]
        )
        return "\n".join(lines)


def parse_approval_command(command: str, proposal_count: int) -> Dict[int, Optional[str]]:
    """Parse approval controls without applying any changes."""
    value = command.strip().casefold()
    if value == "a":
        return {item: None for item in range(1, proposal_count + 1)}
    if value == "r" or not value:
        return {}
    if value.startswith("e "):
        payload = command.strip()[2:].strip()
        if "=" not in payload:
            raise ValueError("Edit commands require the item number and replacement value")
        item_text, replacement = payload.split("=", 1)
        item = int(item_text.strip())
        if item < 1 or item > proposal_count or not replacement.strip():
            raise ValueError(f"Unknown or empty proposal edit: {item}")
        return {item: replacement.strip()}
    selected: Dict[int, Optional[str]] = {}
    for token in value.split(","):
        item = int(token.strip())
        if item < 1 or item > proposal_count:
            raise ValueError(f"Unknown proposal item: {item}")
        selected[item] = None
    return selected