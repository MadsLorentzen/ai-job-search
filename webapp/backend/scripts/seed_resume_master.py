"""One-time migration: parse the candidate profile markdown files into
resume_master tables (candidate_profile, skill_bank, experience_entry,
bullet_library, education_entry).

Deliberately contains no hardcoded personal data -- it parses
`.claude/skills/job-application-assistant/01-candidate-profile.md` (identity,
education, experience, skills) and `04-job-evaluation.md` (skill-tier keyword
lists) at run time, so this script stays safe to commit even though its
*output* (webapp/backend/data/app.db) is personal data and is gitignored.

Usage:
    ./.venv/bin/python scripts/seed_resume_master.py [--reset]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PROFILE_MD = REPO_ROOT / ".claude/skills/job-application-assistant/01-candidate-profile.md"
EVALUATION_MD = REPO_ROOT / ".claude/skills/job-application-assistant/04-job-evaluation.md"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.services.text_utils import contains_phrase, split_respecting_parens  # noqa: E402


def _field(text: str, label: str) -> str:
    m = re.search(rf"-\s*\*\*{re.escape(label)}:\*\*\s*(.+)", text)
    return m.group(1).strip() if m else ""


def parse_identity(text: str) -> dict:
    section = text.split("## Identity", 1)[1].split("\n## ", 1)[0]
    return {
        "name": _field(section, "Name"),
        "location": _field(section, "Location"),
        "phone": _field(section, "Phone"),
        "email": _field(section, "Email"),
        "linkedin_url": _field(section, "LinkedIn"),
        "languages": _field(section, "Languages"),
    }


def parse_education(text: str) -> list[dict]:
    section = text.split("## Education", 1)[1].split("\n## ", 1)[0]
    rows = [line for line in section.splitlines() if line.strip().startswith("|")]
    entries = []
    for row in rows[2:]:  # skip header + separator rows
        cells = [c.strip() for c in row.strip("|").split("|")]
        if len(cells) < 4:
            continue
        degree, period, institution, topics = cells[:4]
        entries.append(
            {"degree": degree, "period": period, "institution": institution, "key_topics": topics}
        )
    return entries


def parse_experience(text: str) -> list[dict]:
    section = text.split("## Professional Experience", 1)[1].split("\n## ", 1)[0]
    header_re = re.compile(r"^###\s+(.+?)\s+-\s+(.+?)\s+\(([^)]+)\)\s*$", re.MULTILINE)
    headers = list(header_re.finditer(section))
    entries = []
    for i, m in enumerate(headers):
        title, company, dates = m.group(1), m.group(2), m.group(3)
        start, _, end = dates.partition(" - ")
        block_start = m.end()
        block_end = headers[i + 1].start() if i + 1 < len(headers) else len(section)
        block = section[block_start:block_end].strip("\n")
        lines = block.splitlines()
        location = ""
        bullets = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("- "):
                bullets.append(stripped[2:].strip())
            elif not location:
                location = stripped
        entries.append(
            {
                "title": title,
                "company": company,
                "location": location,
                "start_date": start.strip(),
                "end_date": end.strip() or "Present",
                "bullets": bullets,
            }
        )
    return entries


def parse_skills(text: str) -> list[str]:
    section = text.split("## Technical Skills", 1)[1].split("\n## ", 1)[0]
    skills: set[str] = set()
    for line in section.splitlines():
        stripped = line.strip().lstrip("- ").strip()
        if not stripped or stripped.startswith("#"):
            continue
        # Lines look like "Performance marketing: Google Ads, Google Analytics (GA4), ..."
        # or a bare comma-separated list. Split on ':' first, keep the term list.
        term_list = stripped.split(":", 1)[-1]
        for term in split_respecting_parens(term_list):
            term = re.sub(r"\*\*", "", term).strip()
            term = re.sub(r"\s*\([^)]*\)\s*$", "", term).strip()  # trailing "(GA4)"-style notes
            if term and len(term) > 1:
                skills.add(term)
    return sorted(skills)


def parse_skill_tiers(text: str) -> dict[str, list[str]]:
    tiers = {}
    for tier, label in [("strong", "Strong match areas"), ("moderate", "Moderate match areas"), ("weak", "Weak match areas")]:
        m = re.search(rf"\*\*{label}:\*\*\s*(.+)", text)
        tiers[tier] = [t.strip() for t in split_respecting_parens(m.group(1))] if m else []
    return tiers


def assign_tier(skill: str, tiers: dict[str, list[str]]) -> str:
    # Word-boundary matching in both directions -- plain substring containment
    # false-positives on short tokens (e.g. "Git" inside "Digital").
    for tier in ("strong", "moderate", "weak"):
        for phrase in tiers[tier]:
            if contains_phrase(phrase, skill) or contains_phrase(skill, phrase):
                return tier
    return "moderate"


def main(reset: bool) -> None:
    profile_text = PROFILE_MD.read_text()
    evaluation_text = EVALUATION_MD.read_text()

    identity = parse_identity(profile_text)
    education = parse_education(profile_text)
    experience = parse_experience(profile_text)
    skills = parse_skills(profile_text)
    tiers = parse_skill_tiers(evaluation_text)

    db = SessionLocal()
    try:
        if reset:
            for model in (
                models.BulletLibraryEntry,
                models.ExperienceEntry,
                models.EducationEntry,
                models.SkillBankEntry,
                models.CandidateProfile,
            ):
                db.query(model).delete()
            db.commit()

        if not db.get(models.CandidateProfile, 1):
            db.add(
                models.CandidateProfile(
                    id=1,
                    name=identity["name"],
                    email=identity["email"],
                    phone=identity["phone"],
                    location=identity["location"],
                    linkedin_url=identity["linkedin_url"],
                    languages=identity["languages"],
                    summary="",
                )
            )

        for skill in skills:
            if not db.query(models.SkillBankEntry).filter_by(skill=skill).first():
                db.add(models.SkillBankEntry(skill=skill, tier=assign_tier(skill, tiers)))

        for i, edu in enumerate(education):
            if not db.query(models.EducationEntry).filter_by(degree=edu["degree"], institution=edu["institution"]).first():
                db.add(models.EducationEntry(**edu, sort_order=i))

        for i, exp in enumerate(experience):
            existing = (
                db.query(models.ExperienceEntry)
                .filter_by(title=exp["title"], company=exp["company"])
                .first()
            )
            if existing:
                continue
            entry = models.ExperienceEntry(
                title=exp["title"],
                company=exp["company"],
                location=exp["location"],
                start_date=exp["start_date"],
                end_date=exp["end_date"],
                sort_order=i,
            )
            db.add(entry)
            db.flush()  # assign entry.id
            for j, bullet_text in enumerate(exp["bullets"]):
                keywords = ", ".join(
                    skill for skill in skills if contains_phrase(bullet_text, skill)
                )
                db.add(
                    models.BulletLibraryEntry(
                        experience_id=entry.id, text=bullet_text, keywords=keywords, sort_order=j
                    )
                )

        db.commit()
        print(
            f"Seeded: 1 profile, {len(skills)} skills, {len(education)} education entries, "
            f"{len(experience)} experience entries with "
            f"{sum(len(e['bullets']) for e in experience)} bullets."
        )
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="Delete existing resume_master rows first")
    args = parser.parse_args()
    main(reset=args.reset)
