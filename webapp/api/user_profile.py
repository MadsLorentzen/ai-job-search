from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from product.user_profile import UserProfileValidationError, normalize_user_profile
from webapp.api.dependencies import get_conn
from webapp.persistence.user_profile import get_current_user_profile, save_user_profile


router = APIRouter(prefix="/api/user-profile", tags=["user-profile"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class CompensationBody(StrictBody):
    currency: str
    minimum: int
    period: str


class UserProfileBody(StrictBody):
    target_roles: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    remote_preference: str = "no_preference"
    seniority_levels: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    employment_types: list[str] = Field(default_factory=list)
    search_terms: list[str] = Field(default_factory=list)
    source_preferences: list[str] = Field(default_factory=list)
    recency_days: int = 14
    compensation: CompensationBody | None = None


@router.get("")
def get_user_profile(conn: sqlite3.Connection = Depends(get_conn)):
    return {
        "user_profile": get_current_user_profile(conn),
        "defaults": normalize_user_profile({}),
    }


@router.put("")
def put_user_profile(
    body: UserProfileBody, conn: sqlite3.Connection = Depends(get_conn)
):
    try:
        payload: dict[str, Any] = body.model_dump()
        return {"user_profile": save_user_profile(conn, payload)}
    except UserProfileValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
