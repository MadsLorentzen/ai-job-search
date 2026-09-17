import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import auth as auth_service
from app.services.evaluation_engine import evaluate_job
from app.services.pipeline import SALARY_LOOKUP_SCRIPT

router = APIRouter(prefix="/api/evaluations", tags=["evaluations"])


def _owned_job(db: Session, job_id: int, user_id: int) -> models.JobPosting:
    job = db.query(models.JobPosting).filter_by(id=job_id, user_id=user_id).first()
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/{job_id}", response_model=schemas.EvaluationSchema)
def get_evaluation(
    job_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    _owned_job(db, job_id, current_user.id)
    evaluation = db.query(models.Evaluation).filter(models.Evaluation.job_id == job_id).first()
    if not evaluation:
        raise HTTPException(404, "No evaluation for this job yet")
    return evaluation


@router.post("/{job_id}/recompute", response_model=schemas.EvaluationSchema)
def recompute_evaluation(
    job_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    job = _owned_job(db, job_id, current_user.id)
    profile = db.query(models.CandidateProfile).filter_by(user_id=current_user.id).first()
    if not profile:
        raise HTTPException(409, "Candidate profile not seeded yet -- run scripts/seed_resume_master.py")
    skills = db.query(models.SkillBankEntry).filter_by(user_id=current_user.id).all()

    result = evaluate_job(job, skills, profile, salary_lookup_script=SALARY_LOOKUP_SCRIPT)

    evaluation = db.query(models.Evaluation).filter(models.Evaluation.job_id == job_id).first()
    if not evaluation:
        evaluation = models.Evaluation(job_id=job_id)
        db.add(evaluation)
    for field, value in result.items():
        setattr(evaluation, field, value)
    # The model's default=_now only fires on row *insert*; without this, a
    # re-evaluated existing row would keep showing its original timestamp
    # forever, which defeats the point of a "freshness" indicator.
    evaluation.computed_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    db.refresh(evaluation)
    return evaluation
