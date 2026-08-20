from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID
from webapp.services.http_api import require_job_workspace

_REVIEW_ARTIFACT_TYPES = (
    "profile_snapshot", "job_posting_snapshot", "job_understanding_result",
    "resolved_job_evidence", "job_fit_result", "application_intelligence_result",
)


def build_review_view_model(
    conn: sqlite3.Connection, workspace_id: str
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id)
    return {
        artifact_type: get_current_artifact(
            conn,
            PROFILE_WORKSPACE_ID if artifact_type == "profile_snapshot" else workspace_id,
            artifact_type,
        )
        for artifact_type in _REVIEW_ARTIFACT_TYPES
    }
