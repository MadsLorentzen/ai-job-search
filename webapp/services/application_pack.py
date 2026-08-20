from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from webapp.persistence.artifacts import get_artifact, get_current_artifact, save_artifact
from webapp.persistence.review import list_review_decisions
from webapp.persistence.workflow import record_status_change
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, get_workspace
from webapp.services.pipeline import PipelineError
from webapp.services.staleness import check_staleness, record_dependency_fingerprint

_ACKNOWLEDGED = "acknowledged_and_proceed"
_OMITTED = "omit_from_positioning"
_BLOCKING = frozenset({"requires_upstream_change", "resolved_by_rerun"})


def _current_or_error(
    conn: sqlite3.Connection, workspace_id: str, artifact_type: str
) -> dict[str, Any]:
    lookup_workspace = PROFILE_WORKSPACE_ID if artifact_type == "profile_snapshot" else workspace_id
    artifact = get_current_artifact(conn, lookup_workspace, artifact_type)
    if artifact is None:
        raise PipelineError(
            f"workspace {workspace_id} needs a current {artifact_type} to build an application pack"
        )
    return artifact


def _decision_index(
    conn: sqlite3.Connection, workspace_id: str, source_artifact_id: str
) -> dict[tuple[str, str | None], dict[str, Any]]:
    """Return the newest exact-type decision for each domain item."""
    indexed: dict[tuple[str, str | None], dict[str, Any]] = {}
    for decision in list_review_decisions(conn, workspace_id, source_artifact_id):
        indexed.setdefault(
            (decision["review_item_type"], decision["domain_item_id"]), decision
        )
    return indexed


def _artifact_ref(artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        "artifact_id": artifact["id"],
        "artifact_type": artifact["artifact_type"],
        "content_id": artifact["content_id"],
    }


