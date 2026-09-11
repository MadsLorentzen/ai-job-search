"""Typed application artifacts and review findings."""

from dataclasses import dataclass, field
from typing import List


@dataclass
class FitEvaluation:
    technical_score: int
    experience_score: int
    behavioral_score: int
    career_score: int
    strengths: List[str] = field(default_factory=list)
    gaps: List[str] = field(default_factory=list)
    recommendation: str = "review"


@dataclass
class DraftBundle:
    cv_source: str
    cover_letter_source: str


@dataclass
class ReviewIssue:
    severity: str
    category: str
    file: str
    description: str
    evidence: str = ""


@dataclass
class ReviewResult:
    approved: bool
    issues: List[ReviewIssue] = field(default_factory=list)
    fabrication_flags: List[str] = field(default_factory=list)
    ats_issues: List[str] = field(default_factory=list)
    missing_requirements: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)