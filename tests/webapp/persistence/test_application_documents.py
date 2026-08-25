import pytest

from product.application_document_contract import DOCX_MEDIA_TYPE
from webapp.persistence.application_documents import create_document_version, get_document_version, set_selection
from webapp.persistence.db import connect, init_db
from webapp.persistence.workspaces import create_workspace


def _setup(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Example", title="Role")
    row = {"id": "docv_1", "account_id": "account_local", "source_workspace_id": workspace["id"], "document_kind": "cv", "origin": "user_uploaded", "original_filename": "Final.docx", "media_type": DOCX_MEDIA_TYPE, "byte_length": 8, "sha256": "a" * 64, "storage_key": "sha256/aa/" + "a" * 64 + ".docx", "source_generation_artifact_id": None, "created_at": "2026-08-25T00:00:00+00:00"}
    create_document_version(conn, row)
    return conn, workspace, row


def test_owner_scoped_create_get_and_optimistic_selection(tmp_path):
    conn, workspace, row = _setup(tmp_path)
    assert get_document_version(conn, row["id"], account_id="account_local") == row
    assert get_document_version(conn, row["id"], account_id="account_other") is None
    selected = set_selection(conn, workspace_id=workspace["id"], account_id="account_local", kind="cv", document_version_id=row["id"], expected_revision=0)
    assert selected["revision"] == 1
    with pytest.raises(ValueError, match="revision conflict"):
        set_selection(conn, workspace_id=workspace["id"], account_id="account_local", kind="cv", document_version_id=row["id"], expected_revision=0)
