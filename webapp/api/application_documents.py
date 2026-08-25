from __future__ import annotations

import sqlite3
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from product.application_document_contract import DOCX_MEDIA_TYPE, ApplicationDocumentContractError
from product.docx_package import DocxPackageError
from webapp.api.dependencies import get_account_scope, get_conn, get_documents_root, get_extensions_dir
from webapp.services.application_documents import (
    download_application_document, generate_application_documents,
    list_application_documents, select_application_document, upload_application_document,
    set_application_document_reusable, unset_application_document_reusable,
)
from webapp.persistence.application_documents import list_reusable
from webapp.services.document_blob_store import DocumentBlobError
from webapp.services.ownership import AccountScope
from webapp.services.pipeline import PipelineError


router = APIRouter(prefix="/api/workspaces/{workspace_id}/application-documents", tags=["application-documents"])
reusable_router = APIRouter(prefix="/api/reusable-application-documents", tags=["application-documents"])


class SelectionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_version_id: str
    expected_revision: int


class ReusableBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str | None = None


def _error(exc: Exception) -> HTTPException:
    text = str(exc)
    return HTTPException(status_code=404 if "not found" in text else 400, detail=text)


@router.put("/selection/{kind}")
def put_selection(workspace_id: str, kind: str, body: SelectionBody, conn: sqlite3.Connection = Depends(get_conn), scope: AccountScope = Depends(get_account_scope)):
    try:
        return select_application_document(conn, workspace_id, kind=kind, document_version_id=body.document_version_id, expected_revision=body.expected_revision, account_id=scope.account_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PipelineError as exc:
        raise _error(exc) from exc


@router.post("/generate", status_code=201)
def post_generate(workspace_id: str, conn: sqlite3.Connection = Depends(get_conn), documents_root: Path = Depends(get_documents_root), extensions_dir: Path = Depends(get_extensions_dir), scope: AccountScope = Depends(get_account_scope)):
    try:
        return generate_application_documents(conn, workspace_id, documents_root=documents_root, extensions_dir=extensions_dir, account_id=scope.account_id)
    except (PipelineError, DocxPackageError, DocumentBlobError) as exc:
        raise _error(exc) from exc


@router.post("/upload/{kind}", status_code=201)
def post_upload(workspace_id: str, kind: str, file: UploadFile = File(...), conn: sqlite3.Connection = Depends(get_conn), documents_root: Path = Depends(get_documents_root), scope: AccountScope = Depends(get_account_scope)):
    try:
        content = file.file.read(10 * 1024 * 1024 + 1)
        if file.file.read(1):
            raise DocxPackageError("DOCX exceeds the compressed-size limit")
        return upload_application_document(conn, workspace_id, kind=kind, filename=file.filename or "", content=content, documents_root=documents_root, account_id=scope.account_id)
    except (PipelineError, DocxPackageError, ApplicationDocumentContractError, DocumentBlobError) as exc:
        raise _error(exc) from exc


@router.get("")
def get_documents(workspace_id: str, conn: sqlite3.Connection = Depends(get_conn), scope: AccountScope = Depends(get_account_scope)):
    try:
        result = list_application_documents(conn, workspace_id, account_id=scope.account_id)
        for item in result["versions"]:
            item.pop("storage_key", None)
        return result
    except PipelineError as exc:
        raise _error(exc) from exc


@router.get("/{document_version_id}/download")
def get_download(workspace_id: str, document_version_id: str, conn: sqlite3.Connection = Depends(get_conn), documents_root: Path = Depends(get_documents_root), scope: AccountScope = Depends(get_account_scope)):
    try:
        document, content = download_application_document(conn, workspace_id, document_version_id, documents_root=documents_root, account_id=scope.account_id)
    except (PipelineError, DocumentBlobError) as exc:
        raise _error(exc) from exc
    fallback = "CV.docx" if document["document_kind"] == "cv" else "Cover_Letter.docx"
    disposition = f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(document['original_filename'])}"
    return Response(content=content, media_type=DOCX_MEDIA_TYPE, headers={"Content-Disposition": disposition, "Content-Length": str(document["byte_length"]), "X-Content-Hash": "sha256:" + document["sha256"], "X-Document-Kind": document["document_kind"], "X-Document-Origin": document["origin"]})


@router.post("/{document_version_id}/save-for-reuse")
def post_reusable(workspace_id: str, document_version_id: str, body: ReusableBody, conn: sqlite3.Connection = Depends(get_conn), scope: AccountScope = Depends(get_account_scope)):
    try:
        return set_application_document_reusable(conn, workspace_id, document_version_id, label=body.label, account_id=scope.account_id)
    except PipelineError as exc:
        raise _error(exc) from exc


@router.delete("/{document_version_id}/save-for-reuse", status_code=204)
def delete_reusable(workspace_id: str, document_version_id: str, conn: sqlite3.Connection = Depends(get_conn), scope: AccountScope = Depends(get_account_scope)):
    try:
        unset_application_document_reusable(conn, workspace_id, document_version_id, account_id=scope.account_id)
    except PipelineError as exc:
        raise _error(exc) from exc


@reusable_router.get("")
def get_reusable(conn: sqlite3.Connection = Depends(get_conn), scope: AccountScope = Depends(get_account_scope)):
    return {"documents": list_reusable(conn, account_id=scope.account_id)}
