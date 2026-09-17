from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import auth as auth_service

router = APIRouter(prefix="/api/qa-bank", tags=["qa_bank"])


@router.get("", response_model=list[schemas.QABankEntrySchema])
def list_entries(db: Session = Depends(get_db), current_user: models.User = Depends(auth_service.get_current_user)):
    return db.query(models.QABankEntry).filter_by(user_id=current_user.id).all()


@router.post("", response_model=schemas.QABankEntrySchema, status_code=201)
def create_entry(
    payload: schemas.QABankEntryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    entry = models.QABankEntry(**payload.model_dump(), user_id=current_user.id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_service.get_current_user),
):
    entry = db.query(models.QABankEntry).filter_by(id=entry_id, user_id=current_user.id).first()
    if not entry:
        raise HTTPException(404, "Entry not found")
    db.delete(entry)
    db.commit()
