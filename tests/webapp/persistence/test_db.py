import sqlite3

from webapp.persistence.db import connect, init_db


def test_init_db_creates_all_tables(tmp_path):
    db_path = tmp_path / "sub" / "jobsearch.sqlite3"
    init_db(db_path)
    assert db_path.exists()

    conn = connect(db_path)
    try:
        names = {
            row["name"]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
    finally:
        conn.close()

    assert {
        "workspaces", "artifacts", "current_artifacts",
        "review_decisions", "workflow_events", "dependency_fingerprints", "provider_audits",
    }.issubset(names)


def test_init_db_is_idempotent(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    init_db(db_path)
    connect(db_path).close()


def test_connect_returns_row_factory_connection(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    try:
        assert conn.row_factory is sqlite3.Row
    finally:
        conn.close()


def test_connect_enforces_foreign_keys(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    try:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        conn.close()
