from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from webapp.api.dependencies import get_conn
from webapp.services.http_api import JobWorkspaceNotFound, change_job_status
from webapp.services.pipeline import PipelineError
from webapp.services.workflow_events import list_events

router = APIRouter(prefix="/api/workspaces/{workspace_id}", tags=["status"])


class StatusBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_status: str
    effective_date: str
    note: str | None = None


def _translate(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=404 if isinstance(exc, JobWorkspaceNotFound) else 400,
        detail=str(exc),
    )


@router.patch("/status")
def patch_status(
    workspace_id: str, body: StatusBody, conn: sqlite3.Connection = Depends(get_conn)
):
    try:
        return change_job_status(
            conn, workspace_id, new_status=body.new_status,
            effective_date=body.effective_date, note=body.note,
        )
    except (PipelineError, JobWorkspaceNotFound) as exc:
        raise _translate(exc) from exc


@router.get("/events")
def get_events(workspace_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return {"events": list_events(conn, workspace_id)}
    except JobWorkspaceNotFound as exc:
        raise _translate(exc) from exc
