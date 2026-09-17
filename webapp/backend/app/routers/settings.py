from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import auth as auth_service

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _get_or_create(db: Session, user_id: int) -> models.Settings:
    # Signup always creates a Settings row, so this is normally a plain get --
    # the create fallback only guards a pre-existing account from before that.
    settings = db.query(models.Settings).filter_by(user_id=user_id).first()
    if not settings:
        settings = models.Settings(user_id=user_id)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get("", response_model=schemas.SettingsSchema)
def get_settings(db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)):
    return _get_or_create(db, current_user.id)


@router.put("", response_model=schemas.SettingsSchema)
def update_settings(
    payload: schemas.SettingsUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    settings = _get_or_create(db, current_user.id)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    # scheduler_interval_minutes is stored per user but no longer drives the
    # actual tick cadence -- see services/scheduler.py's DEFAULT_INTERVAL_MINUTES
    # docstring: one shared cadence for every account, by explicit design.
    return settings
