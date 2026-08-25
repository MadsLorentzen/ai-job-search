from tests.webapp.services.test_application_pack import _seed_completion_ready, _workspace
from webapp.services.application_documents import generate_application_documents
from webapp.services.application_documents import select_application_document
from webapp.services.application_pack import confirm_application_pack


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
