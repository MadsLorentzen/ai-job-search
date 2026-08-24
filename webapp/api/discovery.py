from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from product.discovery_search import CliDiscoveryPortalRunner, SUPPORTED_DISCOVERY_SOURCES
from webapp.api.dependencies import get_account_scope, get_conn, get_extensions_dir
from webapp.persistence.discovery import set_discovery_candidate_status
from webapp.services.discovery import (
    DiscoveryServiceError,
    evaluate_discovery_candidate,
    grouped_discovery_candidates,
    promote_discovery_candidate,
    run_discovery_search,
)
from webapp.services.extension_registry import resolve_active_extensions
from webapp.services.ownership import AccountScope, OwnedResourceNotFound


router = APIRouter(tags=["discovery"])


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


def _authorize_search_workspace(
    scope: AccountScope,
    conn: sqlite3.Connection,
    search_workspace_id: str,
) -> None:
    try:
        scope.require_search_workspace(conn, search_workspace_id)
    except OwnedResourceNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/search-workspaces/{search_workspace_id}/discovery/sources")
def get_sources(
    search_workspace_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    _authorize_search_workspace(scope, conn, search_workspace_id)
    return {"sources": list(SUPPORTED_DISCOVERY_SOURCES)}


@router.post("/api/search-workspaces/{search_workspace_id}/discovery/search")
def post_search(
    body: SearchBody,
    request: Request,
    search_workspace_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    _authorize_search_workspace(scope, conn, search_workspace_id)
    runner = getattr(request.app.state, "discovery_portal_runner", None)
    if runner is None:
        runner = CliDiscoveryPortalRunner(Path(request.app.state.settings.profile_root).resolve())
    try:
        return run_discovery_search(
            conn, runner, search_workspace_id=search_workspace_id,
            sources=body.sources, queries=body.queries,
            locations=body.locations, limit_per_source=body.limit_per_source,
            account_id=scope.account_id,
        )
    except DiscoveryServiceError as exc:
        raise _error(exc) from exc


@router.get("/api/search-workspaces/{search_workspace_id}/discovery/candidates")
def get_candidates(
    search_workspace_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    extensions_dir: Path = Depends(get_extensions_dir),
    scope: AccountScope = Depends(get_account_scope),
):
    _authorize_search_workspace(scope, conn, search_workspace_id)
    return {"groups": grouped_discovery_candidates(
        conn, search_workspace_id=search_workspace_id,
        extensions_dir=extensions_dir, account_id=scope.account_id,
    )}


@router.patch("/api/search-workspaces/{search_workspace_id}/discovery/candidates/{candidate_id}")
def patch_candidate(
    candidate_id: str,
    body: LifecycleBody,
    search_workspace_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    _authorize_search_workspace(scope, conn, search_workspace_id)
    try:
        return {"candidate": set_discovery_candidate_status(
            conn, candidate_id, body.status,
            search_workspace_id=search_workspace_id,
            account_id=scope.account_id,
        )}
    except Exception as exc:
        raise _error(exc) from exc


@router.post("/api/search-workspaces/{search_workspace_id}/discovery/evaluate")
def post_evaluate(
    body: EvaluateBody,
    request: Request,
    search_workspace_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    extensions_dir: Path = Depends(get_extensions_dir),
    scope: AccountScope = Depends(get_account_scope),
):
    _authorize_search_workspace(scope, conn, search_workspace_id)
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
                search_workspace_id=search_workspace_id,
                request_id=f"{body.request_id}-{index + 1}",
                understanding_provider=understanding_provider,
                active_extensions=extensions,
                account_id=scope.account_id,
            )
            results.append({"candidate_id": candidate_id, "status": "completed", "fit": fit})
        except Exception as exc:
            results.append({"candidate_id": candidate_id, "status": "failed", "error": str(exc)})
    return {"results": results}


@router.post("/api/search-workspaces/{search_workspace_id}/discovery/candidates/{candidate_id}/promote")
def post_promote(
    candidate_id: str,
    search_workspace_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    _authorize_search_workspace(scope, conn, search_workspace_id)
    try:
        return promote_discovery_candidate(
            conn, candidate_id, search_workspace_id=search_workspace_id,
            account_id=scope.account_id,
        )
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
