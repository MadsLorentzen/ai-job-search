from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from webapp.api.dependencies import get_conn
from webapp.services.pipeline import PipelineError, get_current_profile_snapshot, refresh_profile
from webapp.services.profile_setup import import_profile_markdown, setup_basic_profile
from webapp.services.profile_manager import (
    ProfileEntryNotFound,
    ProfileManagerError,
    ProfileRevisionConflict,
    create_profile_entry,
    delete_profile_entry,
    get_profile_manager,
    update_profile_entry,
    update_profile_source,
)

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


class ProfileEntryBody(StrictBody):
    expected_revision: str
    kind: str
    fields: dict


class ProfileDeleteBody(StrictBody):
    expected_revision: str


class ProfileSourceBody(StrictBody):
    expected_revision: str
    included: bool


def _manager_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ProfileRevisionConflict):
        status = 409
    elif isinstance(exc, ProfileEntryNotFound):
        status = 404
    else:
        status = 400
    return HTTPException(status_code=status, detail=str(exc))


@router.get("")
def get_profile(conn: sqlite3.Connection = Depends(get_conn)):
    return {"profile": get_current_profile_snapshot(conn)}


@router.get("/manager")
def get_manager(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return get_profile_manager(
            conn, root=request.app.state.settings.profile_root
        )
    except ProfileManagerError as exc:
        raise _manager_error(exc) from exc


@router.post("/entries", status_code=201)
def post_profile_entry(
    body: ProfileEntryBody, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return create_profile_entry(
            conn, root=request.app.state.settings.profile_root,
            expected_revision=body.expected_revision,
            kind=body.kind, fields=body.fields,
        )
    except ProfileManagerError as exc:
        raise _manager_error(exc) from exc


@router.put("/entries/{entry_id}")
def put_profile_entry(
    entry_id: str, body: ProfileEntryBody, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return update_profile_entry(
            conn, root=request.app.state.settings.profile_root,
            expected_revision=body.expected_revision, entry_id=entry_id,
            kind=body.kind, fields=body.fields,
        )
    except ProfileManagerError as exc:
        raise _manager_error(exc) from exc


@router.delete("/entries/{entry_id}")
def remove_profile_entry(
    entry_id: str, body: ProfileDeleteBody, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return delete_profile_entry(
            conn, root=request.app.state.settings.profile_root,
            expected_revision=body.expected_revision, entry_id=entry_id,
        )
    except ProfileManagerError as exc:
        raise _manager_error(exc) from exc


@router.put("/sources/{source_path:path}")
def put_profile_source(
    source_path: str, body: ProfileSourceBody, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return update_profile_source(
            conn, root=request.app.state.settings.profile_root,
            expected_revision=body.expected_revision,
            source_path=source_path, included=body.included,
        )
    except (ProfileManagerError, ValueError) as exc:
        raise _manager_error(exc) from exc


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
