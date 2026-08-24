from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID
from webapp.persistence.workspaces import get_profile_workspace_id
from webapp.services.http_api import require_job_workspace

_REVIEW_ARTIFACT_TYPES = (
    "profile_snapshot", "job_posting_snapshot", "job_understanding_result",
    "resolved_job_evidence", "job_fit_result", "application_intelligence_result",
)


def build_review_view_model(
    conn: sqlite3.Connection, workspace_id: str, *,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id, account_id=account_id)
    profile_workspace_id = get_profile_workspace_id(conn, account_id)
    return {
        artifact_type: get_current_artifact(
            conn,
            profile_workspace_id if artifact_type == "profile_snapshot" else workspace_id,
            artifact_type,
        )
        for artifact_type in _REVIEW_ARTIFACT_TYPES
    }
