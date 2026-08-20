from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from webapp.api.dependencies import get_conn, get_documents_root, get_extensions_dir
from webapp.services.http_api import (
    JobWorkspaceNotFound,
    confirm_job_application_pack,
    record_review_decision,
    retry_job_application_pack_projection,
)
from webapp.services.pipeline import PipelineError
from webapp.services.review_view import build_review_view_model

router = APIRouter(prefix="/api/workspaces/{workspace_id}", tags=["review"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReviewDecisionBody(StrictBody):
    review_item_type: str
    source_artifact_id: str
    domain_item_id: str | None = None
    disposition: str
    note: str | None = None


class ApplicationPackBody(StrictBody):
    confirmed: bool
    effective_date: str


def _translate(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=404 if isinstance(exc, JobWorkspaceNotFound) else 400,
        detail=str(exc),
    )


@router.get("/review")
def get_review(workspace_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return build_review_view_model(conn, workspace_id)
    except JobWorkspaceNotFound as exc:
        raise _translate(exc) from exc


@router.post("/review-decisions", status_code=201)
def post_review_decision(
    workspace_id: str, body: ReviewDecisionBody,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return record_review_decision(
            conn, workspace_id, review_item_type=body.review_item_type,
            source_artifact_id=body.source_artifact_id,
            domain_item_id=body.domain_item_id, disposition=body.disposition,
            note=body.note,
        )
    except (PipelineError, JobWorkspaceNotFound) as exc:
        raise _translate(exc) from exc


@router.post("/application-pack", status_code=201)
def post_application_pack(
    workspace_id: str, body: ApplicationPackBody,
    conn: sqlite3.Connection = Depends(get_conn),
    documents_root: Path = Depends(get_documents_root),
    extensions_dir: Path = Depends(get_extensions_dir),
):
    if not body.confirmed:
        raise HTTPException(status_code=400, detail="application pack requires explicit confirmation")
    try:
        return confirm_job_application_pack(
            conn, workspace_id, effective_date=body.effective_date,
            documents_root=documents_root, extensions_dir=extensions_dir,
        )
    except (PipelineError, JobWorkspaceNotFound) as exc:
        raise _translate(exc) from exc


@router.post("/application-pack/{pack_artifact_id}/retry-projection")
def post_retry_projection(
    workspace_id: str, pack_artifact_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    documents_root: Path = Depends(get_documents_root),
):
    try:
        return retry_job_application_pack_projection(
            conn, workspace_id, pack_artifact_id=pack_artifact_id,
            documents_root=documents_root,
        )
    except (PipelineError, JobWorkspaceNotFound) as exc:
        raise _translate(exc) from exc
