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

from product.application_intelligence import analyze_application_intelligence
from product.application_intelligence_providers import ApplicationIntelligenceProvider, ApplicationIntelligenceProviderError
from product.evaluation_policy import load_evaluation_policy
from product.extensions import load_extensions
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
from product.semantic_job_fit import (
    analyze_semantic_job_fit,
    build_resolved_job_evidence_bundle,
    build_semantic_job_fit_request,
    load_semantic_fit_policy,
)

from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.provider_audits import save_provider_audit
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, create_workspace, ensure_profile_workspace
from webapp.services.semantic_proposal_adapter import (
    SemanticProposalAdapter,
    select_semantic_profile_evidence,
)
from webapp.services.semantic_proposer_errors import SemanticProposerProviderError
from webapp.services.staleness import record_dependency_fingerprint
from webapp.services.input_identity import (
    active_extensions_identity,
    application_intelligence_generation_contract_identity,
    content_identity,
    semantic_proposals_identity,
    semantic_proposer_policy_identity,
)


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
    conn: sqlite3.Connection, *, company: str, title: str, source_record: dict[str, Any],
    workspace_id: str | None = None, commit: bool = True,
) -> dict[str, Any]:
    try:
        job_snapshot = normalize_job_source_record(source_record)
    except Exception as exc:
        raise PipelineError(f"job ingestion failed: {exc}") from exc
    workspace = create_workspace(
        conn, company=company, title=title, workspace_id=workspace_id, commit=commit
    )
    content_id = job_snapshot_content_id(job_snapshot)
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_posting_snapshot",
        payload=job_snapshot, content_id=content_id, commit=commit,
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


