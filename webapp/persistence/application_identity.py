from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID

from product.job_identity import (
    ApplicationIdentityResolution,
    JobIdentity,
    compare_job_identities,
    job_identity,
)


class ApplicationIdentityAmbiguityError(RuntimeError):
    pass


class ApplicationIdentityConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class ApplicationIdentityLookup:
    application_workspace_id: str | None
    resolution: ApplicationIdentityResolution | None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_application_workspace(
    conn: sqlite3.Connection,
    source_record: dict[str, Any],
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
) -> ApplicationIdentityLookup:
    incoming = job_identity(source_record)
    clauses = ["weak_fallback_key = ?"]
    values: list[str] = [incoming.weak_fallback_key]
    if incoming.source_record_key:
        clauses.append("source_record_key = ?")
        values.append(incoming.source_record_key)
    if incoming.canonical_url_key:
        clauses.append("canonical_url_key = ?")
        values.append(incoming.canonical_url_key)
    rows = conn.execute(
        "SELECT i.application_workspace_id, i.source_record_json "
        "FROM application_workspace_job_identities i "
        "JOIN workspaces w ON w.id = i.application_workspace_id "
        "WHERE w.account_id = ? AND (" + " OR ".join(clauses) + ")",
        [account_id, *values],
    ).fetchall()
    by_workspace: dict[str, list[ApplicationIdentityResolution]] = {}
    for row in rows:
        existing = job_identity(json.loads(row["source_record_json"]))
        by_workspace.setdefault(row["application_workspace_id"], []).append(
            compare_job_identities(existing, incoming)
        )

    same = sorted(
        workspace_id
        for workspace_id, resolutions in by_workspace.items()
        if ApplicationIdentityResolution.SAME in resolutions
    )
    if len(same) > 1:
        raise ApplicationIdentityConflictError(
            "strong job identity resolves to multiple application workspaces"
        )
    if same:
        return ApplicationIdentityLookup(same[0], ApplicationIdentityResolution.SAME)
    if any(
        ApplicationIdentityResolution.AMBIGUOUS in resolutions
        for resolutions in by_workspace.values()
    ):
        raise ApplicationIdentityAmbiguityError(
            "job identity is ambiguous: a weak fallback matches an application "
            "that has stronger identity"
        )
    return ApplicationIdentityLookup(None, None)


def save_application_identity(
    conn: sqlite3.Connection,
    *,
    application_workspace_id: str,
    source_record: dict[str, Any],
) -> None:
    identity = job_identity(source_record)
    existing = conn.execute(
        "SELECT 1 FROM application_workspace_job_identities "
        "WHERE application_workspace_id = ? AND source_record_key IS ? "
        "AND canonical_url_key IS ? AND weak_fallback_key = ?",
        (
            application_workspace_id,
            identity.source_record_key,
            identity.canonical_url_key,
            identity.weak_fallback_key,
        ),
    ).fetchone()
    if existing:
        return
    conn.execute(
        "INSERT OR IGNORE INTO application_workspace_job_identities "
        "(id, application_workspace_id, source_record_key, canonical_url_key, "
        "weak_fallback_key, source_record_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            f"appident_{uuid.uuid4().hex[:20]}",
            application_workspace_id,
            identity.source_record_key,
            identity.canonical_url_key,
            identity.weak_fallback_key,
            json.dumps(source_record, ensure_ascii=False, sort_keys=True),
            _now(),
        ),
    )


def record_application_origin(
    conn: sqlite3.Connection,
    *,
    application_workspace_id: str,
    search_workspace_id: str,
    discovery_candidate_id: str,
    discovery_occurrence_id: str,
    discovery_run_id: str | None,
) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO application_workspace_origins "
        "(id, application_workspace_id, search_workspace_id, discovery_candidate_id, "
        "discovery_occurrence_id, discovery_run_id, promoted_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            f"apporigin_{uuid.uuid4().hex[:20]}",
            application_workspace_id,
            search_workspace_id,
            discovery_candidate_id,
            discovery_occurrence_id,
            discovery_run_id,
            _now(),
        ),
    )
