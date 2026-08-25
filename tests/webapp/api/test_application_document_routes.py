import io
import zipfile

from fastapi.testclient import TestClient

from product.application_document_contract import DOCX_MEDIA_TYPE
from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace


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
