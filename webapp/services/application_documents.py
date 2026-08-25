"""Application-document generation, upload, selection, and reuse services."""
from __future__ import annotations

import hashlib
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from product.application_document_contract import DOCX_MEDIA_TYPE, DOCUMENT_KINDS
from product.application_pack_contract import validate_application_pack_v1
from product.application_pack_renderer import render_application_pack
from product.docx_package import validate_docx_package
from webapp.application_material import application_material_completion
from webapp.persistence.application_documents import (
    create_document_version, get_document_version, get_selection, list_document_versions,
    list_reusable, new_document_version_id, remove_reusable, save_reusable, set_selection,
)
from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.workspaces import get_workspace
from webapp.services.application_pack import build_application_pack
from webapp.services.document_blob_store import DocumentBlobStore
from webapp.services.pipeline import PipelineError


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_writable_workspace(conn: sqlite3.Connection, workspace_id: str, account_id: str) -> dict[str, Any]:
    workspace = get_workspace(conn, workspace_id, account_id=account_id)
    if workspace is None or workspace["kind"] != "job":
        raise PipelineError("application workspace not found")
    if workspace["workflow_status"] not in (None, "drafted"):
        raise PipelineError("application documents cannot change after submission")
    return workspace


def _document_row(*, document_id: str, workspace_id: str, account_id: str, kind: str, origin: str, filename: str, blob: dict[str, Any], generation_id: str | None) -> dict[str, Any]:
    return {
        "id": document_id, "account_id": account_id,
        "source_workspace_id": workspace_id, "document_kind": kind, "origin": origin,
        "original_filename": filename, "media_type": DOCX_MEDIA_TYPE,
        "byte_length": blob["byte_length"], "sha256": blob["sha256"],
        "storage_key": blob["storage_key"],
        "source_generation_artifact_id": generation_id, "created_at": _now(),
    }


def generate_application_documents(conn: sqlite3.Connection, workspace_id: str, *, documents_root: Path, extensions_dir: Path, account_id: str) -> dict[str, Any]:
    try:
        conn.execute("BEGIN IMMEDIATE")
        _require_writable_workspace(conn, workspace_id, account_id)
        basis = build_application_pack(conn, workspace_id, extensions_dir=extensions_dir, account_id=account_id)
        validate_application_pack_v1(basis)
        completion = application_material_completion(basis)
        if completion["status"] != "READY":
            raise PipelineError("reviewed application material is not completion-ready")
        generation_id = f"art_{uuid.uuid4().hex[:20]}"
        version_ids = {kind: new_document_version_id() for kind in DOCUMENT_KINDS}
        rendered = render_application_pack(basis, source_pack_id=generation_id)
        store = DocumentBlobStore(documents_root)
        documents: dict[str, dict[str, Any]] = {}
        rows = []
        for kind in ("cv", "cover_letter"):
            file = rendered.file(kind)
            validate_docx_package(file.content, original_filename=file.filename)
            blob = store.publish(file.content)
            row = _document_row(document_id=version_ids[kind], workspace_id=workspace_id, account_id=account_id, kind=kind, origin="ai_generated", filename=file.filename, blob=blob, generation_id=generation_id)
            rows.append(row)
            documents[kind] = {"document_version_id": row["id"], "original_filename": row["original_filename"], "byte_length": row["byte_length"], "sha256": row["sha256"]}
        payload = {"schema_version": "application-document-generation.v1", "reviewed_application_pack": basis, "renderer_version": rendered.renderer_version, "documents": documents, "account_id": account_id}
        artifact = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_document_generation", payload=payload, artifact_id=generation_id, commit=False)
        for row in rows:
            create_document_version(conn, row, commit=False)
        conn.commit()
        return {"generation_artifact": artifact, "documents": rows}
    except Exception:
        conn.rollback()
        raise


