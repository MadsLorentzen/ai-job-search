from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import auth as auth_service

router = APIRouter(prefix="/api/resume", tags=["resume"])


@router.get("/profile", response_model=schemas.CandidateProfileSchema)
def get_profile(db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)):
    profile = db.query(models.CandidateProfile).filter_by(user_id=current_user.id).first()
    if not profile:
        raise HTTPException(404, "Profile not seeded yet — run scripts/seed_resume_master.py")
    return profile


@router.put("/profile", response_model=schemas.CandidateProfileSchema)
def update_profile(
    payload: schemas.CandidateProfileSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    profile = db.query(models.CandidateProfile).filter_by(user_id=current_user.id).first()
    if not profile:
        raise HTTPException(404, "Profile not seeded yet")
    for field, value in payload.model_dump(exclude={"id"}).items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/skills", response_model=list[schemas.SkillBankEntrySchema])
def list_skills(db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)):
    return (
        db.query(models.SkillBankEntry)
        .filter_by(user_id=current_user.id)
        .order_by(models.SkillBankEntry.skill)
        .all()
    )


@router.patch("/skills/{skill_id}", response_model=schemas.SkillBankEntrySchema)
def update_skill(
    skill_id: int,
    payload: schemas.SkillBankEntryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    skill = db.query(models.SkillBankEntry).filter_by(id=skill_id, user_id=current_user.id).first()
    if not skill:
        raise HTTPException(404, "Skill not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(skill, field, value)
    db.commit()
    db.refresh(skill)
    return skill


@router.get("/experience", response_model=list[schemas.ExperienceEntrySchema])
def list_experience(
    db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    return (
        db.query(models.ExperienceEntry)
        .filter_by(user_id=current_user.id)
        .order_by(models.ExperienceEntry.sort_order)
        .all()
    )


@router.get("/education", response_model=list[schemas.EducationEntrySchema])
def list_education(
    db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)
):
    return (
        db.query(models.EducationEntry)
        .filter_by(user_id=current_user.id)
        .order_by(models.EducationEntry.sort_order)
        .all()
    )


@router.patch("/bullets/{bullet_id}", response_model=schemas.BulletLibraryEntrySchema)
def update_bullet(
    bullet_id: int,
    payload: schemas.BulletLibraryEntryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    # BulletLibraryEntry has no user_id of its own -- it hangs off
    # experience_entry, so ownership is checked transitively through that join.
    bullet = (
        db.query(models.BulletLibraryEntry)
        .join(models.ExperienceEntry, models.BulletLibraryEntry.experience_id == models.ExperienceEntry.id)
        .filter(models.BulletLibraryEntry.id == bullet_id, models.ExperienceEntry.user_id == current_user.id)
        .first()
    )
    if not bullet:
        raise HTTPException(404, "Bullet not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(bullet, field, value)
    db.commit()
    db.refresh(bullet)
    return bullet
