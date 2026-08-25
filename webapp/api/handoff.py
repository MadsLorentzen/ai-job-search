from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from webapp.api.dependencies import get_account_scope, get_conn
from webapp.services.handoff import (
    HandoffError,
    HandoffEventRejected,
    HandoffPackNotFound,
    HandoffSessionNotActive,
    HandoffSessionNotFound,
    PairingSecretInvalid,
    confirm_handoff_submission,
    discover_resumable_handoff_sessions,
    exchange_pairing_secret_for_credential,
    generate_pairing_secret,
    record_handoff_event,
    replay_handoff_session,
    resolve_account_scope_from_extension_credential,
    start_handoff_session,
)
from webapp.services.ownership import AccountScope, OwnedResourceNotFound

router = APIRouter(prefix="/api/handoff", tags=["handoff"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExchangePairingBody(StrictBody):
    one_time_secret: str


class StartSessionBody(StrictBody):
    workspace_id: str
    pack_artifact_id: str
    target_url: str
    target_domain: str
    ats_adapter_id: str
    ats_adapter_version: str


class RecordEventBody(StrictBody):
    event_id: str
    event_type: str
    event_payload: dict
    normalized_field_type: str | None = None
    page_field_key: str | None = None
    observed_at: str | None = None


class ConfirmSubmissionBody(StrictBody):
    mark_workflow_applied: bool = False
    effective_date: str | None = None


def get_extension_scope(
    request: Request,
    x_handoff_credential: str = Header(...),
    conn: sqlite3.Connection = Depends(get_conn),
) -> AccountScope:
    try:
        return resolve_account_scope_from_extension_credential(
            conn, presented_secret=x_handoff_credential,
            base_profile_root=request.app.state.settings.profile_root,
        )
    except PairingSecretInvalid as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, (HandoffSessionNotFound, OwnedResourceNotFound)):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (HandoffPackNotFound, HandoffSessionNotActive, HandoffEventRejected)):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.post("/pairing/generate", status_code=201)
def post_generate_pairing(scope: AccountScope = Depends(get_account_scope)):
    return {"one_time_secret": generate_pairing_secret(), "account_id": scope.account_id}


@router.post("/pairing/exchange", status_code=201)
def post_exchange_pairing(
    body: ExchangePairingBody,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    result = exchange_pairing_secret_for_credential(
        conn, account_id=scope.account_id, one_time_secret=body.one_time_secret,
    )
    return result


@router.post("/sessions", status_code=201)
def post_start_session(
    body: StartSessionBody,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return start_handoff_session(conn, scope, **body.model_dump())
    except (HandoffError, OwnedResourceNotFound) as exc:
        raise _translate(exc) from exc


@router.get("/sessions/discover")
def get_discover_sessions(
    workspace_id: str, target_domain: str,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        sessions = discover_resumable_handoff_sessions(
            conn, scope, workspace_id=workspace_id, target_domain=target_domain,
        )
        return {"sessions": sessions}
    except OwnedResourceNotFound as exc:
        raise _translate(exc) from exc


@router.post("/sessions/{session_id}/events", status_code=201)
def post_record_event(
    session_id: str, body: RecordEventBody,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return record_handoff_event(
            conn, scope, handoff_session_id=session_id, **body.model_dump()
        )
    except HandoffError as exc:
        raise _translate(exc) from exc


@router.get("/sessions/{session_id}/events")
def get_replay_events(
    session_id: str,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return replay_handoff_session(conn, scope, session_id)
    except HandoffError as exc:
        raise _translate(exc) from exc


@router.post("/sessions/{session_id}/confirm-submission", status_code=201)
def post_confirm_submission(
    session_id: str, body: ConfirmSubmissionBody,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return confirm_handoff_submission(
            conn, scope, handoff_session_id=session_id,
            mark_workflow_applied=body.mark_workflow_applied,
            effective_date=body.effective_date,
        )
    except HandoffError as exc:
        raise _translate(exc) from exc
