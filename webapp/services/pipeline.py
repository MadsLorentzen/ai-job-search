"""Orchestration over product/ modules. Never reimplements domain decisions —
every substantive judgment (evidence acceptance, fit, recommendation) comes
from calling into product/*; this module only sequences calls, persists exact
requests and results, and records dependency fingerprints for staleness.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any

from product.job_fit import profile_snapshot_content_id
from product.job_ingestion import normalize_job_source_record
from product.job_posting import job_snapshot_content_id
from product.job_understanding import (
    build_job_understanding_request,
    extract_job_understanding,
    load_job_understanding_policy,
)
from product.job_understanding_providers import JobUnderstandingProvider, JobUnderstandingProviderError
from product.profile_snapshot import build_snapshot

from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, create_workspace, ensure_profile_workspace
from webapp.services.staleness import record_dependency_fingerprint


class PipelineError(RuntimeError):
    """Raised when a pipeline stage cannot run: missing/invalid upstream state,
    or a wrapped product/*-layer or provider-layer failure. Callers in
    webapp/api need only catch this one type."""


def _hash_artifact(prefix: str, payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:20]
    return f"{prefix}{digest}"


def refresh_profile(conn: sqlite3.Connection, *, root: str = ".") -> dict[str, Any]:
    ensure_profile_workspace(conn)
    try:
        snapshot = build_snapshot(root)
    except Exception as exc:
        raise PipelineError(f"profile refresh failed: {exc}") from exc
    content_id = profile_snapshot_content_id(snapshot)
    return save_artifact(
        conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
        payload=snapshot, content_id=content_id,
    )


def get_current_profile_snapshot(conn: sqlite3.Connection) -> dict[str, Any] | None:
    return get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")


def create_job_from_source_record(
    conn: sqlite3.Connection, *, company: str, title: str, source_record: dict[str, Any]
) -> dict[str, Any]:
    workspace = create_workspace(conn, company=company, title=title)
    try:
        job_snapshot = normalize_job_source_record(source_record)
    except Exception as exc:
        raise PipelineError(f"job ingestion failed: {exc}") from exc
    content_id = job_snapshot_content_id(job_snapshot)
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_posting_snapshot",
        payload=job_snapshot, content_id=content_id,
    )
    return {"workspace": workspace, "artifact": artifact}


def run_job_understanding(
    conn: sqlite3.Connection, workspace_id: str, provider: JobUnderstandingProvider, *, request_id: str,
) -> dict[str, Any]:
    job_artifact = get_current_artifact(conn, workspace_id, "job_posting_snapshot")
    if job_artifact is None:
        raise PipelineError(f"workspace {workspace_id} has no job_posting_snapshot to understand")

    try:
        policy = load_job_understanding_policy()
        request = build_job_understanding_request(job_artifact["payload"], request_id, policy=policy)
    except Exception as exc:
        raise PipelineError(f"job understanding request construction failed: {exc}") from exc

    request_artifact = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_understanding_request",
        payload=request, content_id=_hash_artifact("jureq_", request),
    )
    record_dependency_fingerprint(
        conn, artifact_id=request_artifact["id"], upstream_artifact_type="job_posting_snapshot",
        upstream_content_id=job_artifact["content_id"],
    )

    try:
        # extract_job_understanding rebuilds the request internally via the
        # same deterministic build_job_understanding_request call above, so
        # the request it actually sends the provider is guaranteed identical
        # to `request`, already persisted above. It validates the provider's
        # candidate and the final result itself — Task 9 does not duplicate
        # any of that validation.
        result = extract_job_understanding(
            job_artifact["payload"], provider, request_id, policy=policy,
        )
    except JobUnderstandingProviderError as exc:
        raise PipelineError(f"job understanding provider failed: {exc}") from exc
    except Exception as exc:
        raise PipelineError(f"job understanding failed: {exc}") from exc

    result_artifact = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_understanding_result",
        payload=result, content_id=_hash_artifact("juresult_", result),
    )
    record_dependency_fingerprint(
        conn, artifact_id=result_artifact["id"], upstream_artifact_type="job_posting_snapshot",
        upstream_content_id=job_artifact["content_id"],
    )
    record_dependency_fingerprint(
        conn, artifact_id=result_artifact["id"], upstream_artifact_type="job_understanding_request",
        upstream_content_id=request_artifact["content_id"],
    )
    return result_artifact
