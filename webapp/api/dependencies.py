from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterator

from fastapi import Request

from webapp.persistence.db import connect


def get_conn(request: Request) -> Iterator[sqlite3.Connection]:
    conn = connect(request.app.state.settings.db_path)
    try:
        yield conn
    finally:
        conn.close()


def get_extensions_dir(request: Request) -> Path:
    return request.app.state.settings.extensions_dir


def get_documents_root(request: Request) -> Path:
    return request.app.state.settings.documents_root
