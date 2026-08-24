from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID, validate_account_id
from webapp.persistence.search_workspaces import get_search_workspace
from webapp.persistence.workspaces import (
    ensure_profile_workspace,
    get_profile_workspace_id,
    get_workspace,
)


class OwnedResourceNotFound(LookupError):
    """A missing and a cross-owner resource deliberately share one result."""


@dataclass(frozen=True)
class AccountScope:
    account_id: str
    profile_root: Path

    def require_search_workspace(
        self, conn: sqlite3.Connection, search_workspace_id: str
    ) -> dict[str, Any]:
        workspace = get_search_workspace(
            conn, search_workspace_id, account_id=self.account_id
        )
        if workspace is None:
            raise OwnedResourceNotFound("search workspace not found")
        return workspace

    def require_job_workspace(
        self, conn: sqlite3.Connection, workspace_id: str
    ) -> dict[str, Any]:
        workspace = get_workspace(
            conn, workspace_id, account_id=self.account_id
        )
        if workspace is None or workspace["kind"] != "job":
            raise OwnedResourceNotFound("job workspace not found")
        return workspace

    def profile_workspace_id(
        self, conn: sqlite3.Connection, *, ensure: bool = False
    ) -> str | None:
        if ensure:
            return ensure_profile_workspace(
                conn, account_id=self.account_id
            )["id"]
        return get_profile_workspace_id(conn, self.account_id)


def account_profile_root(base_root: str | Path, account_id: str) -> Path:
    root = Path(base_root).resolve()
    if account_id == DEFAULT_ACCOUNT_ID:
        return root
    return root / ".jobsearch" / "accounts" / validate_account_id(account_id)
