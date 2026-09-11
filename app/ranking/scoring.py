"""Deterministic score aggregation for LLM-provided evidence."""

from dataclasses import dataclass, field
from typing import Iterable

from app.jobs.models import Job


@dataclass
class RankingEvidence:
    technical_score: int
    experience_score: int
    behavioral_score: int
    career_score: int
    strengths: list[str] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    hard_vetoes: list[str] = field(default_factory=list)
    eligibility: str = "unknown"


@dataclass
class RankingResult:
    job_id: str
    overall_score: float
    tier: str
    eligible: bool
    evidence: RankingEvidence


WEIGHTS = {"technical": 0.30, "experience": 0.25, "behavioral": 0.15, "career": 0.30}


def _clamp(score: int) -> int:
    return max(0, min(100, int(score)))


def rank_job(job: Job, evidence: RankingEvidence) -> RankingResult:
    scores = {
        "technical": _clamp(evidence.technical_score),
        "experience": _clamp(evidence.experience_score),
        "behavioral": _clamp(evidence.behavioral_score),
        "career": _clamp(evidence.career_score),
    }
    score = round(sum(scores[name] * weight for name, weight in WEIGHTS.items()), 2)
    eligible = evidence.eligibility != "fail" and not evidence.hard_vetoes
    if not eligible:
        tier = "ineligible"
    elif score >= 75:
        tier = "strong_fit"
    elif score >= 60:
        tier = "good_fit"
    elif score >= 45:
        tier = "moderate_fit"
    elif score >= 30:
        tier = "weak_fit"
    else:
        tier = "poor_fit"
    return RankingResult(job.job_id, score, tier, eligible, evidence)