def build_application_pack(
    conn: sqlite3.Connection, workspace_id: str, *,
    extensions_dir: Path | str = Path("extensions"),
) -> dict[str, Any]:
    profile_artifact = _current_or_error(conn, workspace_id, "profile_snapshot")
    job_artifact = _current_or_error(conn, workspace_id, "job_posting_snapshot")
    fit_artifact = _current_or_error(conn, workspace_id, "job_fit_result")
    intelligence_artifact = _current_or_error(
        conn, workspace_id, "application_intelligence_result"
    )

    stale: list[str] = []
    for artifact_type in ("job_fit_result", "application_intelligence_result"):
        result = check_staleness(
            conn, workspace_id, artifact_type, extensions_dir=extensions_dir
        )
        if result["stale"]:
            stale.append(f"{artifact_type}: {'; '.join(result['reasons'])}")
    if stale:
        raise PipelineError(
            "cannot build an application pack from stale artifacts: " + " | ".join(stale)
        )

    profile = profile_artifact["payload"]
    fit = fit_artifact["payload"]
    intelligence = intelligence_artifact["payload"]
    profile_decisions = _decision_index(conn, workspace_id, profile_artifact["id"])
    fit_decisions = _decision_index(conn, workspace_id, fit_artifact["id"])
    intelligence_decisions = _decision_index(
        conn, workspace_id, intelligence_artifact["id"]
    )
    outstanding: list[str] = []
    consulted: list[dict[str, Any]] = []
    exclusions: list[dict[str, Any]] = []

    def adjudicate(
        *, item_type: str, item_id: str, source: dict[str, Any],
        decisions: dict[tuple[str, str | None], dict[str, Any]], allow_omit: bool = True,
    ) -> bool:
        decision = decisions.get((item_type, item_id))
        if decision is None or decision["disposition"] in _BLOCKING:
            outstanding.append(f"{item_type}:{item_id}")
            return False
        consulted.append(decision)
        if decision["disposition"] == _OMITTED:
            if not allow_omit:
                outstanding.append(f"{item_type}:{item_id}")
                return False
            exclusions.append(
                {
                    "review_item_type": item_type,
                    "domain_item_id": item_id,
                    "source_artifact_id": decision["source_artifact_id"],
                    "disposition": decision["disposition"],
                    "note": decision["note"],
                    "item": source,
                }
            )
            return False
        if decision["disposition"] != _ACKNOWLEDGED:
            outstanding.append(f"{item_type}:{item_id}")
            return False
        return True

    # Gate 1 applies to current-profile integrity issues actually cited by a
    # positive fit relationship for this job. Decisions on older snapshots
    # cannot appear in profile_decisions and therefore cannot authorize use.
    matches = (
        fit.get("direct_matches", [])
        + fit.get("functionally_equivalent_matches", [])
        + fit.get("transferable_matches", [])
    )
    cited_claim_ids = {
        claim_id for match in matches for claim_id in match.get("profile_evidence_ids", [])
    }
    cited_claim_ids.update(
        claim_id
        for unit in intelligence.get("cv_content", []) + intelligence.get("cover_letter_content", [])
        if unit.get("text")
        for claim_id in unit.get("profile_evidence_ids", [])
    )
    cited_concepts = {
        claim.get("concept_id")
        for claim in profile.get("claims", [])
        if claim.get("id") in cited_claim_ids
    }
    unsafe_claim_ids: set[str] = set()

    def adjudicate_gate1(
        *, item_type: str, item_id: str, source: dict[str, Any], affected_claim_ids: set[str],
    ) -> None:
        decision = profile_decisions.get((item_type, item_id))
        if decision is None:
            outstanding.append(f"{item_type}:{item_id}")
            return
        consulted.append(decision)
        if decision["disposition"] != _OMITTED:
            # Seeing an integrity problem cannot rehabilitate evidence. Only a
            # safe omission can proceed without a corrected upstream snapshot.
            outstanding.append(f"{item_type}:{item_id}")
            return
        unsafe_claim_ids.update(affected_claim_ids)
        exclusions.append({
            "review_item_type": item_type,
            "domain_item_id": item_id,
            "source_artifact_id": decision["source_artifact_id"],
            "disposition": decision["disposition"],
            "note": decision["note"],
            "item": source,
        })

    for conflict in profile.get("conflicts", []):
        if conflict.get("concept_id") in cited_concepts:
            adjudicate_gate1(
                item_type="profile_conflict", item_id=conflict["id"], source=conflict,
                affected_claim_ids={
                    claim["id"] for claim in profile.get("claims", [])
                    if claim.get("concept_id") == conflict.get("concept_id")
                    and claim.get("id") in cited_claim_ids
                },
            )
    for claim in profile.get("claims", []):
        if claim.get("id") in cited_claim_ids and claim.get("placeholder"):
            adjudicate_gate1(
                item_type="profile_placeholder", item_id=claim["id"], source=claim,
                affected_claim_ids={claim["id"]},
            )

    # Gate 2 surfaces exactly the Ticket 7 review-bearing relationships.
    for gate in fit.get("gate_assessments", []):
        if gate.get("status") in {"FLAG", "UNVERIFIED"}:
            adjudicate(
                item_type="gate_flag", item_id=f"gate:{gate['gate_id']}", source=gate,
                decisions=fit_decisions,
            )
    for question in fit.get("human_judgment_questions", []):
        adjudicate(
            item_type="human_judgment_question", item_id=question["question_id"],
            source=question, decisions=fit_decisions,
        )

    def select_matches(collection: str, item_type: str) -> list[dict[str, Any]]:
        selected: list[dict[str, Any]] = []
        for match in fit.get(collection, []):
            if unsafe_claim_ids.intersection(match.get("profile_evidence_ids", [])):
                exclusions.append({
                    "review_item_type": item_type,
                    "domain_item_id": match["match_id"],
                    "source_artifact_id": fit_artifact["id"],
                    "disposition": "excluded_by_gate1",
                    "note": "Match cites omitted conflicted or placeholder Profile evidence.",
                    "item": match,
                })
                continue
            if adjudicate(
                item_type=item_type, item_id=match["match_id"], source=match,
                decisions=fit_decisions,
            ):
                selected.append(match)
        return selected

    functional = select_matches(
        "functionally_equivalent_matches", "functionally_equivalent_match"
    )
    transferable = select_matches("transferable_matches", "transferable_match")

    # Gate 3: READY means eligible for human review. Every eligible unit needs
    # a decision attached to this exact current Application Intelligence artifact.
    def select_units(collection: str) -> list[dict[str, Any]]:
        selected: list[dict[str, Any]] = []
        for unit in intelligence.get(collection, []):
            unit_id = unit.get("unit_id")
            # Ticket 8 retains a NEEDS_REVIEW shell with empty rendered text
            # when every proposed atom was rejected.  Its rejected material is
            # already preserved in unsupported_claims below; the shell is not
            # eligible application content and acknowledgement must never turn
            # it into pack prose.
            if not unit.get("text"):
                continue
            if unsafe_claim_ids.intersection(unit.get("profile_evidence_ids", [])):
                exclusions.append({
                    "review_item_type": "content_unit",
                    "domain_item_id": unit_id,
                    "source_artifact_id": intelligence_artifact["id"],
                    "disposition": "excluded_by_gate1",
                    "note": "Content cites omitted conflicted or placeholder Profile evidence.",
                    "item": unit,
                })
                continue
            if unit.get("status") not in {"READY", "NEEDS_REVIEW"} or not unit_id:
                outstanding.append(f"content_unit:{unit_id or '<missing>'}")
                continue
            if adjudicate(
                item_type="content_unit", item_id=unit_id, source=unit,
                decisions=intelligence_decisions,
            ):
                selected.append(unit)
        return selected

    cv_content = select_units("cv_content")
    cover_letter_content = select_units("cover_letter_content")
    if outstanding:
        raise PipelineError(
            f"workspace {workspace_id} has outstanding review items: {sorted(set(outstanding))}"
        )

    source_artifacts = {
        "profile_snapshot": _artifact_ref(profile_artifact),
        "job_posting_snapshot": _artifact_ref(job_artifact),
        "job_fit_result": _artifact_ref(fit_artifact),
        "application_intelligence_result": _artifact_ref(intelligence_artifact),
    }
    return {
        "schema_version": "application-pack.v0",
        "source_artifacts": source_artifacts,
        "job": job_artifact["payload"],
        "fit_summary": {
            "status": fit.get("status"),
            "blocked": fit.get("blocked"),
            "blocking_gate_ids": fit.get("blocking_gate_ids", []),
            "verdict": fit.get("verdict"),
            "dimension_assessments": fit.get("dimension_assessments", []),
            "dimension_scores": fit.get("dimension_scores", {}),
            "gate_assessments": fit.get("gate_assessments", []),
            "direct_matches": [
                match for match in fit.get("direct_matches", [])
                if not unsafe_claim_ids.intersection(match.get("profile_evidence_ids", []))
            ],
            "functionally_equivalent_matches": functional,
            "transferable_matches": transferable,
            "gaps": fit.get("gaps", []),
            "human_judgment_questions": fit.get("human_judgment_questions", []),
            "unsupported_claims": fit.get("unsupported_claims", []),
        },
        "recommendation": intelligence.get("recommendation"),
        "recommendation_reason": intelligence.get("recommendation_reason"),
        "cv_content": cv_content,
        "cover_letter_content": cover_letter_content,
        "review_record": {
            "decisions_consulted": consulted,
            "exclusions": exclusions,
            "informational_items": {
                "gaps": fit.get("gaps", []),
                "job_fit_unsupported_claims": fit.get("unsupported_claims", []),
                "application_intelligence_unsupported_claims": intelligence.get(
                    "unsupported_claims", []
                ),
            },
        },
    }


