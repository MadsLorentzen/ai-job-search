from tests.webapp.fixtures.application_material import completion_ready_pack_payload
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect, init_db
from webapp.persistence.review import save_review_decision
from webapp.persistence.workflow import record_status_change
from webapp.persistence.workspaces import (
    PROFILE_WORKSPACE_ID,
    create_workspace,
    ensure_profile_workspace,
)
from webapp.services.staleness import record_dependency_fingerprint
from webapp.services.input_identity import (
    active_extensions_identity,
    application_intelligence_generation_contract_identity,
    application_intelligence_policy_identity,
    evaluation_policy_identity,
    semantic_fit_policy_identity,
    semantic_proposals_identity,
    semantic_proposer_policy_identity,
)
from webapp.services.workspace_view import (
    build_conflicted_concept_ids,
    build_dashboard_view_model,
    build_profile_view_model,
    build_workspace_view_model,
    resolve_next_action,
    stage_state_label,
)


def _workspace(tmp_path):
    db = tmp_path / "jobsearch.sqlite3"
    init_db(db)
    conn = connect(db)
    ensure_profile_workspace(conn)
    workspace = create_workspace(conn, company="Acme", title="Backend Engineer")
    return conn, workspace["id"]


def _fit_payload():
    return {
        "status": "NEEDS_REVIEW", "verdict": None, "overall_score": None,
        "direct_matches": [{"match_id": "direct", "profile_evidence_ids": ["clm_direct"], "job_requirement_ids": ["jobev_direct"], "status": "READY"}],
        "functionally_equivalent_matches": [{"match_id": "functional", "profile_evidence_ids": ["clm_functional"], "job_requirement_ids": ["jobev_functional"], "status": "READY", "functional_basis": {"responsibility_alignment": ["built systems"]}}],
        "transferable_matches": [{"match_id": "transfer", "profile_evidence_ids": ["clm_transfer"], "job_requirement_ids": ["jobev_transfer"], "status": "NEEDS_REVIEW", "extension_ref": {"extension_id": "geophysics", "extension_version": "0.1.0", "record_id": "map_1"}, "conditions": ["Confirm context"], "limitations": ["Does not prove employment"]}],
        "gaps": [{"gap_id": "gap", "gap_type": "missing_evidence", "description": "No accepted AWS evidence"}],
        "unsupported_claims": [{"claim_id": "uns_fit", "reason": "Unsupported candidate assertion"}],
        "gate_assessments": [{"gate_id": "language", "status": "UNVERIFIED", "reason": "No evidence"}],
        "human_judgment_questions": [{"question_id": "q1", "question": "Confirm availability"}],
        "dimension_assessments": [], "dimension_scores": {}, "blocked": False, "blocking_gate_ids": [],
    }


