from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import auth as auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

_COOKIE_KWARGS = dict(
    httponly=True,
    samesite="lax",
    max_age=int(auth_service.SESSION_LIFETIME.total_seconds()),
)


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(auth_service.SESSION_COOKIE_NAME, token, **_COOKIE_KWARGS)


@router.post("/signup", response_model=schemas.UserSchema)
def signup(payload: schemas.SignupRequest, response: Response, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "A valid email is required")
    if len(payload.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if db.query(models.User).filter_by(email=email).first() is not None:
        raise HTTPException(409, "An account with this email already exists")

    user = models.User(email=email, password_hash=auth_service.hash_password(payload.password))
    db.add(user)
    db.flush()  # assigns user.id without committing yet

    # Every per-user root table needs exactly one row for a brand-new account
    # so the rest of the app (which always does a lookup-by-owner, never an
    # insert-if-missing) has something to find.
    db.add(models.CandidateProfile(user_id=user.id, name="", email="", phone="", location=""))
    db.add(models.Settings(user_id=user.id))
    db.commit()
    db.refresh(user)

    token = auth_service.create_session(db, user)
    _set_session_cookie(response, token)
    return user


@router.post("/login", response_model=schemas.UserSchema)
def login(payload: schemas.LoginRequest, response: Response, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.query(models.User).filter_by(email=email).first()
    if user is None or not auth_service.verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")

    token = auth_service.create_session(db, user)
    _set_session_cookie(response, token)
    return user


@router.post("/logout")
def logout(
    response: Response,
    session_id: str | None = Cookie(default=None, alias=auth_service.SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
):
    if session_id:
        auth_service.delete_session(db, session_id)
    response.delete_cookie(auth_service.SESSION_COOKIE_NAME)
    return {"status": "ok"}


@router.get("/me", response_model=schemas.UserSchema)
def me(current_user: models.User = Depends(auth_service.get_current_user)):
    return current_user
