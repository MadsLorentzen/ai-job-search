from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID

# Direct upstream artifact TYPES each artifact type depends on. Used only to
# know which fingerprint rows to expect/check — the actual comparison values
# come from dependency_fingerprints, never from guessing a field inside a
# domain payload.
DEPENDENCY_TYPES: dict[str, tuple[str, ...]] = {
    "job_understanding_request": ("job_posting_snapshot",),
    "job_understanding_result": ("job_posting_snapshot", "job_understanding_request"),
    "resolved_job_evidence": ("job_posting_snapshot", "job_understanding_request", "job_understanding_result"),
    "job_fit_request": ("profile_snapshot", "resolved_job_evidence"),
    "job_fit_result": ("profile_snapshot", "resolved_job_evidence", "job_fit_request"),
    "application_intelligence_request": ("profile_snapshot", "job_fit_result"),
    "application_intelligence_result": ("profile_snapshot", "job_fit_result", "application_intelligence_request"),
    "application_pack": ("job_fit_result", "application_intelligence_result"),
}


def record_dependency_fingerprint(
    conn: sqlite3.Connection, *, artifact_id: str, upstream_artifact_type: str, upstream_content_id: str,
) -> None:
    conn.execute(
        "INSERT INTO dependency_fingerprints (artifact_id, upstream_artifact_type, upstream_content_id) "
        "VALUES (?, ?, ?) ON CONFLICT(artifact_id, upstream_artifact_type) DO UPDATE SET upstream_content_id = excluded.upstream_content_id",
        (artifact_id, upstream_artifact_type, upstream_content_id),
    )
    conn.commit()


def check_staleness(conn: sqlite3.Connection, workspace_id: str, artifact_type: str) -> dict[str, Any]:
    return _check_staleness_recursive(conn, workspace_id, artifact_type, set())


def _check_staleness_recursive(
    conn: sqlite3.Connection, workspace_id: str, artifact_type: str, visiting: set[str],
) -> dict[str, Any]:
    if artifact_type in visiting:
        return {"stale": False, "reasons": []}  # cycle guard; DEPENDENCY_TYPES is acyclic by construction
    visiting = visiting | {artifact_type}

    # profile_snapshot artifacts live ONLY under the global profile workspace
    # (PROFILE_WORKSPACE_ID), never under a job workspace — matching how
    # webapp.services.pipeline.get_current_profile_snapshot and
    # workspace_view.py already read it. Every call site below (the direct
    # check_staleness(..., "profile_snapshot") case, the loop over
    # DEPENDENCY_TYPES, and the recursive descent) goes through this one
    # resolution so the lookup is never wrong regardless of which workspace
    # id the caller passed in.
    lookup_workspace_id = PROFILE_WORKSPACE_ID if artifact_type == "profile_snapshot" else workspace_id
    current = get_current_artifact(conn, lookup_workspace_id, artifact_type)
    if current is None:
        return {"stale": False, "reasons": []}

    reasons: list[str] = []
    fingerprints = {
        row["upstream_artifact_type"]: row["upstream_content_id"]
        for row in conn.execute(
            "SELECT upstream_artifact_type, upstream_content_id FROM dependency_fingerprints WHERE artifact_id = ?",
            (current["id"],),
        ).fetchall()
    }

    for upstream_type in DEPENDENCY_TYPES.get(artifact_type, ()):
        upstream_lookup_workspace_id = PROFILE_WORKSPACE_ID if upstream_type == "profile_snapshot" else workspace_id
        upstream_current = get_current_artifact(conn, upstream_lookup_workspace_id, upstream_type)
        if upstream_current is None:
            continue

        recorded = fingerprints.get(upstream_type)
        if recorded is not None and recorded != upstream_current["content_id"]:
            reasons.append(
                f"{upstream_type} changed (used {recorded!r}, current is {upstream_current['content_id']!r})"
            )
            continue  # direct mismatch already explains staleness; skip the transitive check for this branch

        upstream_staleness = _check_staleness_recursive(conn, workspace_id, upstream_type, visiting)
        if upstream_staleness["stale"]:
            reasons.append(f"{upstream_type} is itself stale: {'; '.join(upstream_staleness['reasons'])}")

    return {"stale": bool(reasons), "reasons": reasons}
