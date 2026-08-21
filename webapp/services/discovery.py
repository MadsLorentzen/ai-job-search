from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from product.discovery_search import DiscoveryPortalRunner, SUPPORTED_DISCOVERY_SOURCES
from product.discovery_sources import portal_result_to_source_record
from product.evaluation_policy import load_evaluation_policy
from product.job_fit import profile_snapshot_content_id
from product.job_ingestion import normalize_job_source_record
from product.job_posting import job_snapshot_content_id
from product.job_understanding import extract_job_understanding, load_job_understanding_policy
from product.semantic_job_fit import (
    analyze_semantic_job_fit,
    build_resolved_job_evidence_bundle,
    build_semantic_job_fit_request,
    load_semantic_fit_policy,
)
from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.discovery import (
    complete_discovery_run,
    create_discovery_run,
    ingest_discovery_record,
    get_current_discovery_fit,
    get_discovery_candidate,
    get_latest_discovery_run,
    list_discovery_candidates,
    save_discovery_fit,
)
from webapp.persistence.user_profile import get_current_user_profile
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID
from webapp.services.input_identity import (
    active_extensions_identity,
    content_identity,
    semantic_proposals_identity,
    semantic_proposer_policy_identity,
)
from webapp.services.semantic_proposal_adapter import select_semantic_profile_evidence
from webapp.services.pipeline import create_job_from_source_record
from webapp.persistence.workspaces import get_workspace


class DiscoveryServiceError(RuntimeError):
    pass


def run_discovery_search(
    conn: sqlite3.Connection,
    runner: DiscoveryPortalRunner,
    *,
    sources: list[str] | None = None,
    queries: list[str] | None = None,
    locations: list[str] | None = None,
    limit_per_source: int = 20,
) -> dict[str, Any]:
    profile = get_current_user_profile(conn)
    if profile is None:
        raise DiscoveryServiceError("set up User Profile before searching for jobs")
    preferences = profile["payload"]
    selected_sources = sources if sources is not None else preferences["source_preferences"]
    if not selected_sources:
        selected_sources = list(SUPPORTED_DISCOVERY_SOURCES)
    if len(set(selected_sources)) != len(selected_sources):
        raise DiscoveryServiceError("discovery sources must not contain duplicates")
    unsupported = sorted(set(selected_sources) - set(SUPPORTED_DISCOVERY_SOURCES))
    if unsupported:
        raise DiscoveryServiceError("unsupported discovery sources: " + ", ".join(unsupported))
    selected_queries = queries if queries is not None else (
        preferences["search_terms"] or preferences["target_roles"]
    )
    selected_locations = locations if locations is not None else preferences["locations"]
    for field, values in (("queries", selected_queries), ("locations", selected_locations)):
        if len(values) > 20:
            raise DiscoveryServiceError(f"{field} must contain at most 20 values")
        if any(not isinstance(value, str) or not value.strip() or len(value) > 200 for value in values):
            raise DiscoveryServiceError(f"{field} values must be non-empty strings of at most 200 characters")
    if not 1 <= limit_per_source <= 50:
        raise DiscoveryServiceError("limit_per_source must be from 1 to 50")
    remote_mode = "remote" if preferences["remote_preference"] == "remote_only" else None
    request = {
        "sources": selected_sources,
        "queries": selected_queries,
        "locations": selected_locations,
        "recency_days": preferences["recency_days"],
        "limit_per_source": limit_per_source,
        "remote_mode": remote_mode,
    }
    run = create_discovery_run(
        conn,
        user_profile_version_id=profile["id"],
        user_profile_content_id=profile["content_id"],
        request=request,
    )
    captured_at = datetime.now(timezone.utc).isoformat()
    source_status: dict[str, Any] = {}
    candidate_ids: list[str] = []
    for source in selected_sources:
        try:
            results = runner.search(
                source,
                queries=selected_queries,
                locations=selected_locations,
                recency_days=preferences["recency_days"],
                limit=limit_per_source,
                remote_mode=remote_mode,
            )
            accepted = 0
            rejected: list[str] = []
            for index, result in enumerate(results):
                try:
                    record = portal_result_to_source_record(source, result, captured_at)
                    ingested = ingest_discovery_record(conn, record, run_id=run["id"])
                    accepted += 1
                    candidate_ids.append(ingested["candidate"]["id"])
                except Exception as exc:
                    rejected.append(f"result {index}: {exc}")
            source_status[source] = {
                "status": "completed" if not rejected else "partial",
                "received": len(results),
                "accepted": accepted,
                "rejected": rejected,
                "limitations": _source_limitations(source, preferences, selected_locations),
            }
        except Exception as exc:
            source_status[source] = {"status": "failed", "error": str(exc)}
    successes = sum(value["status"] != "failed" for value in source_status.values())
    if successes == len(source_status):
        status = "completed" if all(value["status"] == "completed" for value in source_status.values()) else "partial"
    elif successes:
        status = "partial"
    else:
        status = "failed"
    completed = complete_discovery_run(
        conn, run["id"], source_status=source_status, status=status
    )
    return {"run": completed, "candidate_ids": list(dict.fromkeys(candidate_ids))}


