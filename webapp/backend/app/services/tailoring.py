"""Rule-based resume tailoring: select and lightly adapt existing resume
content for a specific job, without an LLM to exercise judgment.

Anti-fabrication by construction (per the approved plan): this module may
only SELECT which pre-written bullets to include, and SWAP in a synonym only
when the candidate's own skill bank already asserts they're equivalent
(`SkillBankEntry.synonyms`, curated by the user via the dashboard). It never
generates new sentences.
"""

from __future__ import annotations

import re

from app import models
from app.services.text_utils import contains_phrase

MAX_TOTAL_BULLETS = 24  # tuned against a real render: 16 left ~50% of page 2 blank, see Phase 3 notes
MAX_BULLETS_PER_ROLE = 5
MIN_BULLETS_PER_ROLE = 1


def _bullet_relevance(bullet: models.BulletLibraryEntry, matched_keywords: set[str]) -> int:
    bullet_keywords = {k.strip() for k in bullet.keywords.split(",") if k.strip()}
    return len(bullet_keywords & matched_keywords)


def select_bullets(
    experience_entries: list[models.ExperienceEntry],
    matched_keywords: list[str],
) -> dict[int, list[models.BulletLibraryEntry]]:
    """Returns experience_id -> selected bullets, in each role's original
    (already-narrative-ordered) sequence -- selection decides WHICH bullets
    make the cut, never reorders bullets within a role.
    """
    matched_set = set(matched_keywords)
    roles = sorted(experience_entries, key=lambda e: e.sort_order)

    scored: dict[int, list[tuple[int, models.BulletLibraryEntry]]] = {}
    for role in roles:
        bullets = sorted(role.bullets, key=lambda b: b.sort_order)
        scored[role.id] = [(_bullet_relevance(b, matched_set), b) for b in bullets]

    selected_ids: set[int] = set()
    budget = MAX_TOTAL_BULLETS

    # Pass 1: guarantee up to MIN_BULLETS_PER_ROLE highest-scoring bullet(s)
    # per role (most recent roles first) so no role vanishes entirely.
    for role in roles:
        if budget <= 0:
            break
        candidates = sorted(scored[role.id], key=lambda sb: -sb[0])[:MIN_BULLETS_PER_ROLE]
        for _, bullet in candidates:
            if budget <= 0:
                break
            selected_ids.add(bullet.id)
            budget -= 1

    # Pass 2: fill remaining budget by score across all roles, respecting the
    # per-role cap, preferring more recent roles on ties (roles is already
    # recency-ordered, and Python's sort is stable).
    remaining_candidates = []
    for role in roles:
        for score, bullet in scored[role.id]:
            if bullet.id not in selected_ids:
                remaining_candidates.append((score, role, bullet))
    remaining_candidates.sort(key=lambda item: -item[0])

    per_role_count = {role.id: sum(1 for b in role.bullets if b.id in selected_ids) for role in roles}
    for score, role, bullet in remaining_candidates:
        if budget <= 0:
            break
        if per_role_count[role.id] >= MAX_BULLETS_PER_ROLE:
            continue
        selected_ids.add(bullet.id)
        per_role_count[role.id] += 1
        budget -= 1

    return {
        role.id: [b for b in sorted(role.bullets, key=lambda b: b.sort_order) if b.id in selected_ids]
        for role in roles
    }


def apply_synonym_swaps(bullet_text: str, matched_keywords: list[str], skills: list[models.SkillBankEntry]) -> str:
    """Swap a synonym phrase for the JD's exact matched term, but only when
    the candidate's skill bank already asserts the synonym IS that skill.
    Never introduces a claim that wasn't already true and already matched.
    """
    matched_set = set(matched_keywords)
    for skill in skills:
        if skill.skill not in matched_set or not skill.synonyms:
            continue
        if contains_phrase(bullet_text, skill.skill):
            continue  # canonical term already present, nothing to swap
        for synonym in (s.strip() for s in skill.synonyms.split(",")):
            if synonym and contains_phrase(bullet_text, synonym):
                bullet_text = re.sub(
                    rf"\b{re.escape(synonym)}\b", skill.skill, bullet_text, count=1, flags=re.IGNORECASE
                )
                break
    return bullet_text


def top_bullets(experience_entries: list[models.ExperienceEntry], matched_keywords: list[str], n: int = 2) -> list[str]:
    """Highest-relevance bullets across all roles, for the cover letter's
    highlight paragraphs -- reuses the same relevance signal as bullet
    selection so the letter doesn't contradict what the resume emphasizes.
    """
    matched_set = set(matched_keywords)
    scored = [
        (_bullet_relevance(b, matched_set), role.sort_order, b)
        for role in experience_entries
        for b in role.bullets
    ]
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [b.text for _, _, b in scored[:n]]


def build_resume_content(
    profile: models.CandidateProfile,
    experience_entries: list[models.ExperienceEntry],
    education_entries: list[models.EducationEntry],
    skills: list[models.SkillBankEntry],
    matched_keywords: list[str],
) -> dict:
    selected = select_bullets(experience_entries, matched_keywords)
    experience_out = []
    selected_bullet_ids: list[int] = []
    for role in sorted(experience_entries, key=lambda e: e.sort_order):
        bullets = selected.get(role.id, [])
        bullet_texts = [apply_synonym_swaps(b.text, matched_keywords, skills) for b in bullets]
        selected_bullet_ids.extend(b.id for b in bullets)
        experience_out.append(
            {
                "title": role.title,
                "company": role.company,
                "location": role.location,
                "start_date": role.start_date,
                "end_date": role.end_date,
                "bullets": bullet_texts,
            }
        )

    return {
        "profile": profile,
        "experience": experience_out,
        "education": sorted(education_entries, key=lambda e: e.sort_order),
        "skills": sorted({s.skill for s in skills if s.tier in ("strong", "moderate")}),
        "selected_bullet_ids": selected_bullet_ids,
    }
