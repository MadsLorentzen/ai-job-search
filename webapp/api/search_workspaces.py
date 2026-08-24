from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from webapp.api.dependencies import get_account_scope, get_conn
from webapp.persistence.search_workspaces import (
    SearchWorkspaceConflictError,
    SearchWorkspaceError,
    archive_search_workspace,
    create_search_workspace,
    get_search_workspace,
    list_search_workspaces,
    rename_search_workspace,
    restore_search_workspace,
)
from webapp.services.ownership import AccountScope


router = APIRouter(prefix="/api/search-workspaces", tags=["search-workspaces"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class CreateBody(StrictBody):
    name: str
    copy_profile_from: str | None = None


class RenameBody(StrictBody):
    name: str
    expected_revision: int


class RevisionBody(StrictBody):
    expected_revision: int


def _mutate(operation):
    try:
        return {"search_workspace": operation()}
    except SearchWorkspaceConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SearchWorkspaceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _require_owned(
    conn: sqlite3.Connection, scope: AccountScope, search_workspace_id: str
) -> None:
    if get_search_workspace(
        conn, search_workspace_id, account_id=scope.account_id
    ) is None:
        raise HTTPException(status_code=404, detail="search workspace not found")


@router.get("")
def get_search_workspaces(
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    return {"search_workspaces": list_search_workspaces(
        conn, account_id=scope.account_id, include_archived=True
    )}


@router.post("", status_code=201)
def post_search_workspace(
    body: CreateBody,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    if body.copy_profile_from is not None:
        _require_owned(conn, scope, body.copy_profile_from)
    return _mutate(
        lambda: create_search_workspace(
            conn, name=body.name, copy_profile_from=body.copy_profile_from,
            account_id=scope.account_id,
        )
    )


@router.get("/{search_workspace_id}")
def get_one_search_workspace(
    search_workspace_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    workspace = get_search_workspace(
        conn, search_workspace_id, account_id=scope.account_id
    )
    if workspace is None:
        raise HTTPException(status_code=404, detail="search workspace not found")
    return {"search_workspace": workspace}


@router.patch("/{search_workspace_id}")
def patch_search_workspace(
    search_workspace_id: str,
    body: RenameBody,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    _require_owned(conn, scope, search_workspace_id)
    return _mutate(
        lambda: rename_search_workspace(
            conn,
            search_workspace_id,
            name=body.name,
            expected_revision=body.expected_revision,
            account_id=scope.account_id,
        )
    )


@router.post("/{search_workspace_id}/archive")
def post_archive_search_workspace(
    search_workspace_id: str,
    body: RevisionBody,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    _require_owned(conn, scope, search_workspace_id)
    return _mutate(
        lambda: archive_search_workspace(
            conn, search_workspace_id, expected_revision=body.expected_revision,
            account_id=scope.account_id,
        )
    )


@router.post("/{search_workspace_id}/restore")
def post_restore_search_workspace(
    search_workspace_id: str,
    body: RevisionBody,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    _require_owned(conn, scope, search_workspace_id)
    return _mutate(
        lambda: restore_search_workspace(
            conn, search_workspace_id, expected_revision=body.expected_revision,
            account_id=scope.account_id,
        )
    )