def _source_limitations(
    source: str, preferences: dict[str, Any], locations: list[str]
) -> list[str]:
    limitations = []
    if source == "freehire-search" and locations:
        limitations.append(
            "Freehire location text was not converted into guessed country/city facets."
        )
    unapplied = []
    for field in ("seniority_levels", "industries", "employment_types", "compensation"):
        if preferences.get(field):
            unapplied.append(field.replace("_", " "))
    if preferences["remote_preference"] not in {"no_preference", "remote_only"}:
        unapplied.append("soft remote preference")
    if unapplied:
        limitations.append("Not applied as hard portal filters: " + ", ".join(unapplied) + ".")
    return limitations


def discovery_run_is_stale(conn: sqlite3.Connection, run: dict[str, Any] | None = None) -> bool | None:
    run = run or get_latest_discovery_run(conn)
    if run is None:
        return None
    profile = get_current_user_profile(conn)
    return profile is None or profile["content_id"] != run["user_profile_content_id"]


def evaluate_discovery_candidate(
    conn: sqlite3.Connection,
    candidate_id: str,
    semantic_adapter: Any,
    *,
    request_id: str,
    understanding_provider: Any | None = None,
    active_extensions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    candidate = get_discovery_candidate(conn, candidate_id)
    if candidate is None:
        raise DiscoveryServiceError(f"unknown discovery candidate {candidate_id!r}")
    if candidate["lifecycle_status"] not in {"new", "saved"}:
        raise DiscoveryServiceError("only new or saved candidates can be evaluated")
    profile_artifact = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    if profile_artifact is None:
        raise DiscoveryServiceError("refresh Evidence Profile before evaluating jobs")
    source_record = candidate["canonical_source_record"]
    job_snapshot = normalize_job_source_record(source_record)
    understanding_request = None
    understanding_result = None
    if understanding_provider is not None:
        policy = load_job_understanding_policy()
        understanding_result = extract_job_understanding(
            job_snapshot, understanding_provider, request_id + "-understanding", policy=policy
        )
        from product.job_understanding import build_job_understanding_request
        understanding_request = build_job_understanding_request(
            job_snapshot, request_id + "-understanding", policy=policy
        )
    bundle = build_resolved_job_evidence_bundle(
        job_snapshot,
        job_understanding_request=understanding_request,
        job_understanding_result=understanding_result,
    )
    extensions = active_extensions or []
    proposals = semantic_adapter.propose(
        profile_evidence=select_semantic_profile_evidence(profile_artifact["payload"]),
        resolved_job_evidence=bundle,
        active_extensions=extensions,
    )
    evaluation_policy = load_evaluation_policy()
    semantic_policy = load_semantic_fit_policy()
    request = build_semantic_job_fit_request(
        request_id=request_id,
        profile_snapshot=profile_artifact["payload"],
        job_snapshot=job_snapshot,
        resolved_job_evidence=bundle,
        active_extensions=extensions,
        evaluation_policy=evaluation_policy,
        semantic_fit_policy=semantic_policy,
        semantic_proposals=proposals,
    )
    result = analyze_semantic_job_fit(request)
    fingerprints = {
        "profile_snapshot": profile_snapshot_content_id(profile_artifact["payload"]),
        "job_posting_snapshot": job_snapshot_content_id(job_snapshot),
        "resolved_job_evidence": content_identity("resolvedjobev_", bundle),
        "server:active_extensions": active_extensions_identity(extensions),
        "server:evaluation_policy": content_identity("evalpolicy_", evaluation_policy),
        "server:semantic_fit_policy": content_identity("semfitpolicy_", semantic_policy),
        "server:semantic_proposer_policy": semantic_proposer_policy_identity(),
        "server:semantic_proposals": semantic_proposals_identity(proposals),
    }
    if understanding_request is not None:
        fingerprints["server:job_understanding_policy"] = content_identity(
            "jupolicy_", load_job_understanding_policy()
        )
        fingerprints["server:job_understanding_provider"] = content_identity(
            "juprovider_",
            {
                key: getattr(understanding_provider, key, None)
                for key in ("provider_id", "model_id", "model_version")
            },
        )
        fingerprints["job_understanding_request"] = content_identity("jureq_", understanding_request)
        fingerprints["job_understanding_result"] = content_identity("juresult_", understanding_result)
    saved = save_discovery_fit(
        conn,
        candidate_id=candidate_id,
        occurrence_id=candidate["canonical_occurrence_id"],
        request=request,
        result=result,
        fingerprints=fingerprints,
    )
    saved["stale"] = False
    return saved


def discovery_fit_is_stale(
    conn: sqlite3.Connection,
    candidate_id: str,
    *,
    active_extensions: list[dict[str, Any]] | None = None,
    extensions_dir: Any | None = None,
) -> bool | None:
    fit = get_current_discovery_fit(conn, candidate_id)
    if fit is None:
        return None
    candidate = get_discovery_candidate(conn, candidate_id)
    profile = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    if candidate is None or profile is None:
        return True
    if active_extensions is None:
        active_extensions = fit["request"].get("active_extensions", [])
        if extensions_dir is not None and active_extensions:
            from webapp.services.extension_registry import resolve_active_extensions
            ids = [extension["id"] for extension in active_extensions]
            try:
                active_extensions = resolve_active_extensions(extensions_dir, ids)
            except Exception:
                return True
    current = {
        "profile_snapshot": profile_snapshot_content_id(profile["payload"]),
        "job_posting_snapshot": job_snapshot_content_id(
            normalize_job_source_record(candidate["canonical_source_record"])
        ),
        "server:active_extensions": active_extensions_identity(active_extensions or []),
        "server:evaluation_policy": content_identity("evalpolicy_", load_evaluation_policy()),
        "server:semantic_fit_policy": content_identity("semfitpolicy_", load_semantic_fit_policy()),
        "server:semantic_proposer_policy": semantic_proposer_policy_identity(),
    }
    if "server:job_understanding_policy" in fit["fingerprints"]:
        current["server:job_understanding_policy"] = content_identity(
            "jupolicy_", load_job_understanding_policy()
        )
    return any(fit["fingerprints"].get(key) != value for key, value in current.items())


def grouped_discovery_candidates(
    conn: sqlite3.Connection, *, extensions_dir: Any | None = None
) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {
        "scored": [], "unresolved": [], "blocked": [], "expired_unavailable": []
    }
    for candidate in list_discovery_candidates(conn):
        if candidate["lifecycle_status"] == "expired":
            candidate["fit"] = get_current_discovery_fit(conn, candidate["id"])
            groups["expired_unavailable"].append(candidate)
            continue
        fit = get_current_discovery_fit(conn, candidate["id"])
        candidate["fit"] = fit
        candidate["fit_stale"] = discovery_fit_is_stale(
            conn, candidate["id"], extensions_dir=extensions_dir
        )
        if fit is None:
            groups["unresolved"].append(candidate)
        elif fit["result"].get("blocked"):
            groups["blocked"].append(candidate)
        elif fit["result"].get("overall_score") is None:
            groups["unresolved"].append(candidate)
        else:
            groups["scored"].append(candidate)
    groups["scored"].sort(
        key=lambda item: item["fit"]["result"]["overall_score"], reverse=True
    )
    return groups


def promote_discovery_candidate(
    conn: sqlite3.Connection, candidate_id: str
) -> dict[str, Any]:
    try:
        conn.execute("BEGIN IMMEDIATE")
        candidate = get_discovery_candidate(conn, candidate_id)
        if candidate is None:
            raise DiscoveryServiceError(f"unknown discovery candidate {candidate_id!r}")
        existing_workspace_id = candidate.get("promoted_workspace_id")
        if existing_workspace_id:
            workspace = get_workspace(conn, existing_workspace_id)
            if workspace is None:
                raise DiscoveryServiceError("promoted candidate references a missing workspace")
            conn.commit()
            return {"candidate": candidate, "workspace": workspace, "created": False}
        if candidate["lifecycle_status"] in {"dismissed", "expired"}:
            raise DiscoveryServiceError("resurface this candidate before creating an application")
        workspace_id = f"ws_{uuid.uuid4().hex[:20]}"
        created = create_job_from_source_record(
            conn,
            company=candidate["company"],
            title=candidate["title"],
            source_record=candidate["canonical_source_record"],
            workspace_id=workspace_id,
            commit=False,
        )
        conn.execute(
            "UPDATE discovery_candidates SET lifecycle_status = 'promoted', promoted_workspace_id = ?, updated_at = ? "
            "WHERE id = ?",
            (workspace_id, datetime.now(timezone.utc).isoformat(), candidate_id),
        )
        conn.commit()
        return {
            "candidate": get_discovery_candidate(conn, candidate_id),
            "workspace": created["workspace"],
            "created": True,
        }
    except Exception:
        conn.rollback()
        raise
