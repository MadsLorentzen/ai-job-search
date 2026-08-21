from __future__ import annotations

import sqlite3
from pathlib import Path
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
    "job_fit_request": (
        "profile_snapshot", "resolved_job_evidence", "server:active_extensions",
        "server:evaluation_policy", "server:semantic_fit_policy", "server:semantic_proposer_policy",
        "server:semantic_proposals",
    ),
    "job_fit_result": ("profile_snapshot", "resolved_job_evidence", "job_fit_request"),
    "application_intelligence_request": (
        "profile_snapshot", "job_fit_result", "server:application_intelligence_policy",
        "server:application_intelligence_generation_contract",
    ),
    "application_intelligence_result": ("profile_snapshot", "job_fit_result", "application_intelligence_request"),
    "application_pack": ("job_fit_result", "application_intelligence_result"),
}


def record_dependency_fingerprint(
    conn: sqlite3.Connection, *, artifact_id: str, upstream_artifact_type: str, upstream_content_id: str,
    commit: bool = True,
) -> None:
    conn.execute(
        "INSERT INTO dependency_fingerprints (artifact_id, upstream_artifact_type, upstream_content_id) "
        "VALUES (?, ?, ?) ON CONFLICT(artifact_id, upstream_artifact_type) DO UPDATE SET upstream_content_id = excluded.upstream_content_id",
        (artifact_id, upstream_artifact_type, upstream_content_id),
    )
    if commit:
        conn.commit()


def check_staleness(
    conn: sqlite3.Connection, workspace_id: str, artifact_type: str, *,
    extensions_dir: Path | str = Path("extensions"),
) -> dict[str, Any]:
    return _check_staleness_recursive(
        conn, workspace_id, artifact_type, set(), Path(extensions_dir)
    )


def _check_staleness_recursive(
    conn: sqlite3.Connection, workspace_id: str, artifact_type: str, visiting: set[str],
    extensions_dir: Path,
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
        recorded = fingerprints.get(upstream_type)
        if recorded is None:
            reasons.append(f"required fingerprint {upstream_type!r} is missing")
            continue

        if upstream_type.startswith("server:"):
            try:
                current_identity = _server_input_identity(
                    upstream_type, current, extensions_dir
                )
            except Exception as exc:
                reasons.append(f"{upstream_type} cannot be resolved: {exc}")
                continue
            if recorded != current_identity:
                reasons.append(
                    f"{upstream_type} changed (used {recorded!r}, current is {current_identity!r})"
                )
            continue

        upstream_lookup_workspace_id = PROFILE_WORKSPACE_ID if upstream_type == "profile_snapshot" else workspace_id
        upstream_current = get_current_artifact(conn, upstream_lookup_workspace_id, upstream_type)
        if upstream_current is None:
            reasons.append(f"required upstream artifact {upstream_type!r} is missing")
            continue

        if recorded != upstream_current["content_id"]:
            reasons.append(
                f"{upstream_type} changed (used {recorded!r}, current is {upstream_current['content_id']!r})"
            )
            continue  # direct mismatch already explains staleness; skip the transitive check for this branch

        upstream_staleness = _check_staleness_recursive(
            conn, workspace_id, upstream_type, visiting, extensions_dir
        )
        if upstream_staleness["stale"]:
            reasons.append(f"{upstream_type} is itself stale: {'; '.join(upstream_staleness['reasons'])}")

    return {"stale": bool(reasons), "reasons": reasons}


def _server_input_identity(
    input_type: str, artifact: dict[str, Any], extensions_dir: Path,
) -> str:
    from webapp.services.input_identity import (
        application_intelligence_generation_contract_identity,
        application_intelligence_policy_identity,
        current_active_extensions_identity,
        evaluation_policy_identity,
        semantic_fit_policy_identity,
        semantic_proposals_identity,
        semantic_proposer_policy_identity,
    )

    payload = artifact["payload"]
    if input_type == "server:active_extensions":
        return current_active_extensions_identity(
            payload.get("active_extensions", []), extensions_dir
        )
    if input_type == "server:evaluation_policy":
        return evaluation_policy_identity()
    if input_type == "server:semantic_fit_policy":
        return semantic_fit_policy_identity()
    if input_type == "server:semantic_proposer_policy":
        return semantic_proposer_policy_identity()
    if input_type == "server:semantic_proposals":
        return semantic_proposals_identity(payload.get("semantic_proposals", {}))
    if input_type == "server:application_intelligence_policy":
        return application_intelligence_policy_identity()
    if input_type == "server:application_intelligence_generation_contract":
        return application_intelligence_generation_contract_identity()
    raise ValueError(f"unknown mutable server input {input_type!r}")
