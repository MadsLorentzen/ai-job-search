import sqlite3

import pytest

from webapp.persistence.db import connect, init_db
import webapp.persistence.migrations as migrations
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


def _return_to_003(conn):
    conn.execute("DROP TRIGGER application_document_versions_immutable_update")
    conn.execute("DROP TRIGGER application_document_versions_immutable_delete")
    conn.execute("DROP TRIGGER accounts_owned_aggregate_delete")
    conn.execute("DROP TABLE reusable_application_documents")
    conn.execute("DROP TABLE application_document_selections")
    conn.execute("DROP TABLE application_document_versions")
    conn.execute(
        "CREATE TRIGGER accounts_owned_aggregate_delete BEFORE DELETE ON accounts "
        "WHEN EXISTS (SELECT 1 FROM workspaces WHERE account_id=OLD.id) "
        "OR EXISTS (SELECT 1 FROM search_workspaces WHERE account_id=OLD.id) "
        "BEGIN SELECT RAISE(ABORT, 'account owns application data'); END"
    )
    conn.execute("DELETE FROM schema_migrations WHERE id=?", (APPLICATION_DOCUMENTS_MIGRATION_ID,))
    conn.commit()


def test_exact_003_upgrade_preserves_existing_data_and_adds_no_document_rows(tmp_path):
    path = tmp_path / "upgrade.sqlite3"
    init_db(path)
    conn = connect(path)
    workspace = create_workspace(conn, company="Existing", title="Role")
    _return_to_003(conn)
    migrations.apply_migrations(conn)
    assert conn.execute("SELECT company FROM workspaces WHERE id=?", (workspace["id"],)).fetchone()[0] == "Existing"
    assert conn.execute("SELECT count(*) FROM application_document_versions").fetchone()[0] == 0
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_failed_004_rolls_back_every_table_and_migration_marker(tmp_path, monkeypatch):
    path = tmp_path / "rollback.sqlite3"
    init_db(path)
    conn = connect(path)
    _return_to_003(conn)
    original = migrations._migrate_application_documents

    def fail_after_ddl(connection):
        original(connection)
        raise RuntimeError("injected 004 failure")

    monkeypatch.setattr(migrations, "_migrate_application_documents", fail_after_ddl)
    with pytest.raises(RuntimeError, match="injected"):
        migrations.apply_migrations(conn)
    assert conn.execute("SELECT 1 FROM schema_migrations WHERE id=?", (APPLICATION_DOCUMENTS_MIGRATION_ID,)).fetchone() is None
    assert conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='application_document_versions'").fetchone() is None
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
