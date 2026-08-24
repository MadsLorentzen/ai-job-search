from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterator

from fastapi import Depends, HTTPException, Request

from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID, get_account
from webapp.persistence.db import connect
from webapp.services.ownership import AccountScope, account_profile_root


def get_conn(request: Request) -> Iterator[sqlite3.Connection]:
    conn = connect(request.app.state.settings.db_path)
    try:
        yield conn
    finally:
        conn.close()


def get_extensions_dir(request: Request) -> Path:
    return request.app.state.settings.extensions_dir


def get_documents_root(request: Request) -> Path:
    return request.app.state.settings.documents_root


def get_account_scope(
    request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
) -> AccountScope:
    # One application instance currently serves one configured account. Future
    # authentication should replace this resolver, not the persisted ownership
    # model. Every user-facing route must depend on this scope explicitly.
    account_id = request.app.state.settings.account_id or DEFAULT_ACCOUNT_ID
    if get_account(conn, account_id) is None:
        raise HTTPException(status_code=503, detail="configured account is unavailable")
    return AccountScope(
        account_id=account_id,
        profile_root=account_profile_root(
            request.app.state.settings.profile_root, account_id
        ),
    )