def confirm_application_pack(
    conn: sqlite3.Connection, workspace_id: str, *, effective_date: str,
    documents_root: Path | str = Path("documents"),
    extensions_dir: Path | str = Path("extensions"),
) -> dict[str, Any]:
    """Gate 4: the sole webapp route to ``drafted`` and an exact pack binding."""
    try:
        # Acquire the write reservation before reading the current chain. This
        # makes the reviewed sources and the persisted Gate-4 binding one
        # serializable SQLite operation; a concurrent rerun cannot replace a
        # current artifact between pack assembly and commit.
        conn.execute("BEGIN IMMEDIATE")
        workspace = get_workspace(conn, workspace_id)
        if workspace is None:
            raise PipelineError(f"workspace {workspace_id} does not exist")
        if workspace["workflow_status"] not in (None, "drafted"):
            raise PipelineError(
                f"cannot confirm a new application pack after submission; current status is "
                f"{workspace['workflow_status']!r}"
            )

        pack = build_application_pack(conn, workspace_id, extensions_dir=extensions_dir)
        artifact = save_artifact(
            conn, workspace_id=workspace_id, artifact_type="application_pack", payload=pack,
            commit=False,
        )
        record_dependency_fingerprint(
            conn, artifact_id=artifact["id"], upstream_artifact_type="job_fit_result",
            upstream_content_id=pack["source_artifacts"]["job_fit_result"]["content_id"],
            commit=False,
        )
        record_dependency_fingerprint(
            conn, artifact_id=artifact["id"],
            upstream_artifact_type="application_intelligence_result",
            upstream_content_id=pack["source_artifacts"]["application_intelligence_result"]["content_id"],
            commit=False,
        )
        event = record_status_change(
            conn, workspace_id=workspace_id, new_status="drafted", effective_date=effective_date,
            note="Application pack reviewed and confirmed by user.",
            submitted_pack_artifact_id=artifact["id"], _allow_drafted=True, commit=False,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    projection = _project_existing_pack(
        artifact, documents_root=Path(documents_root)
    )
    return {
        "pack": pack, "artifact": artifact, "workflow_event": event,
        "gate4_status": "SUCCEEDED",
        "projection": projection,
        "archive_path": projection["archive_path"],
    }


def retry_application_pack_projection(
    conn: sqlite3.Connection, workspace_id: str, *, pack_artifact_id: str,
    documents_root: Path | str = Path("documents"),
) -> dict[str, Any]:
    """Retry only the compatibility export for one immutable existing pack.

    This function never saves an artifact and never records a workflow event.
    The exact artifact id is also embedded in the projection, making retries
    idempotent even if a prior call wrote the file but its success response was
    lost.
    """
    artifact = get_artifact(conn, pack_artifact_id)
    if (
        artifact is None
        or artifact["workspace_id"] != workspace_id
        or artifact["artifact_type"] != "application_pack"
    ):
        raise PipelineError(
            f"application pack artifact {pack_artifact_id!r} does not belong to workspace "
            f"{workspace_id}"
        )
    return _project_existing_pack(artifact, documents_root=Path(documents_root))


def _project_existing_pack(
    artifact: dict[str, Any], *, documents_root: Path
) -> dict[str, Any]:
    from webapp.services.archive_projection import write_application_pack_projection

    pack = artifact["payload"]
    job = pack.get("job", {})
    try:
        path = write_application_pack_projection(
            pack, company=job.get("company", ""), title=job.get("title", ""),
            documents_root=documents_root, projection_id=artifact["id"],
        )
    except Exception as exc:
        # Gate 4 has already succeeded in SQLite. Projection is explicitly a
        # retryable compatibility warning, never an exception that disguises
        # the committed pack/status transition as a failed action.
        return {
            "status": "FAILED", "archive_path": None,
            "pack_artifact_id": artifact["id"], "retryable": True,
            "error": {
                "type": type(exc).__name__,
                "message": "compatibility projection failed; retry this exact pack",
            },
        }
    return {
        "status": "SUCCEEDED", "archive_path": str(path),
        "pack_artifact_id": artifact["id"], "retryable": False, "error": None,
    }
