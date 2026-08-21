from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from product.discovery_search import CliDiscoveryPortalRunner, SUPPORTED_DISCOVERY_SOURCES
from webapp.api.dependencies import get_conn, get_extensions_dir
from webapp.persistence.discovery import set_discovery_candidate_status
from webapp.services.discovery import (
    DiscoveryServiceError,
    evaluate_discovery_candidate,
    grouped_discovery_candidates,
    promote_discovery_candidate,
    run_discovery_search,
)
from webapp.services.extension_registry import resolve_active_extensions


router = APIRouter(prefix="/api/discovery", tags=["discovery"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchBody(StrictBody):
    sources: list[str] | None = None
    queries: list[str] | None = None
    locations: list[str] | None = None
    limit_per_source: int = Field(default=20, ge=1, le=50)


class LifecycleBody(StrictBody):
    status: Literal["new", "saved", "dismissed", "expired"]


class EvaluateBody(StrictBody):
    candidate_ids: list[str] = Field(min_length=1, max_length=50)
    extension_ids: list[str] = Field(default_factory=list)
    request_id: str


def _error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/sources")
def get_sources():
    return {"sources": list(SUPPORTED_DISCOVERY_SOURCES)}


@router.post("/search")
def post_search(
    body: SearchBody, request: Request, conn: sqlite3.Connection = Depends(get_conn)
):
    runner = getattr(request.app.state, "discovery_portal_runner", None)
    if runner is None:
        runner = CliDiscoveryPortalRunner(Path(request.app.state.settings.profile_root).resolve())
    try:
        return run_discovery_search(
            conn, runner, sources=body.sources, queries=body.queries,
            locations=body.locations, limit_per_source=body.limit_per_source,
        )
    except DiscoveryServiceError as exc:
        raise _error(exc) from exc


@router.get("/candidates")
def get_candidates(
    conn: sqlite3.Connection = Depends(get_conn),
    extensions_dir: Path = Depends(get_extensions_dir),
):
    return {"groups": grouped_discovery_candidates(conn, extensions_dir=extensions_dir)}


@router.patch("/candidates/{candidate_id}")
def patch_candidate(
    candidate_id: str, body: LifecycleBody, conn: sqlite3.Connection = Depends(get_conn)
):
    try:
        return {"candidate": set_discovery_candidate_status(conn, candidate_id, body.status)}
    except Exception as exc:
        raise _error(exc) from exc


@router.post("/evaluate")
def post_evaluate(
    body: EvaluateBody,
    request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
    extensions_dir: Path = Depends(get_extensions_dir),
):
    try:
        extensions = resolve_active_extensions(extensions_dir, body.extension_ids)
    except Exception as exc:
        raise _error(exc) from exc
    understanding_provider = _job_understanding_provider(request)
    semantic_adapter = _semantic_adapter(request)
    results = []
    for index, candidate_id in enumerate(body.candidate_ids):
        try:
            fit = evaluate_discovery_candidate(
                conn, candidate_id, semantic_adapter,
                request_id=f"{body.request_id}-{index + 1}",
                understanding_provider=understanding_provider,
                active_extensions=extensions,
            )
            results.append({"candidate_id": candidate_id, "status": "completed", "fit": fit})
        except Exception as exc:
            results.append({"candidate_id": candidate_id, "status": "failed", "error": str(exc)})
    return {"results": results}


@router.post("/candidates/{candidate_id}/promote")
def post_promote(candidate_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return promote_discovery_candidate(conn, candidate_id)
    except DiscoveryServiceError as exc:
        raise _error(exc) from exc


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
