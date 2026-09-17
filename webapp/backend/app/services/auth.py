"""Account/session handling -- server-side sessions (a `session` table row is
the source of truth for validity) rather than JWTs, since logout/expiry then
just means deleting or aging out a row instead of getting token-refresh
logic right for a handful of users. `SESSION_COOKIE_NAME`'s value is an
opaque random token (`secrets.token_urlsafe`), never anything derived from
the user's identity -- the cookie itself carries no information an attacker
could use even if intercepted without also having DB access.
"""

from __future__ import annotations

import datetime as dt
import secrets

import bcrypt
from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.database import get_db

SESSION_COOKIE_NAME = "session_id"
SESSION_LIFETIME = dt.timedelta(days=30)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # A malformed/foreign hash should fail the check, not crash the request.
        return False


def create_session(db: Session, user: models.User) -> str:
    token = secrets.token_urlsafe(32)
    now = dt.datetime.now(dt.timezone.utc)
    db.add(models.Session(id=token, user_id=user.id, created_at=now, expires_at=now + SESSION_LIFETIME))
    db.commit()
    return token


def delete_session(db: Session, token: str) -> None:
    session = db.get(models.Session, token)
    if session is not None:
        db.delete(session)
        db.commit()


def get_current_user(
    session_id: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> models.User:
    if not session_id:
        raise HTTPException(401, "Not logged in")
    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(401, "Session not found")
    # Naive UTC on both sides -- SQLite has no timezone-aware column type, so
    # `expires_at` round-trips as naive even though it's written from an
    # aware datetime (see database.py's docstring for the same naive-UTC
    # pattern this project has already worked around once on the frontend).
    if session.expires_at < dt.datetime.now(dt.timezone.utc).replace(tzinfo=None):
        db.delete(session)
        db.commit()
        raise HTTPException(401, "Session expired")
    user = db.get(models.User, session.user_id)
    if user is None:
        raise HTTPException(401, "User not found")
    return user
