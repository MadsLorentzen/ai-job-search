from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from product.onboarding import OnboardingTransitionError
from product.onboarding import get_walkthrough as _get_walkthrough_definition
from webapp.api.dependencies import get_account_scope, get_conn
from webapp.services.onboarding import (
    WalkthroughNotFound,
    advance_walkthrough,
    begin_walkthrough,
    complete_walkthrough,
    get_walkthrough_status,
    go_back_walkthrough,
    interrupt_walkthrough,
    list_walkthrough_statuses,
    replay_walkthrough,
    resume_walkthrough,
    skip_walkthrough,
)
from webapp.services.ownership import AccountScope

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SkipBody(StrictBody):
    reason: str


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, WalkthroughNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, OnboardingTransitionError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/walkthroughs")
def list_walkthroughs(
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict]:
    return list_walkthrough_statuses(conn, account_id=scope.account_id)


@router.get("/walkthroughs/{walkthrough_id}")
def get_walkthrough(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return get_walkthrough_status(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except WalkthroughNotFound as exc:
        raise _translate(exc) from exc


@router.get("/walkthroughs/{walkthrough_id}/definition")
def get_walkthrough_definition(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
) -> dict:
    # Walkthrough definitions are static, non-account-specific data (read
    # from the in-process registry, never touching the database or any
    # account's storage), so `scope` itself is unused below. It is still
    # required: every user-facing route must resolve account scope per
    # test_account_ownership.py::test_every_user_facing_route_resolves_account_scope,
    # so an unauthenticated caller can never reach any /api/onboarding
    # route, this one included.
    del scope
    try:
        definition = _get_walkthrough_definition(walkthrough_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown walkthrough: {walkthrough_id}")
    return {
        "walkthrough_id": definition.walkthrough_id,
        "version": definition.version,
        "title": definition.title,
        "steps": [
            {
                "step_id": step.step_id, "target": step.target,
                "title": step.title, "body": step.body,
                "placement": step.placement,
            }
            for step in definition.steps
        ],
    }


@router.post("/walkthroughs/{walkthrough_id}/begin", status_code=201)
def begin(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return begin_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/advance")
def advance(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return advance_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/back")
def back(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return go_back_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/interrupt")
def interrupt(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return interrupt_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/resume")
def resume(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return resume_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/complete")
def complete(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return complete_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/skip")
def skip(
    walkthrough_id: str,
    body: SkipBody,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return skip_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id,
            reason=body.reason,
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/replay")
def replay(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return replay_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc
