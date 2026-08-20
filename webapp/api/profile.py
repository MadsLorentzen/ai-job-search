from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request

from webapp.api.dependencies import get_conn
from webapp.services.pipeline import PipelineError, get_current_profile_snapshot, refresh_profile

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("")
def get_profile(conn: sqlite3.Connection = Depends(get_conn)):
    return {"profile": get_current_profile_snapshot(conn)}


@router.post("/refresh")
def post_profile_refresh(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return {"profile": refresh_profile(conn, root=request.app.state.settings.profile_root)}
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
