from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from webapp.api.dependencies import get_conn
from webapp.services.pipeline import PipelineError, get_current_profile_snapshot, refresh_profile
from webapp.services.profile_setup import import_profile_markdown, setup_basic_profile

router = APIRouter(prefix="/api/profile", tags=["profile"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BasicProfileBody(StrictBody):
    name: str
    location: str = ""
    status: str = ""
    constraints: str = ""
    education: list[str] = Field(default_factory=list)
    experience: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)


class ImportProfileBody(StrictBody):
    markdown: str


@router.get("")
def get_profile(conn: sqlite3.Connection = Depends(get_conn)):
    return {"profile": get_current_profile_snapshot(conn)}


@router.post("/refresh")
def post_profile_refresh(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return {"profile": refresh_profile(conn, root=request.app.state.settings.profile_root)}
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/setup/basic", status_code=201)
def post_basic_profile_setup(
    body: BasicProfileBody, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        artifact = setup_basic_profile(
            conn, root=request.app.state.settings.profile_root,
            data=body.model_dump(),
        )
        return {"profile": artifact}
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/setup/import", status_code=201)
def post_profile_import(
    body: ImportProfileBody, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        artifact = import_profile_markdown(
            conn, root=request.app.state.settings.profile_root,
            markdown=body.markdown,
        )
        return {"profile": artifact}
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
