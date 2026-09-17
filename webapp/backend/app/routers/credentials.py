from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import models
from app.services import auth as auth_service
from app.services import credentials as cred_service

router = APIRouter(prefix="/api/credentials", tags=["credentials"])


class CredentialSet(BaseModel):
    key: str
    value: str


@router.get("/status")
def credential_status(current_user: models.User = Depends(auth_service.get_current_user)):
    # Booleans only -- this endpoint must NEVER return a stored secret value.
    return {key: cred_service.has_credential(key, current_user.id) for key in sorted(cred_service.ALLOWED_KEYS)}


@router.post("", status_code=204)
def set_credential(payload: CredentialSet, current_user: models.User = Depends(auth_service.get_current_user)):
    try:
        cred_service.set_credential(payload.key, payload.value, current_user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/{key}", status_code=204)
def delete_credential(key: str, current_user: models.User = Depends(auth_service.get_current_user)):
    if key not in cred_service.ALLOWED_KEYS:
        raise HTTPException(400, f"Unknown credential key. Allowed: {sorted(cred_service.ALLOWED_KEYS)}")
    cred_service.delete_credential(key, current_user.id)
