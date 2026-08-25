"""Owner-scoped persistence for immutable application-document versions."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from product.application_document_contract import validate_document_version


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_document_version_id() -> str:
    return f"docv_{uuid.uuid4().hex[:20]}"


def create_document_version(conn: sqlite3.Connection, value: dict[str, Any], *, commit: bool = True) -> dict[str, Any]:
    validate_document_version(value)
    conn.execute(
        "INSERT INTO application_document_versions "
        "(id, account_id, source_workspace_id, document_kind, origin, original_filename, "
        "media_type, byte_length, sha256, storage_key, source_generation_artifact_id, created_at) "
        "VALUES (:id, :account_id, :source_workspace_id, :document_kind, :origin, "
        ":original_filename, :media_type, :byte_length, :sha256, :storage_key, "
        ":source_generation_artifact_id, :created_at)",
        value,
    )
    if commit:
        conn.commit()
    return get_document_version(conn, value["id"], account_id=value["account_id"])


def get_document_version(conn: sqlite3.Connection, document_version_id: str, *, account_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM application_document_versions WHERE id=? AND account_id=?",
        (document_version_id, account_id),
    ).fetchone()
    return dict(row) if row else None


def list_document_versions(conn: sqlite3.Connection, *, account_id: str, workspace_id: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM application_document_versions WHERE account_id=?"
    args: list[Any] = [account_id]
    if workspace_id is not None:
        sql += " AND source_workspace_id=?"
        args.append(workspace_id)
    rows = conn.execute(sql + " ORDER BY created_at DESC, id DESC", args).fetchall()
    return [dict(row) for row in rows]


def get_selection(conn: sqlite3.Connection, workspace_id: str, kind: str, *, account_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM application_document_selections WHERE workspace_id=? AND account_id=? AND document_kind=?",
        (workspace_id, account_id, kind),
    ).fetchone()
    return dict(row) if row else None


def set_selection(conn: sqlite3.Connection, *, workspace_id: str, account_id: str, kind: str, document_version_id: str, expected_revision: int, commit: bool = True) -> dict[str, Any]:
    current = get_selection(conn, workspace_id, kind, account_id=account_id)
    actual = current["revision"] if current else 0
    if actual != expected_revision:
        raise ValueError("selection revision conflict")
    revision = actual + 1
    now = _now()
    if current:
        cursor = conn.execute(
            "UPDATE application_document_selections SET document_version_id=?, revision=?, selected_at=? "
            "WHERE workspace_id=? AND account_id=? AND document_kind=? AND revision=?",
            (document_version_id, revision, now, workspace_id, account_id, kind, actual),
        )
        if cursor.rowcount != 1:
            raise ValueError("selection revision conflict")
    else:
        conn.execute(
            "INSERT INTO application_document_selections "
            "(workspace_id, account_id, document_kind, document_version_id, revision, selected_at) "
            "VALUES (?, ?, ?, ?, 1, ?)",
            (workspace_id, account_id, kind, document_version_id, now),
        )
    if commit:
        conn.commit()
    return get_selection(conn, workspace_id, kind, account_id=account_id)


def save_reusable(conn: sqlite3.Connection, *, account_id: str, document_version_id: str, label: str | None, commit: bool = True) -> dict[str, Any]:
    conn.execute(
        "INSERT INTO reusable_application_documents (account_id, document_version_id, label, saved_at) "
        "VALUES (?, ?, ?, ?) ON CONFLICT(account_id, document_version_id) DO UPDATE SET label=excluded.label, saved_at=excluded.saved_at",
        (account_id, document_version_id, label, _now()),
    )
    if commit:
        conn.commit()
    return dict(conn.execute("SELECT * FROM reusable_application_documents WHERE account_id=? AND document_version_id=?", (account_id, document_version_id)).fetchone())


def remove_reusable(conn: sqlite3.Connection, *, account_id: str, document_version_id: str, commit: bool = True) -> None:
    conn.execute("DELETE FROM reusable_application_documents WHERE account_id=? AND document_version_id=?", (account_id, document_version_id))
    if commit:
        conn.commit()


def list_reusable(conn: sqlite3.Connection, *, account_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT r.*, d.document_kind, d.original_filename, d.byte_length, d.sha256, d.origin, d.source_workspace_id "
        "FROM reusable_application_documents r JOIN application_document_versions d ON d.id=r.document_version_id AND d.account_id=r.account_id "
        "WHERE r.account_id=? ORDER BY r.saved_at DESC, r.document_version_id DESC", (account_id,)
    ).fetchall()
    return [dict(row) for row in rows]
