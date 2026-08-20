from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from webapp.api.dependencies import get_conn, get_extensions_dir
from webapp.services.http_api import (
    JobWorkspaceNotFound,
    create_job_workspace,
    fit_job,
    generate_application_intelligence,
    get_job_workspace,
    list_job_workspaces,
    list_public_extensions,
    understand_job,
)
from webapp.services.pipeline import PipelineError

router = APIRouter(prefix="/api", tags=["workspaces"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateWorkspaceBody(StrictBody):
    company: str
    title: str
    source_record: dict[str, Any]


class ProcessingBody(StrictBody):
    request_id: str


class FitBody(ProcessingBody):
    extension_ids: list[str] = Field(default_factory=list)


def _service_error(exc: Exception) -> HTTPException:
    if isinstance(exc, JobWorkspaceNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/extensions")
def get_extensions(extensions_dir: Path = Depends(get_extensions_dir)):
    try:
        return {"extensions": list_public_extensions(extensions_dir)}
    except PipelineError as exc:
        raise _service_error(exc) from exc


@router.post("/workspaces", status_code=201)
def post_workspace(body: CreateWorkspaceBody, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return create_job_workspace(
            conn, company=body.company, title=body.title, source_record=body.source_record
        )
    except PipelineError as exc:
        raise _service_error(exc) from exc


@router.get("/workspaces")
def get_workspaces(conn: sqlite3.Connection = Depends(get_conn)):
    return {"workspaces": list_job_workspaces(conn)}


@router.get("/workspaces/{workspace_id}")
def get_workspace_detail(workspace_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return {"workspace": get_job_workspace(conn, workspace_id)}
    except JobWorkspaceNotFound as exc:
        raise _service_error(exc) from exc


@router.post("/workspaces/{workspace_id}/understand")
def post_understand(
    workspace_id: str, body: ProcessingBody, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    provider = _job_understanding_provider(request)
    try:
        return {"artifact": understand_job(conn, workspace_id, provider, request_id=body.request_id)}
    except (PipelineError, JobWorkspaceNotFound) as exc:
        raise _service_error(exc) from exc


@router.post("/workspaces/{workspace_id}/fit")
def post_fit(
    workspace_id: str, body: FitBody, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
    extensions_dir: Path = Depends(get_extensions_dir),
):
    try:
        return {
            "artifact": fit_job(
                conn, workspace_id, _semantic_adapter(request), request_id=body.request_id,
                extension_ids=body.extension_ids, extensions_dir=extensions_dir,
            )
        }
    except (PipelineError, JobWorkspaceNotFound) as exc:
        raise _service_error(exc) from exc


@router.post("/workspaces/{workspace_id}/application-intelligence")
def post_application_intelligence(
    workspace_id: str, body: ProcessingBody, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return {
            "artifact": generate_application_intelligence(
                conn, workspace_id, _application_intelligence_provider(request),
                request_id=body.request_id,
            )
        }
    except (PipelineError, JobWorkspaceNotFound) as exc:
        raise _service_error(exc) from exc


def _job_understanding_provider(request: Request):
    override = getattr(request.app.state, "job_understanding_provider", None)
    if override is not None:
        return override
    from product.openai_job_understanding_provider import OpenAIJobUnderstandingProvider
    return OpenAIJobUnderstandingProvider()


def _semantic_adapter(request: Request):
    override = getattr(request.app.state, "semantic_adapter", None)
    if override is not None:
        return override
    from webapp.services.openai_semantic_proposer_client import OpenAISemanticProposerClient
    from webapp.services.semantic_proposal_adapter import SemanticProposalAdapter
    return SemanticProposalAdapter(OpenAISemanticProposerClient())


def _application_intelligence_provider(request: Request):
    override = getattr(request.app.state, "application_intelligence_provider", None)
    if override is not None:
        return override
    from product.openai_application_intelligence_provider import OpenAIApplicationIntelligenceProvider
    return OpenAIApplicationIntelligenceProvider()
