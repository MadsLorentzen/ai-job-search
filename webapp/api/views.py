from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from webapp.api.dependencies import get_conn
from webapp.services.http_api import JobWorkspaceNotFound
from webapp.services.workspace_view import (
    build_dashboard_view_model,
    build_profile_view_model,
    build_workspace_view_model,
)

router = APIRouter(tags=["views"])


@router.get("/", response_class=HTMLResponse)
def dashboard(
    request: Request, filter: str = "active",
    conn: sqlite3.Connection = Depends(get_conn),
):
    if filter not in {"all", "active", "drafted", "applied", "interview", "offer", "final"}:
        filter = "active"
    return request.app.state.templates.TemplateResponse(
        request, "dashboard.html", build_dashboard_view_model(
            conn, filter_name=filter,
            extensions_dir=request.app.state.settings.extensions_dir,
        )
    )


@router.get("/profile", response_class=HTMLResponse)
def profile_page(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    return_to = request.query_params.get("return_to", "")
    if not return_to.startswith("/workspaces/"):
        return_to = ""
    return request.app.state.templates.TemplateResponse(
        request, "profile.html", {
            **build_profile_view_model(
                conn, profile_root=request.app.state.settings.profile_root
            ),
            "return_to": return_to,
        }
    )


@router.get("/new-job", response_class=HTMLResponse)
def new_job_page(request: Request):
    return request.app.state.templates.TemplateResponse(request, "new_job.html", {})


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
        request, "workspace_detail.html", view
    )
