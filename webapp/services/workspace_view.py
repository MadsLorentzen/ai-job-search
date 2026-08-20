"""Read-only UI view models built from persisted product artifacts."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.review import list_review_decisions
from webapp.persistence.workflow import list_workflow_events
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, list_workspaces
from webapp.services.extension_registry import list_installed_extensions
from webapp.services.http_api import require_job_workspace
from webapp.services.staleness import check_staleness

STAGE_ORDER = (
    "job", "understanding", "fit", "application_intelligence", "review", "status"
)
FINAL_STATUSES = frozenset({"hired", "rejected", "no_response", "offer_declined", "withdrawn"})


def build_conflicted_concept_ids(profile_artifact: dict[str, Any] | None) -> set[str]:
    if profile_artifact is None:
        return set()
    return {
        item.get("concept_id")
        for item in profile_artifact["payload"].get("conflicts", [])
        if item.get("concept_id")
    }


def _artifact_payload(artifact: dict[str, Any] | None) -> dict[str, Any]:
    return artifact["payload"] if artifact else {}


def _result_state(
    artifact: dict[str, Any] | None, staleness: dict[str, Any]
) -> str:
    if artifact is None:
        return "unavailable"
    if staleness["stale"]:
        return "stale"
    if artifact["payload"].get("status") in {"NEEDS_REVIEW", "UNAVAILABLE"}:
        return "needs_review" if artifact["payload"].get("status") == "NEEDS_REVIEW" else "unavailable"
    return "complete"


def _latest_decisions(
    conn: sqlite3.Connection, workspace_id: str, artifact_id: str | None
) -> dict[tuple[str, str | None], dict[str, Any]]:
    if artifact_id is None:
        return {}
    result: dict[tuple[str, str | None], dict[str, Any]] = {}
    for decision in list_review_decisions(conn, workspace_id, artifact_id):
        result.setdefault((decision["review_item_type"], decision["domain_item_id"]), decision)
    return result


def _resolved_detail(
    match: dict[str, Any], profile_by_id: dict[str, dict[str, Any]],
    job_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return {
        "match": match,
        "candidate_evidence": [
            profile_by_id[item_id] for item_id in match.get("profile_evidence_ids", [])
            if item_id in profile_by_id
        ],
        "job_evidence": [
            job_by_id[item_id] for item_id in match.get("job_requirement_ids", [])
            if item_id in job_by_id
        ],
    }


def _build_evidence_items(
    profile: dict[str, Any] | None, bundle: dict[str, Any] | None,
    fit: dict[str, Any] | None, intelligence: dict[str, Any] | None,
    pack: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    profile_payload = _artifact_payload(profile)
    fit_payload = _artifact_payload(fit)
    intelligence_payload = _artifact_payload(intelligence)
    profile_by_id = {item["id"]: item for item in profile_payload.get("claims", [])}
    job_by_id = {item["id"]: item for item in _artifact_payload(bundle).get("evidence", [])}
    items: list[dict[str, Any]] = []
    for match in fit_payload.get("direct_matches", []):
        items.append({
            "label": "Verified evidence", "source": "direct_matches",
            "detail": _resolved_detail(match, profile_by_id, job_by_id),
            "status": match.get("status", "READY"),
        })
    for match in fit_payload.get("functionally_equivalent_matches", []):
        items.append({
            "label": "Accepted inference — functionally equivalent",
            "source": "functionally_equivalent_matches",
            "detail": _resolved_detail(match, profile_by_id, job_by_id),
            "status": match.get("status", "READY"),
        })
    for match in fit_payload.get("transferable_matches", []):
        detail = _resolved_detail(match, profile_by_id, job_by_id)
        items.append({
            "label": "Transferable evidence", "source": "transferable_matches",
            "detail": detail, "extension_ref": match.get("extension_ref", {}),
            "target": detail["job_evidence"], "candidate_evidence": detail["candidate_evidence"],
            "conditions": match.get("conditions", []), "limitations": match.get("limitations", []),
            "status": match.get("status", "NEEDS_REVIEW"),
        })
    for gap in fit_payload.get("gaps", []):
        items.append({"label": "Missing evidence", "source": "gaps", "detail": gap, "status": gap.get("status")})
    for claim in fit_payload.get("unsupported_claims", []):
        items.append({
            "label": "Unsupported — excluded from application material",
            "source": "job_fit_unsupported_claims", "detail": claim,
        })
    for claim in intelligence_payload.get("unsupported_claims", []):
        items.append({
            "label": "Unsupported — excluded from application material",
            "source": "application_intelligence_unsupported_claims", "detail": claim,
        })
    for unit in intelligence_payload.get("cv_content", []) + intelligence_payload.get("cover_letter_content", []):
        if unit.get("status") == "NEEDS_REVIEW":
            items.append({"label": "NEEDS_REVIEW", "source": "content_unit", "detail": unit})
    if pack:
        for exclusion in pack["payload"].get("review_record", {}).get("exclusions", []):
            items.append({
                "label": "Unsupported — excluded from application material",
                "source": "review_exclusion", "detail": exclusion,
            })
    return items


def _build_review_items(
    conn: sqlite3.Connection, workspace_id: str, profile: dict[str, Any] | None,
    fit: dict[str, Any] | None, intelligence: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    fit_payload = _artifact_payload(fit)
    profile_payload = _artifact_payload(profile)
    profile_decisions = _latest_decisions(conn, workspace_id, profile["id"] if profile else None)
    fit_decisions = _latest_decisions(conn, workspace_id, fit["id"] if fit else None)
    intelligence_decisions = _latest_decisions(
        conn, workspace_id, intelligence["id"] if intelligence else None
    )
    review_items: list[dict[str, Any]] = []

    matches = (
        fit_payload.get("direct_matches", [])
        + fit_payload.get("functionally_equivalent_matches", [])
        + fit_payload.get("transferable_matches", [])
    )
    cited_ids = {item for match in matches for item in match.get("profile_evidence_ids", [])}
    if intelligence:
        cited_ids.update(
            claim_id
            for unit in intelligence["payload"].get("cv_content", [])
            + intelligence["payload"].get("cover_letter_content", [])
            if unit.get("text")
            for claim_id in unit.get("profile_evidence_ids", [])
        )
    cited_concepts = {
        claim.get("concept_id") for claim in profile_payload.get("claims", [])
        if claim.get("id") in cited_ids
    }

    def add(item_type, item_id, source_artifact, item, decisions):
        decision = decisions.get((item_type, item_id))
        review_items.append({
            "review_item_type": item_type, "domain_item_id": item_id,
            "source_artifact_id": source_artifact["id"], "item": item,
            "decision": decision,
        })

    if profile:
        for conflict in profile_payload.get("conflicts", []):
            if conflict.get("concept_id") in cited_concepts:
                add("profile_conflict", conflict["id"], profile, conflict, profile_decisions)
        for claim in profile_payload.get("claims", []):
            if claim.get("placeholder") and claim.get("id") in cited_ids:
                add("profile_placeholder", claim["id"], profile, claim, profile_decisions)
    if fit:
        for gate in fit_payload.get("gate_assessments", []):
            if gate.get("status") in {"FLAG", "UNVERIFIED"}:
                add("gate_flag", f"gate:{gate['gate_id']}", fit, gate, fit_decisions)
        for question in fit_payload.get("human_judgment_questions", []):
            add("human_judgment_question", question["question_id"], fit, question, fit_decisions)
        for collection, item_type in (
            ("functionally_equivalent_matches", "functionally_equivalent_match"),
            ("transferable_matches", "transferable_match"),
        ):
            for match in fit_payload.get(collection, []):
                add(item_type, match["match_id"], fit, match, fit_decisions)
    if intelligence:
        intelligence_payload = intelligence["payload"]
        for unit in intelligence_payload.get("cv_content", []) + intelligence_payload.get("cover_letter_content", []):
            # Fully rejected Ticket 8 proposals survive as empty shells plus
            # unsupported-claim audit records. They have no content to review
            # and must never expose an inclusion control.
            if not unit.get("text"):
                continue
            add("content_unit", unit["unit_id"], intelligence, unit, intelligence_decisions)
    return review_items


def build_profile_view_model(conn: sqlite3.Connection) -> dict[str, Any]:
    profile = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    conflicted = build_conflicted_concept_ids(profile)
    claims = []
    for claim in _artifact_payload(profile).get("claims", []):
        if claim.get("placeholder"):
            label = "Missing evidence"
        elif claim.get("concept_id") in conflicted:
            label = "NEEDS_REVIEW"
        else:
            label = "Verified evidence"
        claims.append({"claim": claim, "label": label})
    return {"profile": profile, "claims": claims, "conflicted_concept_ids": conflicted}


def build_workspace_view_model(
    conn: sqlite3.Connection, workspace_id: str, *, extensions_dir: Path | None = None
) -> dict[str, Any]:
    workspace = require_job_workspace(conn, workspace_id)
    artifacts = {
        "profile": get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot"),
        "job": get_current_artifact(conn, workspace_id, "job_posting_snapshot"),
        "understanding": get_current_artifact(conn, workspace_id, "job_understanding_result"),
        "bundle": get_current_artifact(conn, workspace_id, "resolved_job_evidence"),
        "fit": get_current_artifact(conn, workspace_id, "job_fit_result"),
        "intelligence": get_current_artifact(conn, workspace_id, "application_intelligence_result"),
        "pack": get_current_artifact(conn, workspace_id, "application_pack"),
    }
    stale = {
        name: check_staleness(
            conn, workspace_id, artifact_type,
            extensions_dir=extensions_dir or Path("extensions"),
        )
        for name, artifact_type in (
            ("understanding", "job_understanding_result"),
            ("fit", "job_fit_result"),
            ("application_intelligence", "application_intelligence_result"),
            ("review", "application_pack"),
        )
    }
    submitted_pack_ids = {
        event["submitted_pack_artifact_id"]
        for event in list_workflow_events(conn, workspace_id)
        if event["new_status"] == "applied" and event["submitted_pack_artifact_id"]
    }
    pack_is_submitted = bool(
        artifacts["pack"] and artifacts["pack"]["id"] in submitted_pack_ids
    )
    if pack_is_submitted:
        stale["review"] = {
            "stale": False, "reasons": [], "historical_submission": True,
        }
    review_items = _build_review_items(
        conn, workspace_id, artifacts["profile"], artifacts["fit"], artifacts["intelligence"]
    )
    outstanding = [
        item for item in review_items
        if item["decision"] is None
        or item["decision"]["disposition"] in {"requires_upstream_change", "resolved_by_rerun"}
        or (
            item["review_item_type"] in {"profile_conflict", "profile_placeholder"}
            and item["decision"]["disposition"] != "omit"
        )
    ]
    job_state = "complete" if artifacts["job"] else "current"
    understanding_state = _result_state(artifacts["understanding"], stale["understanding"])
    if artifacts["understanding"] is None:
        understanding_state = "current" if artifacts["job"] else "unavailable"
    fit_state = _result_state(artifacts["fit"], stale["fit"])
    if artifacts["fit"] is None:
        fit_state = "current" if understanding_state == "complete" else "unavailable"
    intelligence_state = _result_state(
        artifacts["intelligence"], stale["application_intelligence"]
    )
    if artifacts["intelligence"] is None:
        intelligence_state = "current" if fit_state in {"complete", "needs_review"} else "unavailable"
    if pack_is_submitted:
        review_state = "complete"
    elif fit_state == "stale" or intelligence_state == "stale":
        review_state = "stale"
    elif artifacts["pack"]:
        review_state = "stale" if stale["review"]["stale"] else "complete"
    elif not artifacts["fit"] or not artifacts["intelligence"]:
        review_state = "unavailable"
    else:
        review_state = "needs_review" if outstanding else "current"
    status_state = (
        "unavailable" if not artifacts["pack"] else
        "current" if workspace["workflow_status"] == "drafted" else "complete"
    )
    stages = {
        "job": {"label": "Job", "state": job_state, "artifact": artifacts["job"]},
        "understanding": {"label": "Understanding", "state": understanding_state, "artifact": artifacts["understanding"], "staleness": stale["understanding"]},
        "fit": {"label": "Job Fit", "state": fit_state, "artifact": artifacts["fit"], "staleness": stale["fit"]},
        "application_intelligence": {"label": "Application Intelligence", "state": intelligence_state, "artifact": artifacts["intelligence"], "staleness": stale["application_intelligence"]},
        "review": {"label": "Review", "state": review_state, "artifact": artifacts["pack"], "staleness": stale["review"]},
        "status": {"label": "Status", "state": status_state, "artifact": None},
    }
    public_extensions = []
    if extensions_dir is not None:
        public_extensions = [
            {"id": item["id"], "version": item["version"], "name": item["name"]}
            for item in list_installed_extensions(extensions_dir)
        ]
    return {
        "workspace": workspace, "profile": artifacts["profile"],
        "job_posting": artifacts["job"], "resolved_job_evidence": artifacts["bundle"],
        "stages": stages,
        "evidence_items": _build_evidence_items(
            artifacts["profile"], artifacts["bundle"], artifacts["fit"],
            artifacts["intelligence"], artifacts["pack"],
        ),
        "review_items": review_items, "outstanding_review_count": len(outstanding),
        "submitted_pack_artifact_ids": sorted(submitted_pack_ids),
        "available_extensions": public_extensions,
        "controls": {
            "can_understand": bool(artifacts["job"]),
            "can_fit": understanding_state == "complete",
            "can_intelligence": fit_state in {"complete", "needs_review"},
            "can_confirm_pack": review_state == "current",
        },
    }


def _dashboard_stage(view: dict[str, Any]) -> str:
    for name in STAGE_ORDER:
        if view["stages"][name]["state"] in {"stale", "needs_review", "current"}:
            return view["stages"][name]["label"]
    return "Complete"


def build_dashboard_view_model(
    conn: sqlite3.Connection, *, filter_name: str = "active",
    extensions_dir: Path | None = None,
) -> dict[str, Any]:
    rows = []
    for workspace in list_workspaces(conn):
        view = build_workspace_view_model(
            conn, workspace["id"], extensions_dir=extensions_dir,
        )
        fit = _artifact_payload(view["stages"]["fit"]["artifact"])
        intelligence = _artifact_payload(view["stages"]["application_intelligence"]["artifact"])
        rows.append({
            **workspace, "computed_stage": _dashboard_stage(view),
            "fit_verdict": (fit.get("verdict") or {}).get("display_name"),
            "recommendation": intelligence.get("recommendation"),
            "stale": any(stage["state"] == "stale" for stage in view["stages"].values()),
            "review_count": view["outstanding_review_count"],
        })
    def include(row):
        status = row["workflow_status"]
        if filter_name == "active": return status is None
        if filter_name == "final": return status in FINAL_STATUSES
        return status == filter_name
    return {
        "workspaces": [row for row in rows if include(row)], "filter": filter_name,
        "filters": ("active", "drafted", "applied", "interview", "offer", "final"),
    }
