import pytest

from tests.webapp.services.test_application_pack import _seed_completion_ready, _workspace
from webapp.services.application_documents import generate_application_documents, select_application_document
from webapp.persistence.application_documents import create_document_version
from webapp.services.application_handoff import resolve_application_handoff
from webapp.services.application_pack import confirm_application_pack
from webapp.services.document_blob_store import DocumentBlobStore
from webapp.services.http_api import render_job_application_pack_document
from webapp.services.pipeline import PipelineError


def _confirmed(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    root = tmp_path / "documents"
    generated = generate_application_documents(conn, workspace_id, documents_root=root, extensions_dir=tmp_path / "extensions", account_id="account_local")
    revisions = {}
    for row in generated["documents"]:
        revisions[row["document_kind"]] = select_application_document(conn, workspace_id, kind=row["document_kind"], document_version_id=row["id"], expected_revision=0, account_id="account_local")["revision"]
    confirmed = confirm_application_pack(conn, workspace_id, effective_date="2026-08-25", documents_root=root, account_id="account_local", document_selection_revisions=revisions)
    return conn, workspace_id, root, generated, confirmed


def test_v2_download_and_handoff_return_exact_stored_bytes_without_renderer(tmp_path):
    conn, workspace_id, root, generated, confirmed = _confirmed(tmp_path)
    handoff = resolve_application_handoff(conn, workspace_id, pack_artifact_id=confirmed["artifact"]["id"], documents_root=root, account_id="account_local")
    originals = {row["document_kind"]: DocumentBlobStore(root).read(row) for row in generated["documents"]}
    assert {kind: item["content"] for kind, item in handoff["files"].items()} == originals
    assert render_job_application_pack_document(conn, workspace_id, kind="cv", pack_artifact_id=confirmed["artifact"]["id"], documents_root=root, account_id="account_local").content == originals["cv"]


def test_handoff_blocks_when_selection_differs_but_historical_download_remains_exact(tmp_path):
    conn, workspace_id, root, generated, confirmed = _confirmed(tmp_path)
    cv = next(row for row in generated["documents"] if row["document_kind"] == "cv")
    replacement = dict(cv)
    replacement.update(id="docv_other", origin="user_uploaded", source_generation_artifact_id=None)
    create_document_version(conn, replacement)
    select_application_document(conn, workspace_id, kind="cv", document_version_id=replacement["id"], expected_revision=1, account_id="account_local")
    with pytest.raises(PipelineError, match="reconfirm"):
        resolve_application_handoff(conn, workspace_id, pack_artifact_id=confirmed["artifact"]["id"], documents_root=root, account_id="account_local")
    rendered = render_job_application_pack_document(conn, workspace_id, kind="cv", pack_artifact_id=confirmed["artifact"]["id"], documents_root=root, account_id="account_local")
    assert rendered.content == DocumentBlobStore(root).read(cv)
