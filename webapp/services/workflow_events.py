from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.workflow import list_workflow_events
from webapp.services.http_api import require_job_workspace


def list_events(conn: sqlite3.Connection, workspace_id: str) -> list[dict[str, Any]]:
    require_job_workspace(conn, workspace_id)
    return list_workflow_events(conn, workspace_id)
