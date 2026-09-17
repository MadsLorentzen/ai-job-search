"""Rule-based job-fit evaluation -- the automated counterpart to
`.claude/skills/job-application-assistant/04-job-evaluation.md`.

No LLM calls at runtime (explicit user choice, see the approved plan). This
means Career Alignment stays a coarse keyword proxy, not real judgment about
growth/energy fit -- a flagged limitation with no fix planned.

Behavioral Fit is a partial exception: when a posting carries a third-party
company rating (`JobPosting.company_rating`, e.g. Indeed's 1-5 scale),
supplied by whatever ingested the posting -- the backend has no way to fetch
this itself, MCP-based tools like Indeed's company-data lookup are only
reachable from an interactive Claude Code session, not this standalone
service -- that rating drives a real score with `behavioral_assessed=True`.
Without one, it stays the neutral default, `behavioral_assessed=False`,
same as before. Either way this is still not genuine culture-fit judgment,
just a real external signal instead of no signal at all.
"""

from __future__ import annotations

import json
import subprocess

from rapidfuzz import fuzz

from app import models
from app.services import rubric_config
from app.services.text_utils import contains_phrase

WEIGHTS = {"technical": 0.30, "experience": 0.25, "behavioral": 0.15, "career": 0.30}
BEHAVIORAL_NEUTRAL_SCORE = 50.0
TIER_WEIGHT = {"strong": 3, "moderate": 2, "weak": 1}
TECHNICAL_SATURATION = 15  # raw weighted-match points that saturate the score at 100
CAREER_KEYWORD_SATURATION = 5  # matched career keywords that saturate the score at 100
TITLE_FUZZY_MATCH_THRESHOLD = 55


def score_technical(description: str, skills: list[models.SkillBankEntry]) -> tuple[float, list[str]]:
    matched = [s for s in skills if contains_phrase(description, s.skill)]
    raw = sum(TIER_WEIGHT[s.tier] for s in matched)
    score = min(100.0, round(raw / TECHNICAL_SATURATION * 100, 1))
    return score, [s.skill for s in matched]


def score_experience(job_title: str) -> tuple[float, str]:
    tiers = rubric_config.load_experience_title_tiers()
    tier_score = {"strong": 90.0, "moderate": 70.0, "entry-level": 20.0}
    best_tier, best_ratio, best_phrase = None, 0.0, ""
    for tier, phrases in tiers.items():
        for phrase in phrases:
            # A tier phrase like "Digital Marketing Manager/Specialist" packs two
            # titles into one entry -- compare against each side separately.
            for candidate in phrase.split("/"):
                ratio = fuzz.token_set_ratio(job_title.lower(), candidate.lower())
                if ratio > best_ratio:
                    best_tier, best_ratio, best_phrase = tier, ratio, candidate.strip()
    if best_ratio < TITLE_FUZZY_MATCH_THRESHOLD or best_tier is None:
        return 50.0, "Title didn't clearly match a known tier -- treated as adjacent experience."
    return tier_score[best_tier], f"Matched '{best_phrase}' ({best_tier} tier, {best_ratio:.0f}% similarity)."


def score_behavioral(company_rating: float | None, company_rating_source: str) -> tuple[float, bool, str]:
    if company_rating is None:
        return BEHAVIORAL_NEUTRAL_SCORE, False, "No company rating available -- not independently assessed."
    score = round(min(max(company_rating, 0.0), 5.0) / 5.0 * 100, 1)
    source = company_rating_source or "an unspecified source"
    return (
        score,
        True,
        f"Based on a {company_rating:.1f}/5 employee rating from {source} -- a real external signal, "
        "not genuine culture-fit judgment.",
    )


def score_career_alignment(description: str) -> tuple[float, list[str]]:
    keywords = rubric_config.load_career_alignment_keywords()
    matched = [k for k in keywords if contains_phrase(description, k)]
    score = min(100.0, round(len(matched) / CAREER_KEYWORD_SATURATION * 100, 1))
    return score, matched


def lookup_salary_index(salary_lookup_script: str, company: str, city: str | None) -> float | None:
    cmd = ["python3", salary_lookup_script, company, "--json"]
    if city:
        cmd += ["--city", city]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return data.get("overall_index")


def evaluate_job(
    job: models.JobPosting,
    skills: list[models.SkillBankEntry],
    profile: models.CandidateProfile,
    salary_lookup_script: str | None = None,
) -> dict:
    technical_score, matched_keywords = score_technical(job.raw_description, skills)
    experience_score, experience_note = score_experience(job.title)
    behavioral_score, behavioral_assessed, behavioral_note = score_behavioral(
        job.company_rating, job.company_rating_source
    )
    location_ok, location_note = rubric_config.location_pass(job.location, job.raw_description, job.url)
    career_score, career_keywords = score_career_alignment(job.raw_description)
    employment_note = rubric_config.employment_type_flag(job.raw_description, profile.employment_type_preference)

    salary_index = None
    if salary_lookup_script:
        city = job.location.split(",")[0].strip() if job.location else None
        salary_index = lookup_salary_index(salary_lookup_script, job.company, city)

    overall = (
        technical_score * WEIGHTS["technical"]
        + experience_score * WEIGHTS["experience"]
        + behavioral_score * WEIGHTS["behavioral"]
        + career_score * WEIGHTS["career"]
    )

    combined_location_note = location_note if not employment_note else f"{location_note} {employment_note}"

    return {
        "technical_score": technical_score,
        "experience_score": experience_score,
        "experience_note": experience_note,
        "behavioral_score": behavioral_score,
        "behavioral_assessed": behavioral_assessed,
        "behavioral_note": behavioral_note,
        "location_pass": location_ok,
        "location_note": combined_location_note,
        "career_alignment_score": career_score,
        "salary_index": salary_index,
        "overall_score": round(overall, 1),
        "matched_keywords": matched_keywords,
        "gap_keywords": [],  # requires JD requirement-extraction; out of scope for the rule-based MVP
    }