def _seed_evidence(conn, workspace_id):
    profile = save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot", content_id="profile_A", payload={
        "claims": [
            {"id": "clm_direct", "concept_id": "c1", "field": "skill", "value": "Python", "placeholder": False},
            {"id": "clm_functional", "concept_id": "c2", "field": "experience", "value": "Built systems", "placeholder": False},
            {"id": "clm_transfer", "concept_id": "c3", "field": "domain", "value": "Subsurface models", "placeholder": False},
            {"id": "clm_placeholder", "concept_id": "c4", "field": "location", "value": "[LOCATION]", "placeholder": True},
            {"id": "clm_conflict", "concept_id": "c5", "field": "title", "value": "Engineer", "placeholder": False},
        ], "conflicts": [{"id": "conflict_1", "concept_id": "c5", "field": "title"}],
    })
    job = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot", content_id="job_A", payload={"company": "Acme", "title": "Backend Engineer", "description": "Source text"})
    understanding_request = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_understanding_request", content_id="understanding_request_A", payload={})
    record_dependency_fingerprint(conn, artifact_id=understanding_request["id"], upstream_artifact_type="job_posting_snapshot", upstream_content_id=job["content_id"])
    understanding = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_understanding_result", content_id="understanding_A", payload={"status": "READY", "requirements": [], "responsibilities": [], "language_requirements": [], "eligibility_requirements": [], "logistics_requirements": [], "suggestions": [], "ambiguous_statements": [], "warnings": []})
    record_dependency_fingerprint(conn, artifact_id=understanding["id"], upstream_artifact_type="job_posting_snapshot", upstream_content_id=job["content_id"])
    record_dependency_fingerprint(conn, artifact_id=understanding["id"], upstream_artifact_type="job_understanding_request", upstream_content_id=understanding_request["content_id"])
    bundle = save_artifact(conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence", content_id="bundle_A", payload={"evidence": [
        {"id": "jobev_direct", "text": "Python required"}, {"id": "jobev_functional", "text": "Build systems"}, {"id": "jobev_transfer", "text": "Model workflows"},
    ]})
    for upstream_type, upstream in (
        ("job_posting_snapshot", job), ("job_understanding_request", understanding_request),
        ("job_understanding_result", understanding),
    ):
        record_dependency_fingerprint(conn, artifact_id=bundle["id"], upstream_artifact_type=upstream_type, upstream_content_id=upstream["content_id"])
    fit_request = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_request", content_id="fit_request_A", payload={"active_extensions": [], "semantic_proposals": {}})
    for upstream_type, upstream_id in (
        ("profile_snapshot", profile["content_id"]), ("resolved_job_evidence", bundle["content_id"]),
        ("server:active_extensions", active_extensions_identity([])),
        ("server:evaluation_policy", evaluation_policy_identity()),
        ("server:semantic_fit_policy", semantic_fit_policy_identity()),
        ("server:semantic_proposer_policy", semantic_proposer_policy_identity()),
        ("server:semantic_proposals", semantic_proposals_identity({})),
    ):
        record_dependency_fingerprint(conn, artifact_id=fit_request["id"], upstream_artifact_type=upstream_type, upstream_content_id=upstream_id)
    fit = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result", content_id="fit_A", payload=_fit_payload())
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot", upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="resolved_job_evidence", upstream_content_id=bundle["content_id"])
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="job_fit_request", upstream_content_id=fit_request["content_id"])
    intelligence_request = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_intelligence_request", content_id="ai_request_A", payload={})
    for upstream_type, upstream_id in (
        ("profile_snapshot", profile["content_id"]), ("job_fit_result", fit["content_id"]),
        ("server:application_intelligence_policy", application_intelligence_policy_identity()),
        (
            "server:application_intelligence_generation_contract",
            application_intelligence_generation_contract_identity(),
        ),
    ):
        record_dependency_fingerprint(conn, artifact_id=intelligence_request["id"], upstream_artifact_type=upstream_type, upstream_content_id=upstream_id)
    intelligence = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_intelligence_result", content_id="ai_A", payload={
        "status": "NEEDS_REVIEW", "recommendation": "APPLY_WITH_CAUTION", "recommendation_reason": "Review open items",
        "cv_content": [{"unit_id": "unit_ready", "unit_type": "cv_bullet", "text": "Python", "status": "READY", "profile_evidence_ids": ["clm_direct"]},
                       {"unit_id": "unit_review", "unit_type": "cv_bullet", "text": "Review me", "status": "NEEDS_REVIEW", "profile_evidence_ids": ["clm_functional"]}],
        "cover_letter_content": [], "unsupported_claims": [{"claim_id": "uns_ai", "reason": "Rejected atom"}],
    })
    record_dependency_fingerprint(conn, artifact_id=intelligence["id"], upstream_artifact_type="profile_snapshot", upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=intelligence["id"], upstream_artifact_type="job_fit_result", upstream_content_id=fit["content_id"])
    record_dependency_fingerprint(conn, artifact_id=intelligence["id"], upstream_artifact_type="application_intelligence_request", upstream_content_id=intelligence_request["content_id"])
    return profile, fit, intelligence


