"""Core pipeline operations (evaluate / tailor / apply), extracted so the
manual API routes and the autonomous scheduler call the exact same logic --
two independently-maintained copies would inevitably drift.

Raises `PipelineError` for expected, caller-facing failures (missing profile,
job not evaluated yet, etc.) so each caller can translate it appropriately:
the API layer turns it into an HTTPException, the scheduler catches it and
logs an ApplicationEvent instead of crashing the whole cycle over one bad job.
"""

from __future__ import annotations

import datetime as dt
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from app import models
from app.services import rendering, tailoring
from app.services.ats_validator import validate_resume_pdf
from app.services.automation.dispatcher import dispatch
from app.services.discovery import discover_jobs
from app.services.evaluation_engine import evaluate_job
from app.services.rubric_config import REPO_ROOT
from app.services.text_utils import humanize_list

ARCHIVE_DIR = rendering.DATA_DIR / "submitted_archive"

SALARY_LOOKUP_SCRIPT = str(REPO_ROOT / "salary_lookup.py")


class PipelineError(Exception):
    pass


def run_discovery(db: Session, user_id: int) -> dict:
    return discover_jobs(db, user_id)


def evaluate_unevaluated_jobs(db: Session, user_id: int) -> int:
    profile = db.query(models.CandidateProfile).filter_by(user_id=user_id).first()
    if not profile:
        return 0
    skills = db.query(models.SkillBankEntry).filter_by(user_id=user_id).all()
    unevaluated = (
        db.query(models.JobPosting)
        .filter_by(user_id=user_id)
        .outerjoin(models.Evaluation)
        .filter(models.Evaluation.id.is_(None))
        .all()
    )
    for job in unevaluated:
        result = evaluate_job(job, skills, profile, salary_lookup_script=SALARY_LOOKUP_SCRIPT)
        db.add(models.Evaluation(job_id=job.id, **result))
    db.commit()
    return len(unevaluated)


def tailor_job(
    db: Session, job_id: int, user_id: int
) -> tuple[models.ResumeVariant, models.CoverLetterVariant, models.Application]:
    job = db.query(models.JobPosting).filter_by(id=job_id, user_id=user_id).first()
    if not job:
        raise PipelineError("Job not found")
    evaluation = db.query(models.Evaluation).filter_by(job_id=job_id).first()
    if not evaluation:
        raise PipelineError("Job must be evaluated before tailoring")
    profile = db.query(models.CandidateProfile).filter_by(user_id=user_id).first()
    if not profile:
        raise PipelineError("Candidate profile not seeded yet")

    skills = db.query(models.SkillBankEntry).filter_by(user_id=user_id).all()
    experience = (
        db.query(models.ExperienceEntry).filter_by(user_id=user_id).order_by(models.ExperienceEntry.sort_order).all()
    )
    education = (
        db.query(models.EducationEntry).filter_by(user_id=user_id).order_by(models.EducationEntry.sort_order).all()
    )
    matched_keywords = evaluation.matched_keywords

    content = tailoring.build_resume_content(profile, experience, education, skills, matched_keywords)
    resume_html_path, resume_pdf_path = rendering.resume_paths(job_id)
    resume_html = rendering.render_html("resume.html.jinja", content)
    resume_html_path.parent.mkdir(parents=True, exist_ok=True)
    resume_html_path.write_text(resume_html)
    rendering.html_to_pdf(resume_html, resume_pdf_path)

    ats_result = validate_resume_pdf(resume_pdf_path, profile.email, profile.phone, matched_keywords)

    resume_variant = (
        db.query(models.ResumeVariant).filter_by(job_id=job_id).order_by(models.ResumeVariant.id.desc()).first()
    )
    if not resume_variant:
        resume_variant = models.ResumeVariant(job_id=job_id)
        db.add(resume_variant)
    resume_variant.selected_bullet_ids = content["selected_bullet_ids"]
    resume_variant.html_path = str(resume_html_path)
    resume_variant.pdf_path = str(resume_pdf_path)
    resume_variant.ats_validation = ats_result
    # If pdftotext isn't installed, "available" is False and we can't verify --
    # don't silently mark it ready on an unverified assumption.
    resume_variant.is_ready = bool(ats_result.get("pass")) if ats_result.get("available") else False
    db.flush()  # populate resume_variant.id for the Application FK below

    top_bullets = tailoring.top_bullets(experience, matched_keywords, n=2)
    merge_fields = {
        "greeting": "Dear Hiring Manager",
        "date": dt.date.today().isoformat(),
        "role": job.title,
        "company": job.company,
        "background_summary": humanize_list(matched_keywords[:3]) or "digital marketing and marketing operations",
        "highlighted_bullets": top_bullets,
    }
    cover_html = rendering.render_html("cover_letter.html.jinja", {"profile": profile, **merge_fields})
    cover_html_path, cover_pdf_path = rendering.cover_letter_paths(job_id)
    cover_html_path.parent.mkdir(parents=True, exist_ok=True)
    cover_html_path.write_text(cover_html)
    rendering.html_to_pdf(cover_html, cover_pdf_path)

    cover_variant = (
        db.query(models.CoverLetterVariant)
        .filter_by(job_id=job_id)
        .order_by(models.CoverLetterVariant.id.desc())
        .first()
    )
    if not cover_variant:
        cover_variant = models.CoverLetterVariant(job_id=job_id)
        db.add(cover_variant)
    cover_variant.template_name = "default"
    cover_variant.merge_fields = merge_fields
    cover_variant.pdf_path = str(cover_pdf_path)
    db.flush()

    application = db.query(models.Application).filter_by(job_id=job_id).first()
    if not application:
        application = models.Application(job_id=job_id)
        db.add(application)
    application.resume_variant_id = resume_variant.id
    application.cover_letter_variant_id = cover_variant.id
    application.status = "ready" if resume_variant.is_ready else "needs_manual"
    application.error_detail = (
        "" if resume_variant.is_ready else "ATS validation failed or unverified -- see resume_variant.ats_validation."
    )

    db.commit()
    db.refresh(resume_variant)
    db.refresh(cover_variant)
    db.refresh(application)
    return resume_variant, cover_variant, application


