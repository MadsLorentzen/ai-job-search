"""Resolve exact immutable selected files for download and future submission handoff."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from product.application_pack_v2_contract import validate_application_pack_v2
from webapp.persistence.application_documents import get_document_version
from webapp.persistence.artifacts import get_artifact
from webapp.persistence.workspaces import get_workspace
from webapp.services.document_blob_store import DocumentBlobStore
from webapp.services.pipeline import PipelineError


def _manifest_matches_row(manifest: dict[str, Any], row: dict[str, Any]) -> bool:
    return manifest == {
        "document_version_id": row["id"], "document_kind": row["document_kind"],
        "origin": row["origin"],
        "source_generation_artifact_id": row["source_generation_artifact_id"],
        "sha256": row["sha256"], "byte_length": row["byte_length"],
        "original_filename": row["original_filename"],
    }


def resolve_application_handoff(conn: sqlite3.Connection, workspace_id: str, *, pack_artifact_id: str, documents_root: Path, account_id: str, enforce_handoff_state: bool = True) -> dict[str, Any]:
    workspace = get_workspace(conn, workspace_id, account_id=account_id)
    pack_artifact = get_artifact(conn, pack_artifact_id)
    if workspace is None or pack_artifact is None or pack_artifact["workspace_id"] != workspace_id or pack_artifact["artifact_type"] != "application_pack":
        raise PipelineError("application pack not found")
    try:
        pack = validate_application_pack_v2(pack_artifact["payload"])
    except ValueError as exc:
        raise PipelineError("application pack is not a selected-file pack") from exc
    if pack["confirmed_account_id"] != account_id:
        raise PipelineError("application pack not found")
    if enforce_handoff_state and workspace["workflow_status"] == "applied":
        applied = conn.execute(
            "SELECT submitted_pack_artifact_id FROM workflow_events WHERE workspace_id=? AND new_status='applied' ORDER BY created_at DESC LIMIT 1",
            (workspace_id,),
        ).fetchone()
        if applied is None or applied["submitted_pack_artifact_id"] != pack_artifact_id:
            raise PipelineError("requested pack is not the submitted application pack")
    elif enforce_handoff_state:
        current = {row["document_kind"]: row["document_version_id"] for row in conn.execute("SELECT document_kind, document_version_id FROM application_document_selections WHERE workspace_id=? AND account_id=?", (workspace_id, account_id)).fetchall()}
        expected = {kind: pack["final_documents"][kind]["document_version_id"] for kind in ("cv", "cover_letter")}
        if current != expected:
            raise PipelineError("current selections differ from the confirmed pack; reconfirm before handoff")
    store = DocumentBlobStore(documents_root)
    files = {}
    for kind in ("cv", "cover_letter"):
        manifest = pack["final_documents"][kind]
        row = get_document_version(conn, manifest["document_version_id"], account_id=account_id)
        if row is None or not _manifest_matches_row(manifest, row):
            raise PipelineError("confirmed application document metadata failed verification")
        content = store.read(row)
        files[kind] = {"metadata": row, "content": content}
    return {"pack_artifact_id": pack_artifact_id, "files": files}