def run_job_fit(
    conn: sqlite3.Connection, workspace_id: str, semantic_adapter: SemanticProposalAdapter, *,
    request_id: str, extension_paths: list[str] | None = None,
    active_extensions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    profile_artifact = get_current_profile_snapshot(conn)
    job_artifact = get_current_artifact(conn, workspace_id, "job_posting_snapshot")
    if profile_artifact is None or job_artifact is None:
        raise PipelineError(
            f"workspace {workspace_id} needs a current global profile snapshot and a "
            "job_posting_snapshot to run job fit"
        )

    understanding_request_artifact = get_current_artifact(conn, workspace_id, "job_understanding_request")
    understanding_result_artifact = get_current_artifact(conn, workspace_id, "job_understanding_result")
    # XOR guard mirrors product/semantic_job_fit.py's own validation — pass
    # both or neither, never one alone, so build_resolved_job_evidence_bundle
    # never raises a confusing downstream error for a Ticket-9-caused mismatch.
    if (understanding_request_artifact is None) != (understanding_result_artifact is None):
        raise PipelineError(
            f"workspace {workspace_id} has a job_understanding_request/result pair in an "
            "inconsistent state — rerun Job Understanding before retrying Job Fit"
        )

    try:
        bundle = build_resolved_job_evidence_bundle(
            job_artifact["payload"],
            job_understanding_request=understanding_request_artifact["payload"] if understanding_request_artifact else None,
            job_understanding_result=understanding_result_artifact["payload"] if understanding_result_artifact else None,
        )
    except Exception as exc:
        raise PipelineError(f"resolved job evidence construction failed: {exc}") from exc

    bundle_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence",
        payload=bundle, content_id=_hash_artifact("resolvedjobev_", bundle),
    )
    record_dependency_fingerprint(conn, artifact_id=bundle_saved["id"], upstream_artifact_type="job_posting_snapshot",
                                   upstream_content_id=job_artifact["content_id"])
    if understanding_result_artifact is not None:
        record_dependency_fingerprint(
            conn, artifact_id=bundle_saved["id"], upstream_artifact_type="job_understanding_request",
            upstream_content_id=understanding_request_artifact["content_id"],
        )
        record_dependency_fingerprint(
            conn, artifact_id=bundle_saved["id"], upstream_artifact_type="job_understanding_result",
            upstream_content_id=understanding_result_artifact["content_id"],
        )

    if active_extensions is not None and extension_paths is not None:
        raise PipelineError("supply active_extensions or extension_paths, not both")
    if active_extensions is None:
        try:
            active_extensions = load_extensions(extension_paths) if extension_paths else []
        except Exception as exc:
            raise PipelineError(f"extension loading failed: {exc}") from exc

    try:
        proposals = semantic_adapter.propose(
            profile_evidence=select_semantic_profile_evidence(profile_artifact["payload"]),
            resolved_job_evidence=bundle,
            active_extensions=active_extensions,
        )
    except SemanticProposerProviderError as exc:
        _persist_semantic_provider_audit(conn, workspace_id, semantic_adapter)
        raise PipelineError(f"semantic proposer failed: {exc}") from exc

    evaluation_policy = load_evaluation_policy()
    semantic_fit_policy = load_semantic_fit_policy()
    try:
        request = build_semantic_job_fit_request(
            request_id=request_id, profile_snapshot=profile_artifact["payload"],
            job_snapshot=job_artifact["payload"], resolved_job_evidence=bundle,
            active_extensions=active_extensions, evaluation_policy=evaluation_policy,
            semantic_fit_policy=semantic_fit_policy, semantic_proposals=proposals,
        )
    except Exception as exc:
        raise PipelineError(f"job fit request construction failed: {exc}") from exc

    request_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_request",
        payload=request, content_id=_hash_artifact("jofitreq_", request),
    )
    _persist_semantic_provider_audit(
        conn, workspace_id, semantic_adapter, request_artifact_id=request_saved["id"]
    )
    record_dependency_fingerprint(conn, artifact_id=request_saved["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile_artifact["content_id"])
    record_dependency_fingerprint(conn, artifact_id=request_saved["id"], upstream_artifact_type="resolved_job_evidence",
                                   upstream_content_id=bundle_saved["content_id"])
    for input_type, identity in (
        ("server:active_extensions", active_extensions_identity(active_extensions)),
        ("server:evaluation_policy", content_identity("evalpolicy_", evaluation_policy)),
        ("server:semantic_fit_policy", content_identity("semfitpolicy_", semantic_fit_policy)),
        ("server:semantic_proposer_policy", semantic_proposer_policy_identity()),
        ("server:semantic_proposals", semantic_proposals_identity(proposals)),
    ):
        record_dependency_fingerprint(
            conn, artifact_id=request_saved["id"], upstream_artifact_type=input_type,
            upstream_content_id=identity,
        )

    try:
        result = analyze_semantic_job_fit(request)
    except Exception as exc:
        raise PipelineError(f"job fit analysis failed: {exc}") from exc

    result_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload=result, content_id=_hash_artifact("jofitresult_", result),
    )
    record_dependency_fingerprint(conn, artifact_id=result_saved["id"], upstream_artifact_type="job_fit_request",
                                   upstream_content_id=request_saved["content_id"])
    record_dependency_fingerprint(conn, artifact_id=result_saved["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile_artifact["content_id"])
    record_dependency_fingerprint(conn, artifact_id=result_saved["id"], upstream_artifact_type="resolved_job_evidence",
                                   upstream_content_id=bundle_saved["content_id"])
    return result_saved


def run_application_intelligence(
    conn: sqlite3.Connection, workspace_id: str, ai_provider: ApplicationIntelligenceProvider, *, request_id: str,
) -> dict[str, Any]:
    profile_artifact = get_current_profile_snapshot(conn)
    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    bundle_artifact = get_current_artifact(conn, workspace_id, "resolved_job_evidence")
    if profile_artifact is None or fit_artifact is None or bundle_artifact is None:
        raise PipelineError(
            f"workspace {workspace_id} needs a current global profile snapshot, job_fit_result, "
            "and resolved_job_evidence to run application intelligence"
        )

    application_intelligence_policy = _load_application_intelligence_policy()
    request = {
        "schema_version": "application-intelligence-request.v0",
        "request_id": request_id,
        "job_fit_result": fit_artifact["payload"],
        "resolved_job_evidence": bundle_artifact["payload"],
        "profile_snapshot": profile_artifact["payload"],
        "policy": application_intelligence_policy,
    }
    request_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_request",
        payload=request, content_id=_hash_artifact("aiintelreq_", request),
    )
    record_dependency_fingerprint(conn, artifact_id=request_saved["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile_artifact["content_id"])
    record_dependency_fingerprint(conn, artifact_id=request_saved["id"], upstream_artifact_type="job_fit_result",
                                   upstream_content_id=fit_artifact["content_id"])
    record_dependency_fingerprint(
        conn, artifact_id=request_saved["id"],
        upstream_artifact_type="server:application_intelligence_policy",
        upstream_content_id=content_identity("aiintelpolicy_", application_intelligence_policy),
    )
    record_dependency_fingerprint(
        conn, artifact_id=request_saved["id"],
        upstream_artifact_type="server:application_intelligence_generation_contract",
        upstream_content_id=application_intelligence_generation_contract_identity(),
    )

    try:
        proposal_response = ai_provider.propose(request)
        result = analyze_application_intelligence(request, proposal_response.payload)
    except ApplicationIntelligenceProviderError as exc:
        raise PipelineError(f"application intelligence provider failed: {exc}") from exc
    except Exception as exc:
        raise PipelineError(f"application intelligence analysis failed: {exc}") from exc

    result_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload=result, content_id=_hash_artifact("aiintelresult_", result),
    )
    record_dependency_fingerprint(conn, artifact_id=result_saved["id"],
                                   upstream_artifact_type="application_intelligence_request",
                                   upstream_content_id=request_saved["content_id"])
    record_dependency_fingerprint(conn, artifact_id=result_saved["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile_artifact["content_id"])
    record_dependency_fingerprint(conn, artifact_id=result_saved["id"], upstream_artifact_type="job_fit_result",
                                   upstream_content_id=fit_artifact["content_id"])
    return result_saved


def _load_application_intelligence_policy() -> dict[str, Any]:
    from pathlib import Path
    policy_path = Path(__file__).resolve().parents[2] / "product" / "application_intelligence_policy.v0.json"
    return json.loads(policy_path.read_text(encoding="utf-8"))


def _persist_semantic_provider_audit(
    conn: sqlite3.Connection, workspace_id: str, semantic_adapter: Any, *,
    request_artifact_id: str | None = None,
) -> None:
    audit = getattr(semantic_adapter, "last_audit", None)
    if not isinstance(audit, dict):
        return
    save_provider_audit(
        conn, workspace_id=workspace_id, stage="semantic_job_fit_proposal",
        metadata=audit, request_artifact_id=request_artifact_id,
    )
