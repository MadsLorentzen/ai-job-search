"""Regression for a pre-existing SQLite thread-affinity bug in get_conn.

webapp.api.dependencies.get_conn is a generator dependency: FastAPI/
Starlette resolves it via anyio.to_thread.run_sync twice per request (once
to advance to the `yield`, once more during cleanup to run the `finally`
block), and anyio's threadpool is free to service those two calls on two
different worker threads. sqlite3.connect() defaults to
check_same_thread=True, so a connection created on one worker thread and
then queried or closed from a different worker thread raises
"SQLite objects created in a thread can only be used in that same thread."

This was invisible in this repo's browser tests until the Ticket 2
onboarding overlay added the first UI code that fires rapid, non-navigating
fetch() POSTs at a live server -- every earlier browser test does a full
page navigation between actions, which serializes requests and hid the
race. Discovered during onboarding Ticket 2 acceptance testing; fixed here
as a standalone infrastructure repair, not as onboarding feature work.
"""
from __future__ import annotations

import threading

import pytest

from webapp.persistence.db import connect, init_db


def test_connection_survives_use_from_a_different_thread_than_it_was_created_on(tmp_path):
    """Reproduces the exact failure shape anyio's threadpool can trigger:
    a connection opened on one thread, then queried on another."""
    db_path = tmp_path / "thread-safety.sqlite3"
    init_db(db_path)

    holder: dict = {}

    def create_on_thread_a():
        holder["conn"] = connect(db_path)

    creator = threading.Thread(target=create_on_thread_a)
    creator.start()
    creator.join()

    # Using the connection from this thread (the "different" thread) must
    # not raise sqlite3.ProgrammingError, matching the fix in
    # webapp/api/dependencies.py::get_conn (connect() with
    # check_same_thread=False).
    holder["conn"].execute("SELECT 1").fetchone()
    holder["conn"].close()


def test_connection_can_be_closed_from_a_different_thread_than_it_was_created_on(tmp_path):
    """Reproduces the specific finally-block half of get_conn's lifecycle:
    close() called from a worker thread other than the one that opened the
    connection."""
    db_path = tmp_path / "thread-safety-close.sqlite3"
    init_db(db_path)

    holder: dict = {}

    def create_on_thread_a():
        holder["conn"] = connect(db_path)

    creator = threading.Thread(target=create_on_thread_a)
    creator.start()
    creator.join()

    errors = []

    def close_on_thread_b():
        try:
            holder["conn"].close()
        except Exception as exc:  # pragma: no cover - only hit pre-fix
            errors.append(exc)

    closer = threading.Thread(target=close_on_thread_b)
    closer.start()
    closer.join()

    assert not errors, f"closing from a different thread raised: {errors}"
