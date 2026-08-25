import io
import zipfile

from fastapi.testclient import TestClient

from product.application_document_contract import DOCX_MEDIA_TYPE
from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.accounts import create_account


def _docx():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr("word/document.xml", "<document/>")
    return output.getvalue()


def _client(tmp_path):
    settings = Settings(db_path=tmp_path / "db.sqlite3", documents_root=tmp_path / "documents")
    app = create_app(settings)
    client = TestClient(app)
    client.__enter__()
    conn = connect(settings.db_path)
    workspace = create_workspace(conn, company="Example", title="Role")
    conn.close()
    return client, settings, workspace["id"]


def test_upload_lists_and_downloads_exact_bytes_without_auto_selection(tmp_path):
    client, _, workspace_id = _client(tmp_path)
    try:
        content = _docx()
        response = client.post(f"/api/workspaces/{workspace_id}/application-documents/upload/cv", files={"file": ("My CV.docx", content, DOCX_MEDIA_TYPE)})
        assert response.status_code == 201, response.text
        version = response.json()
        listed = client.get(f"/api/workspaces/{workspace_id}/application-documents").json()
        assert listed["selections"]["cv"] is None
        assert "storage_key" not in listed["versions"][0]
        downloaded = client.get(f"/api/workspaces/{workspace_id}/application-documents/{version['id']}/download")
        assert downloaded.content == content
        assert downloaded.headers["x-document-kind"] == "cv"
        assert downloaded.headers["x-document-origin"] == "user_uploaded"
    finally:
        client.__exit__(None, None, None)


def test_invalid_upload_leaves_no_version_and_strict_route_does_not_accept_metadata(tmp_path):
    client, _, workspace_id = _client(tmp_path)
    try:
        response = client.post(f"/api/workspaces/{workspace_id}/application-documents/upload/cv", files={"file": ("bad.docx", b"not zip", DOCX_MEDIA_TYPE)}, data={"account_id": "forged"})
        assert response.status_code == 400
        assert client.get(f"/api/workspaces/{workspace_id}/application-documents").json()["versions"] == []
    finally:
        client.__exit__(None, None, None)


def test_use_this_version_is_explicit_and_optimistically_concurrent(tmp_path):
    client, _, workspace_id = _client(tmp_path)
    try:
        version = client.post(f"/api/workspaces/{workspace_id}/application-documents/upload/cv", files={"file": ("CV.docx", _docx(), DOCX_MEDIA_TYPE)}).json()
        selected = client.put(f"/api/workspaces/{workspace_id}/application-documents/selection/cv", json={"document_version_id": version["id"], "expected_revision": 0})
        assert selected.status_code == 200
        assert selected.json()["revision"] == 1
        stale = client.put(f"/api/workspaces/{workspace_id}/application-documents/selection/cv", json={"document_version_id": version["id"], "expected_revision": 0})
        assert stale.status_code == 409
    finally:
        client.__exit__(None, None, None)


def test_user_upload_can_be_reused_in_another_owned_workspace(tmp_path):
    client, settings, workspace_id = _client(tmp_path)
    try:
        conn = connect(settings.db_path)
        other = create_workspace(conn, company="Other", title="Role")
        conn.close()
        version = client.post(f"/api/workspaces/{workspace_id}/application-documents/upload/cv", files={"file": ("Reusable CV.docx", _docx(), DOCX_MEDIA_TYPE)}).json()
        saved = client.post(f"/api/workspaces/{workspace_id}/application-documents/{version['id']}/save-for-reuse", json={"label": "  General   CV  "})
        assert saved.json()["label"] == "General CV"
        assert client.get("/api/reusable-application-documents").json()["documents"][0]["document_version_id"] == version["id"]
        selected = client.put(f"/api/workspaces/{other['id']}/application-documents/selection/cv", json={"document_version_id": version["id"], "expected_revision": 0})
        assert selected.status_code == 200
    finally:
        client.__exit__(None, None, None)


def test_known_cross_account_workspace_and_document_ids_are_not_found(tmp_path):
    client, settings, _ = _client(tmp_path)
    try:
        conn = connect(settings.db_path)
        create_account(conn, account_id="account_b", display_name="B")
        private = create_workspace(conn, company="Private", title="Role", account_id="account_b")
        conn.close()
        b_app = create_app(Settings(db_path=settings.db_path, documents_root=settings.documents_root, account_id="account_b"))
        with TestClient(b_app) as b_client:
            uploaded = b_client.post(f"/api/workspaces/{private['id']}/application-documents/upload/cv", files={"file": ("Private.docx", _docx(), DOCX_MEDIA_TYPE)})
            assert uploaded.status_code == 201
            version_id = uploaded.json()["id"]
        assert client.get(f"/api/workspaces/{private['id']}/application-documents").status_code == 404
        assert client.get(f"/api/workspaces/{private['id']}/application-documents/{version_id}/download").status_code == 404
    finally:
        client.__exit__(None, None, None)
