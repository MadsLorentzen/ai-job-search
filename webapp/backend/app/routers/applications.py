from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import auth as auth_service
from app.services.pipeline import PipelineError, apply_to_job

router = APIRouter(prefix="/api/applications", tags=["applications"])


@router.get("", response_model=list[schemas.ApplicationSchema])
def list_applications(
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    query = (
        db.query(models.Application)
        .join(models.JobPosting)
        .filter(models.JobPosting.user_id == current_user.id)
    )
    if status:
        query = query.filter(models.Application.status == status)
    return query.all()


@router.get("/events/recent", response_model=list[schemas.ApplicationEventWithJobSchema])
def get_recent_events(
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    rows = (
        db.query(models.ApplicationEvent, models.JobPosting)
        .join(models.JobPosting, models.ApplicationEvent.job_id == models.JobPosting.id)
        .filter(models.JobPosting.user_id == current_user.id)
        .order_by(models.ApplicationEvent.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": event.id,
            "job_id": event.job_id,
            "event_type": event.event_type,
            "detail": event.detail,
            "timestamp": event.timestamp,
            "company": job.company,
            "title": job.title,
        }
        for event, job in rows
    ]


@router.get("/{job_id}", response_model=schemas.ApplicationSchema)
def get_application(
    job_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    application = (
        db.query(models.Application)
        .join(models.JobPosting)
        .filter(models.Application.job_id == job_id, models.JobPosting.user_id == current_user.id)
        .first()
    )
    if not application:
        raise HTTPException(404, "No application record for this job yet")
    return application


@router.get("/{job_id}/events", response_model=list[schemas.ApplicationEventSchema])
def get_application_events(
    job_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    return (
        db.query(models.ApplicationEvent)
        .join(models.JobPosting, models.ApplicationEvent.job_id == models.JobPosting.id)
        .filter(models.ApplicationEvent.job_id == job_id, models.JobPosting.user_id == current_user.id)
        .order_by(models.ApplicationEvent.timestamp)
        .all()
    )


@router.post("/{job_id}/apply", response_model=schemas.ApplicationSchema)
def apply_route(
    job_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    try:
        return apply_to_job(db, job_id, current_user.id)
    except PipelineError as e:
        code = 404 if "not found" in str(e).lower() else 409
        raise HTTPException(code, str(e))
