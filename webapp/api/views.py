from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from webapp.api.dependencies import get_conn
from product.user_profile import normalize_user_profile
from webapp.persistence.user_profile import get_current_user_profile
from product.discovery_search import SUPPORTED_DISCOVERY_SOURCES
from webapp.persistence.discovery import get_latest_discovery_run
from webapp.persistence.search_workspaces import (
    DEFAULT_SEARCH_WORKSPACE_ID,
    get_search_workspace,
    list_search_workspaces,
)
from webapp.services.discovery import discovery_run_is_stale, grouped_discovery_candidates
from webapp.services.http_api import JobWorkspaceNotFound
from webapp.services.workspace_view import (
    build_dashboard_view_model,
    build_profile_view_model,
    build_workspace_view_model,
)
from webapp.services.profile_manager import get_profile_manager

router = APIRouter(tags=["views"])


def _search_context(
    conn: sqlite3.Connection, selected_search_workspace: dict | None = None
) -> dict:
    return {
        "search_workspaces": list_search_workspaces(conn, include_archived=True),
        "selected_search_workspace": selected_search_workspace,
    }


def _require_search_workspace(
    conn: sqlite3.Connection, search_workspace_id: str
) -> dict:
    workspace = get_search_workspace(conn, search_workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="search workspace not found")
    return workspace


def _selected_search_workspace_id(request: Request, conn: sqlite3.Connection) -> str:
    selected = request.cookies.get("search_workspace_id", DEFAULT_SEARCH_WORKSPACE_ID)
    workspace = get_search_workspace(conn, selected)
    if workspace is not None and workspace["status"] == "active":
        return selected
    active = list_search_workspaces(conn)
    return active[0]["id"] if active else DEFAULT_SEARCH_WORKSPACE_ID


@router.get("/", response_class=HTMLResponse)
def dashboard(
    request: Request, filter: str = "active",
    conn: sqlite3.Connection = Depends(get_conn),
):
    if filter not in {"all", "active", "drafted", "applied", "interview", "offer", "final"}:
        filter = "active"
    return request.app.state.templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            **build_dashboard_view_model(
                conn,
                filter_name=filter,
                extensions_dir=request.app.state.settings.extensions_dir,
            ),
            **_search_context(conn),
        },
    )


@router.get("/profile", response_class=HTMLResponse)
def profile_page(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    return_to = request.query_params.get("return_to", "")
    if not return_to.startswith("/workspaces/"):
        return_to = ""
    view = build_profile_view_model(
        conn, profile_root=request.app.state.settings.profile_root
    )
    manager = None
    if not view["setup_required"]:
        manager = get_profile_manager(
            conn, root=request.app.state.settings.profile_root
        )
    return request.app.state.templates.TemplateResponse(
        request, "profile.html", {
            **view,
            "profile_manager": manager,
            "return_to": return_to,
            **_search_context(conn),
        }
    )


@router.get("/user-profile", response_class=HTMLResponse)
def user_profile_page(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    return RedirectResponse(
        f"/search-workspaces/{_selected_search_workspace_id(request, conn)}/preferences",
        status_code=307,
    )


@router.get("/discover", response_class=HTMLResponse)
def discovery_page(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    return RedirectResponse(
        f"/search-workspaces/{_selected_search_workspace_id(request, conn)}/discover",
        status_code=307,
    )


@router.get("/search-workspaces/{search_workspace_id}/preferences", response_class=HTMLResponse)
def scoped_user_profile_page(
    search_workspace_id: str,
    request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    workspace = _require_search_workspace(conn, search_workspace_id)
    record = get_current_user_profile(conn, search_workspace_id)
    response = request.app.state.templates.TemplateResponse(
        request,
        "user_profile.html",
        {
            "user_profile": record,
            "preferences": record["payload"] if record else normalize_user_profile({}),
            **_search_context(conn, workspace),
        },
    )
    response.set_cookie("search_workspace_id", search_workspace_id, samesite="lax")
    return response


@router.get("/search-workspaces/{search_workspace_id}/discover", response_class=HTMLResponse)
def scoped_discovery_page(
    search_workspace_id: str,
    request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
):
    workspace = _require_search_workspace(conn, search_workspace_id)
    profile = get_current_user_profile(conn, search_workspace_id)
    preferences = profile["payload"] if profile else normalize_user_profile({})
    latest_run = get_latest_discovery_run(conn, search_workspace_id)
    response = request.app.state.templates.TemplateResponse(
        request,
        "discovery.html",
        {
            "user_profile": profile,
            "preferences": preferences,
            "sources": SUPPORTED_DISCOVERY_SOURCES,
            "groups": grouped_discovery_candidates(
                conn,
                search_workspace_id=search_workspace_id,
                extensions_dir=request.app.state.settings.extensions_dir,
            ),
            "latest_run": latest_run,
            "search_stale": discovery_run_is_stale(
                conn, latest_run, search_workspace_id=search_workspace_id
            ),
            **_search_context(conn, workspace),
        },
    )
    response.set_cookie("search_workspace_id", search_workspace_id, samesite="lax")
    return response


@router.get("/new-job", response_class=HTMLResponse)
def new_job_page(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    return request.app.state.templates.TemplateResponse(
        request, "new_job.html", _search_context(conn)
    )


@router.get("/search-workspaces", response_class=HTMLResponse)
def search_workspaces_page(
    request: Request, conn: sqlite3.Connection = Depends(get_conn)
):
    selected_id = _selected_search_workspace_id(request, conn)
    selected = get_search_workspace(conn, selected_id)
    return request.app.state.templates.TemplateResponse(
        request,
        "search_workspaces.html",
        _search_context(conn, selected),
    )


@router.get("/workspaces/{workspace_id}", response_class=HTMLResponse)
def workspace_detail_page(
    workspace_id: str, request: Request, conn: sqlite3.Connection = Depends(get_conn)
):
    try:
        view = build_workspace_view_model(
            conn, workspace_id, extensions_dir=request.app.state.settings.extensions_dir
        )
    except JobWorkspaceNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return request.app.state.templates.TemplateResponse(
        request, "workspace_detail.html", {**view, **_search_context(conn)}
    )
