"""Structured STAR interview preparation through the local provider."""

from dataclasses import dataclass
from typing import List

from app.llm.context import ContextBudgetPolicy, ContextDocument
from app.llm.provider import LLMProvider, LLMRequest, generate_structured
from app.llm.validation import parse_json_payload


@dataclass
class STARAnswer:
    question: str
    situation: str
    task: str
    action: str
    result: str


def build_interview_prep(
    provider: LLMProvider,
    posting: str,
    profile: str,
    *,
    policy: ContextBudgetPolicy | None = None,
) -> List[STARAnswer]:
    policy = policy or ContextBudgetPolicy()
    documents, _ = policy.fit([
        ContextDocument("job_posting", posting, required=True),
        ContextDocument("candidate_profile", profile, required=True),
    ])
    context = "\n\n".join(f"[{doc.name}]\n{doc.content}" for doc in documents)
    response = generate_structured(
        provider,
        LLMRequest(
            system_prompt="Create honest interview preparation. Return JSON array only. Never invent facts.",
            user_prompt=f"{context}\n\nReturn STAR answers with question, situation, task, action, result.",
            response_format="json",
        ),
        parse_json_payload,
    )
    if not isinstance(response, list):
        raise ValueError("Interview preparation must be a JSON array")
    return [STARAnswer(**item) for item in response]