def upload_application_document(conn: sqlite3.Connection, workspace_id: str, *, kind: str, filename: str, content: bytes, documents_root: Path, account_id: str) -> dict[str, Any]:
    if kind not in DOCUMENT_KINDS:
        raise PipelineError("invalid application document kind")
    metadata = validate_docx_package(content, original_filename=filename)
    store = DocumentBlobStore(documents_root)
    blob = store.publish(content)
    assert metadata.byte_length == blob["byte_length"] and metadata.sha256 == blob["sha256"]
    try:
        conn.execute("BEGIN IMMEDIATE")
        _require_writable_workspace(conn, workspace_id, account_id)
        row = _document_row(document_id=new_document_version_id(), workspace_id=workspace_id, account_id=account_id, kind=kind, origin="user_uploaded", filename=filename, blob=blob, generation_id=None)
        created = create_document_version(conn, row, commit=False)
        conn.commit()
        return created
    except Exception:
        conn.rollback()
        raise


def list_application_documents(conn: sqlite3.Connection, workspace_id: str, *, account_id: str) -> dict[str, Any]:
    if get_workspace(conn, workspace_id, account_id=account_id) is None:
        raise PipelineError("application workspace not found")
    versions = list_document_versions(conn, account_id=account_id, workspace_id=workspace_id)
    reusable = list_reusable(conn, account_id=account_id)
    return {"versions": versions, "reusable": reusable, "selections": {kind: get_selection(conn, workspace_id, kind, account_id=account_id) for kind in DOCUMENT_KINDS}}


def select_application_document(conn: sqlite3.Connection, workspace_id: str, *, kind: str, document_version_id: str, expected_revision: int, account_id: str) -> dict[str, Any]:
    try:
        conn.execute("BEGIN IMMEDIATE")
        _require_writable_workspace(conn, workspace_id, account_id)
        document = get_document_version(conn, document_version_id, account_id=account_id)
        if document is None or document["document_kind"] != kind:
            raise PipelineError("application document not found")
        eligible = document["source_workspace_id"] == workspace_id or conn.execute("SELECT 1 FROM reusable_application_documents WHERE account_id=? AND document_version_id=?", (account_id, document_version_id)).fetchone()
        if not eligible:
            raise PipelineError("application document is not available to this workspace")
        selection = set_selection(conn, workspace_id=workspace_id, account_id=account_id, kind=kind, document_version_id=document_version_id, expected_revision=expected_revision, commit=False)
        conn.commit()
        return selection
    except Exception:
        conn.rollback()
        raise


def set_application_document_reusable(conn: sqlite3.Connection, workspace_id: str, document_version_id: str, *, label: str | None, account_id: str) -> dict[str, Any]:
    _require_writable_workspace(conn, workspace_id, account_id)
    document = get_document_version(conn, document_version_id, account_id=account_id)
    if document is None or document["source_workspace_id"] != workspace_id or document["origin"] != "user_uploaded":
        raise PipelineError("only owned user uploads can be saved for reuse")
    normalized = " ".join(label.split()) if isinstance(label, str) else None
    if normalized and len(normalized) > 120:
        raise PipelineError("reusable document label is too long")
    return save_reusable(conn, account_id=account_id, document_version_id=document_version_id, label=normalized or None)


def unset_application_document_reusable(conn: sqlite3.Connection, workspace_id: str, document_version_id: str, *, account_id: str) -> None:
    _require_writable_workspace(conn, workspace_id, account_id)
    document = get_document_version(conn, document_version_id, account_id=account_id)
    if document is None or document["source_workspace_id"] != workspace_id:
        raise PipelineError("application document not found")
    remove_reusable(conn, account_id=account_id, document_version_id=document_version_id)


def download_application_document(conn: sqlite3.Connection, workspace_id: str, document_version_id: str, *, documents_root: Path, account_id: str) -> tuple[dict[str, Any], bytes]:
    if get_workspace(conn, workspace_id, account_id=account_id) is None:
        raise PipelineError("application workspace not found")
    document = get_document_version(conn, document_version_id, account_id=account_id)
    if document is None:
        raise PipelineError("application document not found")
    allowed = document["source_workspace_id"] == workspace_id or conn.execute("SELECT 1 FROM application_document_selections WHERE workspace_id=? AND account_id=? AND document_version_id=?", (workspace_id, account_id, document_version_id)).fetchone() or conn.execute("SELECT 1 FROM reusable_application_documents WHERE account_id=? AND document_version_id=?", (account_id, document_version_id)).fetchone()
    if not allowed:
        raise PipelineError("application document not found")
    return document, DocumentBlobStore(documents_root).read(document)
