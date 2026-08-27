from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(db_path: Path) -> sqlite3.Connection:
    # check_same_thread=False: FastAPI/Starlette resolve a sync generator
    # dependency (webapp/api/dependencies.py::get_conn) via
    # anyio.to_thread.run_sync twice per request -- once to advance to the
    # yield, once more to run the finally block -- and anyio's threadpool
    # may service those two calls on different worker threads. Each
    # connection here is still used by exactly one request at a time
    # (never shared across requests), so disabling sqlite3's same-thread
    # check is safe: it only relaxes *which* OS thread may touch a given
    # connection, not how many callers may touch it concurrently.
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Path) -> None:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(db_path)
    try:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        from webapp.persistence.migrations import apply_migrations

        apply_migrations(conn)
    finally:
        conn.close()