def test_unprocessed_workspace_has_product_stage_states(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    view = build_workspace_view_model(conn, workspace_id)
    assert view["stages"]["job"]["state"] == "current"
    assert view["stages"]["understanding"]["state"] == "unavailable"
    assert set(stage["state"] for stage in view["stages"].values()) <= {"complete", "current", "needs_review", "stale", "unavailable"}


def test_internal_stage_states_have_one_canonical_user_facing_vocabulary():
    assert {
        state: stage_state_label(state)
        for state in ("current", "needs_review", "complete", "stale", "unavailable")
    } == {
        "current": "Ready to run",
        "needs_review": "Needs review",
        "complete": "Complete",
        "stale": "Stale",
        "unavailable": "Unavailable",
    }


def test_next_action_resolver_uses_real_world_status_after_product_completion():
    base = {
        "workspace": {"id": "ws_action", "workflow_status": "drafted"},
        "stages": {
            key: {"label": key, "state": "complete"}
            for key in ("job", "understanding", "fit", "application_intelligence", "review")
        },
    }
    base["stages"]["status"] = {"label": "Status", "state": "current"}
    assert resolve_next_action(base) == {
        "label": "Mark applied", "href": "/workspaces/ws_action#status",
    }

    base["workspace"]["workflow_status"] = "applied"
    base["stages"]["status"]["state"] = "complete"
    assert resolve_next_action(base) == {
        "label": "Update application status", "href": "/workspaces/ws_action#status",
    }


def test_dashboard_exposes_ready_stage_and_next_action(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
        content_id="job_ready", payload={"company": "Acme", "title": "Planner"},
    )

    dashboard = build_dashboard_view_model(conn, filter_name="active")

    row = next(item for item in dashboard["workspaces"] if item["id"] == workspace_id)
    assert row["computed_stage"] == "Understanding"
    assert row["stage_state_label"] == "Ready to run"
    assert row["next_action"] == {
        "label": "Run Understanding",
        "href": f"/workspaces/{workspace_id}#understanding",
    }


def test_dashboard_stale_application_has_obvious_recovery_action(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    save_artifact(
        conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
        payload={"claims": [], "conflicts": []}, content_id="profile_changed",
    )

    row = build_dashboard_view_model(conn, filter_name="active")["workspaces"][0]

    assert row["stage_state_label"] == "Stale"
    assert row["next_action"] == {
        "label": "Recover: rerun Job Fit",
        "href": f"/workspaces/{workspace_id}#job-fit",
    }


def test_all_six_evidence_concepts_are_classified_without_provider_rationale(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    view = build_workspace_view_model(conn, workspace_id)
    labels = {item["label"] for item in view["evidence_items"]}
    assert labels == {
        "Verified evidence", "Accepted inference — functionally equivalent", "Transferable evidence",
        "Missing evidence", "NEEDS_REVIEW", "Unsupported — excluded from application material",
    }


def test_transferability_resolves_candidate_target_extension_conditions_limitations_and_status(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    item = next(item for item in build_workspace_view_model(conn, workspace_id)["evidence_items"] if item["label"] == "Transferable evidence")
    assert item["candidate_evidence"][0]["id"] == "clm_transfer"
    assert item["target"][0]["id"] == "jobev_transfer"
    assert item["extension_ref"]["extension_id"] == "geophysics"
    assert item["conditions"] == ["Confirm context"]
    assert item["limitations"] == ["Does not prove employment"]
    assert item["status"] == "NEEDS_REVIEW"


def test_profile_conflict_is_needs_review_and_never_verified(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    profile_view = build_profile_view_model(conn)
    conflicted = next(item for item in profile_view["claims"] if item["claim"]["id"] == "clm_conflict")
    assert conflicted["label"] == "NEEDS_REVIEW"
    assert build_conflicted_concept_ids(profile_view["profile"]) == {"c5"}


def test_review_queue_includes_ready_and_needs_review_units_with_exact_artifact_decisions(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, _, intelligence = _seed_evidence(conn, workspace_id)
    view = build_workspace_view_model(conn, workspace_id)
    units = [item for item in view["review_items"] if item["review_item_type"] == "content_unit"]
    assert {item["domain_item_id"] for item in units} == {"unit_ready", "unit_review"}
    assert all(item["source_artifact_id"] == intelligence["id"] for item in units)
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="content_unit", source_artifact_id=intelligence["id"], domain_item_id="unit_ready", disposition="acknowledged_and_proceed")
    updated = build_workspace_view_model(conn, workspace_id)
    ready = next(item for item in updated["review_items"] if item["domain_item_id"] == "unit_ready")
    assert ready["decision"]["disposition"] == "acknowledged_and_proceed"
    assert "unit_ready" not in {
        item["domain_item_id"] for item in updated["pending_review_items"]
    }
    assert "unit_ready" in {
        item["domain_item_id"] for item in updated["resolved_review_items"]
    }
    assert updated["reviewed_cv_content"][0]["unit_id"] == "unit_ready"
    assert updated["readiness_answer"].startswith("Not yet")


def test_fully_rejected_empty_unit_has_no_review_or_inclusion_control(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, _, intelligence = _seed_evidence(conn, workspace_id)
    intelligence["payload"]["cv_content"].append({
        "unit_id": "unit_rejected", "text": "", "status": "NEEDS_REVIEW",
        "profile_evidence_ids": [],
    })
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload=intelligence["payload"], content_id="ai_B",
    )
    current = conn.execute(
        "SELECT artifact_id FROM current_artifacts WHERE workspace_id=? "
        "AND artifact_type='application_intelligence_result'", (workspace_id,),
    ).fetchone()["artifact_id"]
    record_dependency_fingerprint(
        conn, artifact_id=current, upstream_artifact_type="profile_snapshot",
        upstream_content_id="profile_A",
    )
    record_dependency_fingerprint(
        conn, artifact_id=current, upstream_artifact_type="job_fit_result",
        upstream_content_id="fit_A",
    )
    record_dependency_fingerprint(
        conn, artifact_id=current, upstream_artifact_type="application_intelligence_request",
        upstream_content_id="ai_request_A",
    )

    view = build_workspace_view_model(conn, workspace_id)

    assert "unit_rejected" not in {
        item["domain_item_id"] for item in view["review_items"]
    }


def test_stale_fit_disables_downstream_controls(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot", payload={"claims": [], "conflicts": []}, content_id="profile_B")
    view = build_workspace_view_model(conn, workspace_id)
    assert view["stages"]["fit"]["state"] == "stale"
    assert view["controls"]["can_intelligence"] is False
    assert view["controls"]["can_confirm_pack"] is False
    assert view["stages"]["review"]["state"] == "stale"


def test_submitted_pack_remains_non_stale_history_after_profile_refresh(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, fit, intelligence = _seed_evidence(conn, workspace_id)
    pack = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_pack",
        payload={
            "source_artifacts": {},
            **completion_ready_pack_payload("submitted"),
        }, content_id="pack_A",
    )
    record_dependency_fingerprint(
        conn, artifact_id=pack["id"], upstream_artifact_type="job_fit_result",
        upstream_content_id=fit["content_id"],
    )
    record_dependency_fingerprint(
        conn, artifact_id=pack["id"], upstream_artifact_type="application_intelligence_result",
        upstream_content_id=intelligence["content_id"],
    )
    record_status_change(
        conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-20",
        submitted_pack_artifact_id=pack["id"], _allow_drafted=True,
    )
    record_status_change(
        conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-21",
        submitted_pack_artifact_id=pack["id"],
    )
    save_artifact(
        conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
        payload={"claims": [], "conflicts": []}, content_id="profile_B",
    )

    view = build_workspace_view_model(conn, workspace_id)
    assert view["stages"]["fit"]["state"] == "stale"
    assert view["stages"]["application_intelligence"]["state"] == "stale"
    assert view["stages"]["review"]["state"] == "complete"
    assert view["stages"]["review"]["staleness"]["historical_submission"] is True
    assert pack["id"] in view["submitted_pack_artifact_ids"]


def test_blocking_review_disposition_keeps_gate_four_disabled(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, _, intelligence = _seed_evidence(conn, workspace_id)
    for unit_id in ("unit_ready", "unit_review"):
        save_review_decision(
            conn, workspace_id=workspace_id, review_item_type="content_unit",
            source_artifact_id=intelligence["id"], domain_item_id=unit_id,
            disposition="requires_upstream_change",
        )
    view = build_workspace_view_model(conn, workspace_id)
    assert view["outstanding_review_count"] >= 2
    assert view["controls"]["can_confirm_pack"] is False


def test_omitting_all_usable_material_keeps_gate_four_incomplete(tmp_path, monkeypatch):
    from webapp.services import workspace_view

    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    monkeypatch.setattr(
        workspace_view,
        "_build_review_items",
        lambda *args, **kwargs: [{
            "review_item_type": "content_unit",
            "domain_item_id": "unit_ready",
            "source_artifact_id": "ai_A",
            "item": {"text": "Reviewed material"},
            "decision": {"disposition": "omit_from_positioning"},
        }],
    )

    view = workspace_view.build_workspace_view_model(conn, workspace_id)

    assert view["outstanding_review_count"] == 0
    assert view["stages"]["review"]["state"] == "needs_review"
    assert view["review_completion_status"] == "INCOMPLETE"
    assert view["review_completion"]["issues"] == [
        "insufficient_cv_units",
        "missing_cv_bullet",
        "insufficient_cv_words",
        "insufficient_cover_letter_paragraphs",
        "insufficient_cover_letter_words",
    ]
    assert view["controls"]["can_confirm_pack"] is False


def test_acknowledging_unsafe_profile_item_does_not_resolve_ui_review(
    tmp_path, monkeypatch,
):
    from webapp.services import workspace_view

    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    monkeypatch.setattr(
        workspace_view,
        "_build_review_items",
        lambda *args, **kwargs: [{
            "review_item_type": "profile_conflict",
            "domain_item_id": "conflict_1",
            "source_artifact_id": "profile_A",
            "item": {},
            "decision": {"disposition": "acknowledged_and_proceed"},
        }],
    )

    view = workspace_view.build_workspace_view_model(conn, workspace_id)

    assert view["outstanding_review_count"] == 1
    assert view["controls"]["can_confirm_pack"] is False


def test_leaving_unsafe_profile_item_out_resolves_that_ui_decision(tmp_path, monkeypatch):
    from webapp.services import workspace_view

    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    monkeypatch.setattr(
        workspace_view,
        "_build_review_items",
        lambda *args, **kwargs: [{
            "review_item_type": "profile_conflict",
            "domain_item_id": "conflict_1",
            "source_artifact_id": "profile_A",
            "item": {},
            "decision": {"disposition": "omit_from_positioning"},
            "can_use": False,
            "problem": "Conflicting profile evidence cannot be used in application material.",
        }],
    )

    view = workspace_view.build_workspace_view_model(conn, workspace_id)

    assert view["outstanding_review_count"] == 0


def test_dashboard_has_required_summary_fields_and_filters(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    active = build_dashboard_view_model(conn, filter_name="active")
    row = active["workspaces"][0]
    assert {"company", "title", "computed_stage", "fit_verdict", "recommendation", "stale", "review_count", "workflow_status", "updated_at"} <= set(row)
    pack = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_pack",
        payload=completion_ready_pack_payload("dashboard"),
    )
    record_status_change(conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-20", submitted_pack_artifact_id=pack["id"], _allow_drafted=True)
    assert build_dashboard_view_model(conn, filter_name="active")["workspaces"] == []
    assert build_dashboard_view_model(conn, filter_name="drafted")["workspaces"][0]["id"] == workspace_id
