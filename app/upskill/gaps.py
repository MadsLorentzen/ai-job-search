"""Extract skill gaps before asking the model for learning advice."""

from dataclasses import dataclass
from typing import List

from app.llm.context import ContextBudgetPolicy, ContextDocument
from app.llm.provider import LLMProvider, LLMRequest, generate_structured
from app.llm.validation import parse_json_payload


@dataclass
class SkillGap:
    skill: str
    source: str
    required: bool = True


def extract_skill_gaps(profile: str, posting: str, skills: List[str]) -> List[SkillGap]:
    profile_text = profile.casefold()
    return [
        SkillGap(skill=skill, source="posting", required=True)
        for skill in skills
        if skill and skill.casefold() not in profile_text
    ]


def synthesize_learning_plan(
    provider: LLMProvider,
    profile: str,
    posting: str,
    gaps: List[SkillGap],
    *,
    policy: ContextBudgetPolicy | None = None,
) -> list[dict]:
    policy = policy or ContextBudgetPolicy()
    documents, _ = policy.fit([
        ContextDocument("profile", profile, required=True),
        ContextDocument("posting", posting, required=True),
        ContextDocument("deterministic_gaps", "\n".join(gap.skill for gap in gaps), required=True),
    ])
    context = "\n\n".join(f"[{doc.name}]\n{doc.content}" for doc in documents)
    response = generate_structured(
        provider,
        LLMRequest(
            system_prompt="Synthesize a realistic learning plan from supplied gaps. Return JSON array only.",
            user_prompt=f"{context}\n\nEach item must contain skill, priority, study_direction, estimated_hours.",
            response_format="json",
        ),
        parse_json_payload,
    )
    if not isinstance(response, list):
        raise ValueError("Learning plan must be a JSON array")
    return response