"""Confirmation-gated profile proposal workflow."""

import json
from typing import Callable, List

from app.llm.context import ContextBudgetPolicy, ContextDocument
from app.llm.provider import LLMProvider, LLMRequest, generate_structured
from app.llm.validation import parse_json_payload
from app.profile.models import (
    ApprovalPlan,
    ProfileCategory,
    ProfileDocument,
    ProfileProposal,
)


def build_profile_context(documents: List[ProfileDocument], policy: ContextBudgetPolicy) -> str:
    fitted, _ = policy.fit(
        [
            ContextDocument(
                document.path,
                document.content,
                required=document.category == ProfileCategory.HISTORICAL_FACT,
                priority=1 if document.category == ProfileCategory.HISTORICAL_FACT else 5,
            )
            for document in documents
        ]
    )
    return "\n\n".join(f"[{doc.name}]\n{doc.content}" for doc in fitted)


def propose_profile_updates(
    provider: LLMProvider,
    documents: List[ProfileDocument],
    *,
    policy: ContextBudgetPolicy | None = None,
) -> ApprovalPlan:
    policy = policy or ContextBudgetPolicy()
    context = build_profile_context(documents, policy)
    request = LLMRequest(
        system_prompt=(
            "Propose candidate profile updates only. Master CV historical facts are authoritative. "
            "CLAUDE.md is authoritative for application preferences. Never propose replacing a master "
            "CV fact from a preference or model inference. Return a JSON array of proposals."
        ),
        user_prompt=(
            f"{context}\n\nEach proposal must contain field, category, current_value, "
            "proposed_value, source, reasoning, confidence, requires_confirmation."
        ),
        response_format="json",
    )
    raw = generate_structured(provider, request, parse_json_payload)
    if not isinstance(raw, list):
        raise ValueError("Profile proposal response must be a JSON array")
    proposals = []
    for index, item in enumerate(raw, start=1):
        category = ProfileCategory(item["category"])
        if category == ProfileCategory.HISTORICAL_FACT and item.get("source") != "master_cv":
            continue
        proposals.append(
            ProfileProposal(
                item_id=index,
                field=item["field"],
                category=category,
                current_value=item.get("current_value", ""),
                proposed_value=item["proposed_value"],
                source=item["source"],
                reasoning=item["reasoning"],
                confidence=float(item["confidence"]),
                requires_confirmation=True,
            )
        )
    return ApprovalPlan(proposals)


def apply_approved_updates(
    plan: ApprovalPlan,
    approvals: dict[int, str | None],
    apply_update: Callable[[ProfileProposal, str], None],
) -> None:
    """Apply only explicitly approved proposals through a caller-owned writer."""
    for proposal in plan.proposals:
        if proposal.item_id in approvals:
            apply_update(proposal, approvals[proposal.item_id] or proposal.proposed_value)