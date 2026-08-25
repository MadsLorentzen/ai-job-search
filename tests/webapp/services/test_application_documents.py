import hashlib
from io import BytesIO

import pytest
from docx import Document

from tests.webapp.services.test_application_pack import _seed_completion_ready, _workspace
from webapp.services.application_documents import generate_application_documents
from webapp.services.application_documents import select_application_document
from webapp.services.application_documents import upload_application_document
from webapp.services.application_pack import confirm_application_pack
from webapp.services.http_api import change_job_status, render_job_application_pack_document
from webapp.persistence.application_documents import create_document_version, get_selection
from webapp.persistence.artifacts import get_current_artifact
from webapp.services.document_blob_store import DocumentBlobStore


def test_generation_persists_two_exact_originals_without_selection_or_workflow(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    before = conn.execute("SELECT workflow_status FROM workspaces WHERE id=?", (workspace_id,)).fetchone()[0]

    result = generate_application_documents(conn, workspace_id, documents_root=tmp_path / "docs", extensions_dir=tmp_path / "extensions", account_id="account_local")

    assert result["generation_artifact"]["payload"]["schema_version"] == "application-document-generation.v1"
    assert {row["document_kind"] for row in result["documents"]} == {"cv", "cover_letter"}
    assert all(row["origin"] == "ai_generated" and row["source_generation_artifact_id"] == result["generation_artifact"]["id"] for row in result["documents"])
    assert conn.execute("SELECT count(*) FROM application_document_selections").fetchone()[0] == 0
    assert conn.execute("SELECT workflow_status FROM workspaces WHERE id=?", (workspace_id,)).fetchone()[0] == before


def test_generation_rerun_creates_new_domain_versions_and_retains_old_bytes(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    args = dict(documents_root=tmp_path / "docs", extensions_dir=tmp_path / "extensions", account_id="account_local")
    first = generate_application_documents(conn, workspace_id, **args)
    second = generate_application_documents(conn, workspace_id, **args)
    assert {row["id"] for row in first["documents"]}.isdisjoint(row["id"] for row in second["documents"])
    assert {row["sha256"] for row in first["documents"]} == {row["sha256"] for row in second["documents"]}
    assert conn.execute("SELECT count(*) FROM application_document_versions").fetchone()[0] == 4


def test_exact_current_selections_confirm_as_v2_without_changing_legacy_path(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    documents_root = tmp_path / "docs"
    generated = generate_application_documents(conn, workspace_id, documents_root=documents_root, extensions_dir=tmp_path / "extensions", account_id="account_local")
    revisions = {}
    for row in generated["documents"]:
        selection = select_application_document(conn, workspace_id, kind=row["document_kind"], document_version_id=row["id"], expected_revision=0, account_id="account_local")
        revisions[row["document_kind"]] = selection["revision"]
    confirmed = confirm_application_pack(conn, workspace_id, effective_date="2026-08-25", documents_root=documents_root, account_id="account_local", document_selection_revisions=revisions)
    assert confirmed["pack"]["schema_version"] == "application-pack.v2"
    assert {item["document_version_id"] for item in confirmed["pack"]["final_documents"].values()} == {row["id"] for row in generated["documents"]}


def test_confirm_then_upload_without_select_keeps_current_pack_and_exact_cv_bytes(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    documents_root = tmp_path / "docs"
    generated = generate_application_documents(
        conn, workspace_id, documents_root=documents_root,
        extensions_dir=tmp_path / "extensions", account_id="account_local",
    )
    revisions = {}
    for row in generated["documents"]:
        revisions[row["document_kind"]] = select_application_document(
            conn, workspace_id, kind=row["document_kind"],
            document_version_id=row["id"], expected_revision=0,
            account_id="account_local",
        )["revision"]
    confirmed = confirm_application_pack(
        conn, workspace_id, effective_date="2026-08-25",
        documents_root=documents_root, account_id="account_local",
        document_selection_revisions=revisions,
    )
    pack_a_id = confirmed["artifact"]["id"]
    original_cv = next(row for row in generated["documents"] if row["document_kind"] == "cv")
    original_bytes = DocumentBlobStore(documents_root).read(original_cv)
    original_hash = hashlib.sha256(original_bytes).hexdigest()

    replacement_stream = BytesIO()
    replacement_document = Document()
    replacement_document.add_paragraph("Replacement CV that must remain unselected")
    replacement_document.save(replacement_stream)
    uploaded = upload_application_document(
        conn, workspace_id, kind="cv", filename="Replacement CV.docx",
        content=replacement_stream.getvalue(), documents_root=documents_root,
        account_id="account_local",
    )

    selection = get_selection(conn, workspace_id, "cv", account_id="account_local")
    assert uploaded["id"] != selection["document_version_id"]
    assert selection["document_version_id"] == original_cv["id"]
    assert selection["revision"] == revisions["cv"]
    assert get_current_artifact(conn, workspace_id, "application_pack")["id"] == pack_a_id
    assert conn.execute(
        "SELECT count(*) FROM artifacts WHERE workspace_id=? AND artifact_type='application_pack'",
        (workspace_id,),
    ).fetchone()[0] == 1

    current = render_job_application_pack_document(
        conn, workspace_id, kind="cv", documents_root=documents_root,
        account_id="account_local",
    )
    explicit = render_job_application_pack_document(
        conn, workspace_id, kind="cv", pack_artifact_id=pack_a_id,
        documents_root=documents_root, account_id="account_local",
    )
    assert current.content == explicit.content == original_bytes
    assert current.content_hash == explicit.content_hash == "sha256:" + original_hash


def test_applied_atomically_requires_current_selections_to_match_exact_v2_pack(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    documents_root = tmp_path / "docs"
    generated = generate_application_documents(conn, workspace_id, documents_root=documents_root, extensions_dir=tmp_path / "extensions", account_id="account_local")
    revisions = {}
    for row in generated["documents"]:
        revisions[row["document_kind"]] = select_application_document(conn, workspace_id, kind=row["document_kind"], document_version_id=row["id"], expected_revision=0, account_id="account_local")["revision"]
    confirmed = confirm_application_pack(conn, workspace_id, effective_date="2026-08-25", documents_root=documents_root, account_id="account_local", document_selection_revisions=revisions)
    replacement = dict(next(row for row in generated["documents"] if row["document_kind"] == "cv"))
    replacement["id"] = "docv_replacement"
    replacement["origin"] = "user_uploaded"
    replacement["source_generation_artifact_id"] = None
    create_document_version(conn, replacement)
    select_application_document(conn, workspace_id, kind="cv", document_version_id=replacement["id"], expected_revision=revisions["cv"], account_id="account_local")
    with pytest.raises(Exception, match="reconfirm"):
        change_job_status(conn, workspace_id, new_status="applied", effective_date="2026-08-25", note=None, account_id="account_local")
    assert conn.execute("SELECT workflow_status FROM workspaces WHERE id=?", (workspace_id,)).fetchone()[0] == "drafted"
    select_application_document(conn, workspace_id, kind="cv", document_version_id=confirmed["pack"]["final_documents"]["cv"]["document_version_id"], expected_revision=revisions["cv"] + 1, account_id="account_local")
    changed = change_job_status(conn, workspace_id, new_status="applied", effective_date="2026-08-25", note=None, account_id="account_local")
    event = conn.execute("SELECT * FROM workflow_events WHERE new_status='applied'").fetchone()
    assert changed["workflow_status"] == "applied"
    assert event["submitted_pack_artifact_id"] == confirmed["artifact"]["id"]
