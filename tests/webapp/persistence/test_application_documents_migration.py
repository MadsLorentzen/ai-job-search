import sqlite3

import pytest

from webapp.persistence.db import connect, init_db
from webapp.persistence.migrations import APPLICATION_DOCUMENTS_MIGRATION_ID
from webapp.persistence.workspaces import create_workspace


def test_fresh_bootstrap_and_idempotent_restart_create_empty_document_tables(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    init_db(path)
    conn = connect(path)
    assert conn.execute("SELECT id FROM schema_migrations WHERE id=?", (APPLICATION_DOCUMENTS_MIGRATION_ID,)).fetchone()
    for table in ("application_document_versions", "application_document_selections", "reusable_application_documents"):
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_document_metadata_is_database_immutable(tmp_path):
    path = tmp_path / "db.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Example", title="Role")
    conn.execute("INSERT INTO application_document_versions VALUES ('docv_1','account_local',?,'cv','user_uploaded','x.docx',?,1,?,'sha256/aa/x.docx',NULL,'now')", (workspace["id"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a" * 64))
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("UPDATE application_document_versions SET original_filename='y.docx' WHERE id='docv_1'")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("DELETE FROM application_document_versions WHERE id='docv_1'")
