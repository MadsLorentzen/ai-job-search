from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from product.user_profile import UserProfileValidationError, normalize_user_profile
from webapp.api.dependencies import get_account_scope, get_conn
from webapp.persistence.user_profile import get_current_user_profile, save_user_profile
from webapp.persistence.search_workspaces import (
    SearchWorkspaceConflictError,
    SearchWorkspaceError,
    get_search_workspace,
)
from webapp.services.ownership import AccountScope


router = APIRouter(
    prefix="/api/search-workspaces/{search_workspace_id}/user-profile",
    tags=["user-profile"],
)


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
def get_scoped_user_profile(
    search_workspace_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    if get_search_workspace(
        conn, search_workspace_id, account_id=scope.account_id
    ) is None:
        raise HTTPException(status_code=404, detail="search workspace not found")
    return {
        "user_profile": get_current_user_profile(
            conn, search_workspace_id, account_id=scope.account_id
        ),
        "defaults": normalize_user_profile({}),
    }


def _expected_revision(if_match: str | None) -> int:
    if if_match is None:
        raise HTTPException(
            status_code=428, detail="If-Match preference revision is required"
        )
    try:
        return int(if_match.strip().strip('"'))
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="If-Match must be an integer revision"
        ) from exc


@router.put("")
def put_scoped_user_profile(
    search_workspace_id: str,
    body: UserProfileBody,
    if_match: str | None = Header(default=None, alias="If-Match"),
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    if get_search_workspace(
        conn, search_workspace_id, account_id=scope.account_id
    ) is None:
        raise HTTPException(status_code=404, detail="search workspace not found")
    try:
        return {
            "user_profile": save_user_profile(
                conn,
                body.model_dump(),
                search_workspace_id=search_workspace_id,
                expected_revision=_expected_revision(if_match),
                account_id=scope.account_id,
            )
        }
    except SearchWorkspaceConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (SearchWorkspaceError, UserProfileValidationError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
