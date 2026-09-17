from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.database import get_db
from app.services import auth as auth_service
from app.services.automation.base import detect_platform_from_url
from app.services.manual_add import (
    clean_job_title,
    fetch_page_text,
    guess_company_from_title,
    parse_workday_url_hints,
)
from app.services.pipeline import PipelineError, evaluate_unevaluated_jobs, run_discovery, tailor_job

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class ManualJobCreate(BaseModel):
    url: str
    company: str | None = None
    title: str | None = None
    location: str = ""
    # When the caller already has real data (e.g. pulled via an MCP job-search
    # tool in an interactive session -- the backend itself can't reach those),
    # supplying it here skips the best-effort page fetch entirely rather than
    # re-deriving worse data from a plain GET.
    raw_description: str | None = None
    employment_type: str = ""
    source_portal: str = "manual"
    company_rating: float | None = None
    company_rating_source: str = ""


def _create_job_from_payload(db: Session, payload: ManualJobCreate, user_id: int) -> models.JobPosting | None:
    """Returns None (rather than raising) for a duplicate URL *within this
    user's own jobs*, so bulk-import can skip-and-count instead of failing
    the whole batch on one repeat. Two different users discovering the same
    real posting is allowed -- the uniqueness is (user_id, url), not url alone.
    """
    if db.query(models.JobPosting).filter_by(url=payload.url, user_id=user_id).first():
        return None

    page_title, page_text = "", payload.raw_description or ""
    if not payload.raw_description:
        try:
            page_title, page_text = fetch_page_text(payload.url)
        except Exception:
            pass  # best-effort -- proceed with whatever the caller supplied, if anything

    # Workday postings are a JS-rendered SPA -- a plain GET returns an empty
    # shell (confirmed live), so page_title/page_text end up blank. Workday's
    # URL structure is consistent enough to recover company/title/location
    # from the URL itself in that case.
    wd_company, wd_title, wd_location = "", "", ""
    if not page_title and not page_text:
        wd_company, wd_title, wd_location = parse_workday_url_hints(payload.url)

    job = models.JobPosting(
        user_id=user_id,
        source_portal=payload.source_portal,
        url=payload.url,
        company=payload.company or guess_company_from_title(page_title) or wd_company or "Unknown",
        title=payload.title or clean_job_title(page_title) or wd_title or "Unknown",
        location=payload.location or wd_location,
        employment_type=payload.employment_type,
        raw_description=page_text,
        detected_platform=detect_platform_from_url(payload.url, default="other"),
        company_rating=payload.company_rating,
        company_rating_source=payload.company_rating_source,
    )
    db.add(job)
    return job


@router.post("/discover")
def discover(
    evaluate: bool = True,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    stats = run_discovery(db, current_user.id)
    evaluated = evaluate_unevaluated_jobs(db, current_user.id) if evaluate else 0
    return {**stats, "evaluated": evaluated}


@router.post("/manual", response_model=schemas.JobPostingSchema)
def add_manual_job(
    payload: ManualJobCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    job = _create_job_from_payload(db, payload, current_user.id)
    if job is None:
        raise HTTPException(409, "This job URL is already tracked")
    db.commit()
    evaluate_unevaluated_jobs(db, current_user.id)
    db.refresh(job)
    return job


@router.post("/bulk-import")
def bulk_import_jobs(
    payload: list[ManualJobCreate],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    created, skipped = 0, 0
    for item in payload:
        job = _create_job_from_payload(db, item, current_user.id)
        if job is None:
            skipped += 1
        else:
            created += 1
    db.commit()
    evaluated = evaluate_unevaluated_jobs(db, current_user.id)
    return {"created": created, "skipped_duplicates": skipped, "evaluated": evaluated}


@router.get("", response_model=list[schemas.JobPostingSchema])
def list_jobs(
    min_score: float | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    query = (
        db.query(models.JobPosting)
        .filter(models.JobPosting.user_id == current_user.id)
        .options(joinedload(models.JobPosting.evaluation))
    )
    if status:
        query = query.join(models.Application).filter(models.Application.status == status)
    jobs = query.order_by(models.JobPosting.discovered_at.desc()).all()
    if min_score is not None:
        jobs = [j for j in jobs if j.evaluation and j.evaluation.overall_score >= min_score]
    return jobs


@router.get("/{job_id}", response_model=schemas.JobPostingSchema)
def get_job(
    job_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    job = db.query(models.JobPosting).filter_by(id=job_id, user_id=current_user.id).first()
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.post("/{job_id}/tailor", response_model=schemas.TailorResultSchema)
def tailor(
    job_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    try:
        resume_variant, cover_variant, application = tailor_job(db, job_id, current_user.id)
    except PipelineError as e:
        code = 404 if "not found" in str(e).lower() else 409
        raise HTTPException(code, str(e))
    return schemas.TailorResultSchema(
        resume_variant=resume_variant,
        cover_letter_variant=cover_variant,
        application_status=application.status,
    )


@router.get("/{job_id}/resume.pdf")
def get_resume_pdf(
    job_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    variant = (
        db.query(models.ResumeVariant)
        .join(models.JobPosting, models.ResumeVariant.job_id == models.JobPosting.id)
        .filter(models.ResumeVariant.job_id == job_id, models.JobPosting.user_id == current_user.id)
        .order_by(models.ResumeVariant.id.desc())
        .first()
    )
    if not variant or not variant.pdf_path or not Path(variant.pdf_path).exists():
        raise HTTPException(404, "No resume PDF for this job yet")
    return FileResponse(variant.pdf_path, media_type="application/pdf")


@router.get("/{job_id}/cover-letter.pdf")
def get_cover_letter_pdf(
    job_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    variant = (
        db.query(models.CoverLetterVariant)
        .join(models.JobPosting, models.CoverLetterVariant.job_id == models.JobPosting.id)
        .filter(models.CoverLetterVariant.job_id == job_id, models.JobPosting.user_id == current_user.id)
        .order_by(models.CoverLetterVariant.id.desc())
        .first()
    )
    if not variant or not variant.pdf_path or not Path(variant.pdf_path).exists():
        raise HTTPException(404, "No cover letter PDF for this job yet")
    return FileResponse(variant.pdf_path, media_type="application/pdf")
