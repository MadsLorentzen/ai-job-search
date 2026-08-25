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
from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID
from webapp.persistence.review import DISPOSITIONS, save_review_decision
from webapp.persistence.workflow import record_status_change
from webapp.persistence.workspaces import (
    get_profile_workspace_id,
    get_workspace,
    list_workspaces,
)
from webapp.services.application_pack import (
    confirm_application_pack,
    retry_application_pack_projection,
)
from product.application_pack_renderer import RenderedFile, RendererError, render_application_pack
from product.application_pack_v2_contract import APPLICATION_PACK_V2
from webapp.services.application_handoff import resolve_application_handoff
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


def require_job_workspace(
    conn: sqlite3.Connection,
    workspace_id: str,
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    workspace = get_workspace(conn, workspace_id, account_id=account_id)
    if workspace is None or workspace["kind"] != "job":
        raise JobWorkspaceNotFound(f"job workspace {workspace_id!r} not found")
    return workspace


def list_job_workspaces(
    conn: sqlite3.Connection, *, account_id: str = DEFAULT_ACCOUNT_ID
) -> list[dict[str, Any]]:
    return list_workspaces(conn, account_id=account_id)


def get_job_workspace(
    conn: sqlite3.Connection,
    workspace_id: str,
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    return require_job_workspace(conn, workspace_id, account_id=account_id)


def create_job_workspace(
    conn: sqlite3.Connection, *, company: str, title: str,
    source_record: dict[str, Any], account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    return create_job_from_source_record(
        conn, company=company, title=title, source_record=source_record,
        account_id=account_id,
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
    conn: sqlite3.Connection, workspace_id: str, provider: Any, *, request_id: str,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id, account_id=account_id)
    return _preserve_current_artifacts(
        conn, workspace_id,
        lambda: run_job_understanding(conn, workspace_id, provider, request_id=request_id),
    )


def fit_job(
    conn: sqlite3.Connection, workspace_id: str, semantic_adapter: Any, *, request_id: str,
    extension_ids: list[str], extensions_dir: Path,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id, account_id=account_id)
    try:
        extensions = resolve_active_extensions(extensions_dir, extension_ids)
    except ExtensionRegistryError as exc:
        raise PipelineError(str(exc)) from exc
    return _preserve_current_artifacts(
        conn, workspace_id,
        lambda: run_job_fit(
            conn, workspace_id, semantic_adapter, request_id=request_id,
            active_extensions=extensions,
            account_id=account_id,
        ),
    )


def generate_application_intelligence(
    conn: sqlite3.Connection, workspace_id: str, provider: Any, *, request_id: str,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id, account_id=account_id)
    return _preserve_current_artifacts(
        conn, workspace_id,
        lambda: run_application_intelligence(
            conn, workspace_id, provider, request_id=request_id,
            account_id=account_id,
        ),
    )


def record_review_decision(
    conn: sqlite3.Connection, workspace_id: str, *, review_item_type: str,
    source_artifact_id: str, domain_item_id: str | None, disposition: str,
    note: str | None, commit: bool = True,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id, account_id=account_id)
    if disposition not in DISPOSITIONS:
        raise PipelineError(f"unknown disposition: {disposition!r}")
    source = get_artifact(conn, source_artifact_id)
    profile_workspace_id = get_profile_workspace_id(conn, account_id)
    if source is None or source["workspace_id"] not in {
        workspace_id,
        profile_workspace_id,
    }:
        raise PipelineError("review source artifact does not belong to this workflow")
    return save_review_decision(
        conn, workspace_id=workspace_id, review_item_type=review_item_type,
        source_artifact_id=source_artifact_id, domain_item_id=domain_item_id,
        disposition=disposition, note=note, commit=commit,
    )


def record_review_decisions(
    conn: sqlite3.Connection, workspace_id: str, decisions: list[dict[str, Any]],
    *, account_id: str = DEFAULT_ACCOUNT_ID,
) -> list[dict[str, Any]]:
    require_job_workspace(conn, workspace_id, account_id=account_id)
    if not decisions:
        raise PipelineError("at least one review decision is required")
    try:
        conn.execute("BEGIN IMMEDIATE")
        saved = [
            record_review_decision(
                conn,
                workspace_id,
                review_item_type=item["review_item_type"],
                source_artifact_id=item["source_artifact_id"],
                domain_item_id=item.get("domain_item_id"),
                disposition=item["disposition"],
                note=item.get("note"),
                commit=False,
                account_id=account_id,
            )
            for item in decisions
        ]
        conn.commit()
        return saved
    except Exception:
        conn.rollback()
        raise


def confirm_job_application_pack(
    conn: sqlite3.Connection, workspace_id: str, *, effective_date: str,
    documents_root: Path, extensions_dir: Path,
    account_id: str = DEFAULT_ACCOUNT_ID,
    document_selection_revisions: dict[str, int] | None = None,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id, account_id=account_id)
    return confirm_application_pack(
        conn, workspace_id, effective_date=effective_date, documents_root=documents_root,
        extensions_dir=extensions_dir, account_id=account_id,
        document_selection_revisions=document_selection_revisions,
    )


def retry_job_application_pack_projection(
    conn: sqlite3.Connection, workspace_id: str, *, pack_artifact_id: str,
    documents_root: Path,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> dict[str, Any]:
    require_job_workspace(conn, workspace_id, account_id=account_id)
    return retry_application_pack_projection(
        conn, workspace_id, pack_artifact_id=pack_artifact_id,
        documents_root=documents_root, account_id=account_id,
    )


def render_job_application_pack_document(
    conn: sqlite3.Connection,
    workspace_id: str,
    *,
    kind: str,
    pack_artifact_id: str | None = None,
    account_id: str = DEFAULT_ACCOUNT_ID,
    documents_root: Path = Path("documents"),
):
    """Render one document (``kind`` is ``"cv"`` or ``"cover_letter"``) from an
    immutable Application Pack belonging to ``workspace_id``.

    When ``pack_artifact_id`` is omitted, the workspace's current Application
    Pack is used. When it is given explicitly, that exact pack is rendered
    even if it is no longer current -- a historical immutable pack is never
    silently replaced by the current one.

    ``require_job_workspace`` scopes ``workspace_id`` to ``account_id`` before
    any artifact is read, so an explicit ``pack_artifact_id`` can never be
    used to reach a pack belonging to a workspace owned by another account:
    a workspace_id owned by a different account never resolves here at all.
    """
    require_job_workspace(conn, workspace_id, account_id=account_id)
    if pack_artifact_id is None:
        artifact = get_current_artifact(conn, workspace_id, "application_pack")
        if artifact is None:
            raise PipelineError(
                f"workspace {workspace_id} has no confirmed application pack to render"
            )
    else:
        artifact = get_artifact(conn, pack_artifact_id)
        if (
            artifact is None
            or artifact["workspace_id"] != workspace_id
            or artifact["artifact_type"] != "application_pack"
        ):
            raise PipelineError(
                f"application pack artifact {pack_artifact_id!r} does not belong to "
                f"workspace {workspace_id}"
            )
    if artifact["payload"].get("schema_version") == APPLICATION_PACK_V2:
        resolved = resolve_application_handoff(
            conn, workspace_id, pack_artifact_id=artifact["id"],
            documents_root=documents_root, account_id=account_id,
            enforce_handoff_state=False,
        )
        item = resolved["files"].get(kind)
        if item is None:
            raise PipelineError(f"application pack has no document of kind {kind!r}")
        metadata = item["metadata"]
        return RenderedFile(
            kind=kind, filename=metadata["original_filename"], content=item["content"],
            mime_type=metadata["media_type"], content_hash="sha256:" + metadata["sha256"],
        )
    try:
        rendered = render_application_pack(artifact["payload"], source_pack_id=artifact["id"])
        return rendered.file(kind)
    except RendererError as exc:
        raise PipelineError(str(exc)) from exc


def change_job_status(
    conn: sqlite3.Connection, workspace_id: str, *, new_status: str,
    effective_date: str, note: str | None,
    account_id: str = DEFAULT_ACCOUNT_ID,
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
        require_job_workspace(conn, workspace_id, account_id=account_id)
        submitted_pack_id = None
        if new_status == "applied":
            current_pack = get_current_artifact(conn, workspace_id, "application_pack")
            submitted_pack_id = current_pack["id"] if current_pack else None
        record_status_change(
            conn, workspace_id=workspace_id, new_status=new_status,
            effective_date=effective_date, note=note,
            submitted_pack_artifact_id=submitted_pack_id,
            commit=False, account_id=account_id,
        )
        conn.commit()
    except ValueError as exc:
        conn.rollback()
        raise PipelineError(str(exc)) from exc
    except Exception:
        conn.rollback()
        raise
    return require_job_workspace(conn, workspace_id, account_id=account_id)
