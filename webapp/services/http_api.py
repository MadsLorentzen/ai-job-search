"""Service boundary used by thin HTTP routers.

Routes parse HTTP data and call one function here. This module owns server-side
extension resolution, job-workspace enforcement, exact submitted-pack binding,
and restoration of current-artifact pointers after a failed processing stage.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Callable

from webapp.persistence.artifacts import get_artifact, get_current_artifact
from webapp.persistence.review import DISPOSITIONS, save_review_decision
from webapp.persistence.workflow import record_status_change
from webapp.persistence.workspaces import get_workspace, list_workspaces
from webapp.services.application_pack import (
    confirm_application_pack,
    retry_application_pack_projection,
)
from webapp.services.extension_registry import (
    ExtensionRegistryError,
    list_installed_extensions,
    resolve_active_extensions,
)
from webapp.services.pipeline import (
    PipelineError,
    create_job_from_source_record,
    run_application_intelligence,
    run_job_fit,
    run_job_understanding,
)


class JobWorkspaceNotFound(LookupError):
    pass


def require_job_workspace(conn: sqlite3.Connection, workspace_id: str) -> dict[str, Any]:
    workspace = get_workspace(conn, workspace_id)
    if workspace is None or workspace["kind"] != "job":
        raise JobWorkspaceNotFound(f"job workspace {workspace_id!r} not found")
    return workspace


def list_job_workspaces(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return list_workspaces(conn)


def get_job_workspace(conn: sqlite3.Connection, workspace_id: str) -> dict[str, Any]:
    return require_job_workspace(conn, workspace_id)


def create_job_workspace(
    conn: sqlite3.Connection, *, company: str, title: str, source_record: dict[str, Any]
) -> dict[str, Any]:
    return create_job_from_source_record(
        conn, company=company, title=title, source_record=source_record
    )


def list_public_extensions(extensions_dir: Path) -> list[dict[str, Any]]:
    try:
        installed = list_installed_extensions(extensions_dir)
    except ExtensionRegistryError as exc:
        raise PipelineError(str(exc)) from exc
    return [
        {"id": item["id"], "version": item["version"], "name": item["name"]}
        for item in installed
    ]


def _preserve_current_artifacts(
    conn: sqlite3.Connection, workspace_id: str, operation: Callable[[], dict[str, Any]]
) -> dict[str, Any]:
    before = [
        (row["artifact_type"], row["artifact_id"])
        for row in conn.execute(
            "SELECT artifact_type, artifact_id FROM current_artifacts WHERE workspace_id = ?",
            (workspace_id,),
        ).fetchall()
    ]
    try:
        return operation()
    except Exception:
        # Pipeline stages commit immutable intermediate artifacts as they go.
        # On failure those records may remain useful audit history, but none
        # may replace the last successful CURRENT artifact exposed to users.
        conn.execute("DELETE FROM current_artifacts WHERE workspace_id = ?", (workspace_id,))
        conn.executemany(
            "INSERT INTO current_artifacts (workspace_id, artifact_type, artifact_id) VALUES (?, ?, ?)",
            [(workspace_id, artifact_type, artifact_id) for artifact_type, artifact_id in before],
        )
        conn.commit()
        raise


def understand_job(
    conn: sqlite3.Connection, workspace_id: str, provider: Any, *, request_id: str
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id)
    return _preserve_current_artifacts(
        conn, workspace_id,
        lambda: run_job_understanding(conn, workspace_id, provider, request_id=request_id),
    )


def fit_job(
    conn: sqlite3.Connection, workspace_id: str, semantic_adapter: Any, *, request_id: str,
    extension_ids: list[str], extensions_dir: Path,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id)
    try:
        extensions = resolve_active_extensions(extensions_dir, extension_ids)
    except ExtensionRegistryError as exc:
        raise PipelineError(str(exc)) from exc
    return _preserve_current_artifacts(
        conn, workspace_id,
        lambda: run_job_fit(
            conn, workspace_id, semantic_adapter, request_id=request_id,
            active_extensions=extensions,
        ),
    )


def generate_application_intelligence(
    conn: sqlite3.Connection, workspace_id: str, provider: Any, *, request_id: str
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id)
    return _preserve_current_artifacts(
        conn, workspace_id,
        lambda: run_application_intelligence(
            conn, workspace_id, provider, request_id=request_id
        ),
    )


def record_review_decision(
    conn: sqlite3.Connection, workspace_id: str, *, review_item_type: str,
    source_artifact_id: str, domain_item_id: str | None, disposition: str,
    note: str | None,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id)
    if disposition not in DISPOSITIONS:
        raise PipelineError(f"unknown disposition: {disposition!r}")
    source = get_artifact(conn, source_artifact_id)
    if source is None or source["workspace_id"] not in {workspace_id, "profile"}:
        raise PipelineError("review source artifact does not belong to this workflow")
    return save_review_decision(
        conn, workspace_id=workspace_id, review_item_type=review_item_type,
        source_artifact_id=source_artifact_id, domain_item_id=domain_item_id,
        disposition=disposition, note=note,
    )


def confirm_job_application_pack(
    conn: sqlite3.Connection, workspace_id: str, *, effective_date: str,
    documents_root: Path, extensions_dir: Path,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id)
    return confirm_application_pack(
        conn, workspace_id, effective_date=effective_date, documents_root=documents_root,
        extensions_dir=extensions_dir,
    )


def retry_job_application_pack_projection(
    conn: sqlite3.Connection, workspace_id: str, *, pack_artifact_id: str,
    documents_root: Path,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id)
    return retry_application_pack_projection(
        conn, workspace_id, pack_artifact_id=pack_artifact_id,
        documents_root=documents_root,
    )


def change_job_status(
    conn: sqlite3.Connection, workspace_id: str, *, new_status: str,
    effective_date: str, note: str | None,
) -> dict[str, Any]:
    if new_status == "drafted":
        raise PipelineError(
            "drafted can only be set via POST /api/workspaces/{id}/application-pack (Gate 4)"
        )
    try:
        # Bind status validation and the exact current submitted pack under one
        # SQLite write reservation. A concurrent Gate-4 confirmation cannot
        # promote Pack B between reading Pack A and recording ``applied``.
        conn.execute("BEGIN IMMEDIATE")
        require_job_workspace(conn, workspace_id)
        submitted_pack_id = None
        if new_status == "applied":
            current_pack = get_current_artifact(conn, workspace_id, "application_pack")
            submitted_pack_id = current_pack["id"] if current_pack else None
        record_status_change(
            conn, workspace_id=workspace_id, new_status=new_status,
            effective_date=effective_date, note=note,
            submitted_pack_artifact_id=submitted_pack_id,
            commit=False,
        )
        conn.commit()
    except ValueError as exc:
        conn.rollback()
        raise PipelineError(str(exc)) from exc
    except Exception:
        conn.rollback()
        raise
    return require_job_workspace(conn, workspace_id)