def _archive_submitted_pdf(job_id: int, source_path: str, label: str) -> str:
    """Copies the exact PDF that's about to be submitted into a permanent,
    never-overwritten archive path. resume_variant.pdf_path/
    cover_letter_variant.pdf_path get overwritten in place on every
    re-tailor, so without a copy taken at the moment of submission there is
    no way to reconstruct after the fact what was actually sent.
    """
    if not source_path or not Path(source_path).exists():
        return ""
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = ARCHIVE_DIR / f"{job_id}_{timestamp}_{label}.pdf"
    shutil.copy2(source_path, dest)
    return str(dest)


def apply_to_job(db: Session, job_id: int, user_id: int) -> models.Application:
    job = db.query(models.JobPosting).filter_by(id=job_id, user_id=user_id).first()
    if not job:
        raise PipelineError("Job not found")
    application = db.query(models.Application).filter_by(job_id=job_id).first()
    if not application:
        raise PipelineError("No application record for this job -- tailor it first")
    if application.status != "ready":
        raise PipelineError(
            f"Application status is '{application.status}', expected 'ready'. "
            "Tailor the job (and resolve any needs_manual issue) first."
        )

    resume_variant = db.get(models.ResumeVariant, application.resume_variant_id)
    cover_letter_variant = db.get(models.CoverLetterVariant, application.cover_letter_variant_id)
    profile = db.query(models.CandidateProfile).filter_by(user_id=user_id).first()
    qa_bank = db.query(models.QABankEntry).filter_by(user_id=user_id).all()
    settings = db.query(models.Settings).filter_by(user_id=user_id).first()
    dry_run = settings.dry_run if settings else True  # fail safe if Settings row doesn't exist yet

    result = dispatch(job, resume_variant.pdf_path, cover_letter_variant.pdf_path, profile, qa_bank, dry_run, user_id)

    db.add(models.ApplicationEvent(job_id=job_id, event_type=f"apply_{result.status}", detail=result.detail))

    if result.status == "applied":
        application.status = "applied"
        application.method = job.detected_platform
        application.submitted_at = dt.datetime.now(dt.timezone.utc)
        application.error_detail = ""
        application.submitted_resume_path = _archive_submitted_pdf(job_id, resume_variant.pdf_path, "resume")
        application.submitted_cover_letter_path = _archive_submitted_pdf(
            job_id, cover_letter_variant.pdf_path, "cover_letter"
        )
    elif result.status == "dry_run_ready":
        application.status = "ready"  # unchanged -- a dry run never counts as submitted
        application.error_detail = f"[dry run] {result.detail}"
    elif result.status == "needs_manual":
        application.status = "needs_manual"
        application.error_detail = result.detail
    else:
        application.status = "failed"
        application.error_detail = result.detail

    db.commit()
    db.refresh(application)
    return application
