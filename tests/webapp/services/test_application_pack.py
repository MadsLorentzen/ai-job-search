import copy

import pytest

from webapp.persistence.artifacts import (
    get_artifact,
    get_current_artifact,
    list_artifact_history,
    save_artifact,
)
from webapp.persistence.db import connect, init_db
from webapp.persistence.review import save_review_decision
from webapp.persistence.workflow import list_workflow_events, record_status_change
from webapp.persistence.workspaces import (
    PROFILE_WORKSPACE_ID,
    create_workspace,
    ensure_profile_workspace,
    get_workspace,
)
from webapp.services.application_pack import (
    build_application_pack,
    confirm_application_pack,
    retry_application_pack_projection,
)
from webapp.services.pipeline import PipelineError
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


def _workspace(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ensure_profile_workspace(conn)
    workspace = create_workspace(conn, company="Acme / Corp", title="Backend Engineer")
    return conn, workspace["id"]


def _seed(conn, workspace_id, *, profile=None, fit=None, units=None, unsupported=None):
    profile_payload = profile or {"claims": [], "conflicts": []}
    profile_artifact = save_artifact(
        conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
        payload=profile_payload, content_id="profilesnap_A",
    )
    job = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
        payload={
            "company": "Acme / Corp", "title": "Backend Engineer", "job_id": "jobsrc_A",
            "description": "Exact posting text", "requirements": [{"id": "jobev_1", "text": "Python"}],
        }, content_id="jobsnap_A",
    )
    understanding_request = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_understanding_request",
        payload={}, content_id="jureq_A",
    )
    record_dependency_fingerprint(
        conn, artifact_id=understanding_request["id"],
        upstream_artifact_type="job_posting_snapshot", upstream_content_id=job["content_id"],
    )
    understanding_result = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_understanding_result",
        payload={}, content_id="juresult_A",
    )
    for upstream_type, upstream in (
        ("job_posting_snapshot", job), ("job_understanding_request", understanding_request),
    ):
        record_dependency_fingerprint(
            conn, artifact_id=understanding_result["id"], upstream_artifact_type=upstream_type,
            upstream_content_id=upstream["content_id"],
        )
    bundle = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence",
        payload={}, content_id="resolvedjobev_A",
    )
    for upstream_type, upstream in (
        ("job_posting_snapshot", job), ("job_understanding_request", understanding_request),
        ("job_understanding_result", understanding_result),
    ):
        record_dependency_fingerprint(
            conn, artifact_id=bundle["id"], upstream_artifact_type=upstream_type,
            upstream_content_id=upstream["content_id"],
        )
    fit_request = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_request",
        payload={"active_extensions": [], "semantic_proposals": {}}, content_id="jobfitreq_A",
    )
    for upstream_type, upstream_id in (
        ("profile_snapshot", profile_artifact["content_id"]),
        ("resolved_job_evidence", bundle["content_id"]),
        ("server:active_extensions", active_extensions_identity([])),
        ("server:evaluation_policy", evaluation_policy_identity()),
        ("server:semantic_fit_policy", semantic_fit_policy_identity()),
        ("server:semantic_proposer_policy", semantic_proposer_policy_identity()),
        ("server:semantic_proposals", semantic_proposals_identity({})),
    ):
        record_dependency_fingerprint(
            conn, artifact_id=fit_request["id"], upstream_artifact_type=upstream_type,
            upstream_content_id=upstream_id,
        )
    fit_payload = {
        "status": "READY", "blocked": False, "blocking_gate_ids": [],
        "verdict": {"id": "strong_fit", "display_name": "Strong Fit", "score": 90.0},
        "dimension_assessments": [], "dimension_scores": {"technical_skills": 90.0},
        "gate_assessments": [], "direct_matches": [],
        "functionally_equivalent_matches": [], "transferable_matches": [],
        "gaps": [], "human_judgment_questions": [], "unsupported_claims": [],
    }
    if fit:
        fit_payload.update(copy.deepcopy(fit))
    fit_artifact = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload=fit_payload, content_id="jobfit_A",
    )
    record_dependency_fingerprint(
        conn, artifact_id=fit_artifact["id"], upstream_artifact_type="profile_snapshot",
        upstream_content_id=profile_artifact["content_id"],
    )
    record_dependency_fingerprint(
        conn, artifact_id=fit_artifact["id"], upstream_artifact_type="resolved_job_evidence",
        upstream_content_id=bundle["content_id"],
    )
    record_dependency_fingerprint(
        conn, artifact_id=fit_artifact["id"], upstream_artifact_type="job_fit_request",
        upstream_content_id=fit_request["content_id"],
    )
    ai_units = units if units is not None else [
        {"unit_id": "cv_1", "unit_type": "cv_bullet", "text": "Built Python systems.",
         "status": "READY", "profile_evidence_ids": ["clm_1"]}
    ]
    intelligence_request = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_request",
        payload={}, content_id="aiintelreq_A",
    )
    for upstream_type, upstream_id in (
        ("profile_snapshot", profile_artifact["content_id"]),
        ("job_fit_result", fit_artifact["content_id"]),
        ("server:application_intelligence_policy", application_intelligence_policy_identity()),
        (
            "server:application_intelligence_generation_contract",
            application_intelligence_generation_contract_identity(),
        ),
    ):
        record_dependency_fingerprint(
            conn, artifact_id=intelligence_request["id"], upstream_artifact_type=upstream_type,
            upstream_content_id=upstream_id,
        )
    cv_units = [
        unit for unit in ai_units
        if unit.get("unit_type") in {"cv_bullet", "cv_summary_line"}
    ]
    cover_letter_units = [
        unit for unit in ai_units
        if unit.get("unit_type") in {"cover_letter_paragraph", "positioning_statement"}
    ]
    intelligence = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={
            "recommendation": "APPLY", "recommendation_reason": "Evidence-backed fit.",
            "cv_content": cv_units, "cover_letter_content": cover_letter_units,
            "unsupported_claims": unsupported or [],
        }, content_id="aiintel_A",
    )
    record_dependency_fingerprint(
        conn, artifact_id=intelligence["id"], upstream_artifact_type="profile_snapshot",
        upstream_content_id=profile_artifact["content_id"],
    )
    record_dependency_fingerprint(
        conn, artifact_id=intelligence["id"],
        upstream_artifact_type="application_intelligence_request",
        upstream_content_id=intelligence_request["content_id"],
    )
    record_dependency_fingerprint(
        conn, artifact_id=intelligence["id"], upstream_artifact_type="job_fit_result",
        upstream_content_id=fit_artifact["content_id"],
    )
    return profile_artifact, job, fit_artifact, intelligence


def _decide(conn, workspace_id, artifact, item_type, item_id, disposition="acknowledged_and_proceed"):
    return save_review_decision(
        conn, workspace_id=workspace_id, review_item_type=item_type,
        source_artifact_id=artifact["id"], domain_item_id=item_id,
        disposition=disposition, note=f"Reviewed {item_id}",
    )


def _completion_ready_units() -> list[dict]:
    def words(count, prefix):
        return " ".join(f"{prefix}{index}" for index in range(count))

    return [
        {"unit_id": "cv_1", "unit_type": "cv_bullet", "text": words(10, "bullet"),
         "status": "READY", "profile_evidence_ids": ["clm_1"]},
        {"unit_id": "cv_2", "unit_type": "cv_summary_line", "text": words(10, "summary"),
         "status": "READY", "profile_evidence_ids": ["clm_1"]},
        {"unit_id": "cover_1", "unit_type": "cover_letter_paragraph", "text": words(40, "cover"),
         "status": "READY", "profile_evidence_ids": ["clm_1"]},
    ]


def _seed_completion_ready(conn, workspace_id):
    *_, intelligence = _seed(conn, workspace_id, units=_completion_ready_units())
    for unit in _completion_ready_units():
        _decide(conn, workspace_id, intelligence, "content_unit", unit["unit_id"])
    return intelligence


def test_requires_complete_current_chain(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(PipelineError, match="profile_snapshot"):
        build_application_pack(conn, workspace_id)


def test_ready_content_requires_explicit_exact_artifact_decision(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, _, _, intelligence = _seed(conn, workspace_id)
    with pytest.raises(PipelineError, match="content_unit:cv_1"):
        build_application_pack(conn, workspace_id)
    _decide(conn, workspace_id, intelligence, "content_unit", "cv_1")
    assert build_application_pack(conn, workspace_id)["cv_content"][0]["unit_id"] == "cv_1"


def test_decision_on_superseded_intelligence_does_not_authorize_current_unit(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, _, _, old = _seed(conn, workspace_id)
    _decide(conn, workspace_id, old, "content_unit", "cv_1")
    current = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload=old["payload"], content_id="aiintel_B",
    )
    fit = conn.execute(
        "SELECT content_id FROM artifacts WHERE workspace_id=? AND artifact_type='job_fit_result'",
        (workspace_id,),
    ).fetchone()
    record_dependency_fingerprint(conn, artifact_id=current["id"], upstream_artifact_type="profile_snapshot", upstream_content_id="profilesnap_A")
    record_dependency_fingerprint(conn, artifact_id=current["id"], upstream_artifact_type="job_fit_result", upstream_content_id=fit["content_id"])
    ai_request = conn.execute(
        "SELECT content_id FROM artifacts WHERE workspace_id=? AND artifact_type='application_intelligence_request'",
        (workspace_id,),
    ).fetchone()
    record_dependency_fingerprint(
        conn, artifact_id=current["id"], upstream_artifact_type="application_intelligence_request",
        upstream_content_id=ai_request["content_id"],
    )
    with pytest.raises(PipelineError, match="content_unit:cv_1"):
        build_application_pack(conn, workspace_id)


@pytest.mark.parametrize("status", ["READY", "NEEDS_REVIEW"])
def test_every_eligible_status_needs_disposition_and_acknowledgement_includes(tmp_path, status):
    conn, workspace_id = _workspace(tmp_path)
    unit = {"unit_id": "u", "unit_type": "cv_bullet", "text": "Grounded", "status": status, "profile_evidence_ids": []}
    _, _, _, intelligence = _seed(conn, workspace_id, units=[unit])
    with pytest.raises(PipelineError, match="content_unit:u"):
        build_application_pack(conn, workspace_id)
    _decide(conn, workspace_id, intelligence, "content_unit", "u")
    assert build_application_pack(conn, workspace_id)["cv_content"] == [unit]


def test_explicit_omission_is_excluded_and_preserved_in_audit(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, _, _, intelligence = _seed(conn, workspace_id)
    decision = _decide(conn, workspace_id, intelligence, "content_unit", "cv_1", "omit_from_positioning")
    pack = build_application_pack(conn, workspace_id)
    assert pack["cv_content"] == []
    assert pack["completion_status"] == "INCOMPLETE"
    assert pack["completion_issues"] == [
        "insufficient_cv_units",
        "missing_cv_bullet",
        "insufficient_cv_words",
        "insufficient_cover_letter_paragraphs",
        "insufficient_cover_letter_words",
    ]
    assert pack["review_record"]["exclusions"][0]["domain_item_id"] == "cv_1"
    assert pack["review_record"]["exclusions"][0]["source_artifact_id"] == intelligence["id"]
    assert decision in pack["review_record"]["decisions_consulted"]


def test_gate4_does_not_persist_or_draft_an_incomplete_pack(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, _, _, intelligence = _seed(conn, workspace_id)
    _decide(
        conn, workspace_id, intelligence, "content_unit", "cv_1",
        "omit_from_positioning",
    )

    with pytest.raises(PipelineError, match="insufficient_cv_units"):
        confirm_application_pack(
            conn, workspace_id, effective_date="2026-08-20", documents_root=tmp_path,
        )

    assert get_current_artifact(conn, workspace_id, "application_pack") is None
    assert list_workflow_events(conn, workspace_id) == []
    assert get_workspace(conn, workspace_id)["workflow_status"] is None


def test_unsupported_content_never_enters_pack_but_remains_auditable(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    unsupported = [{"claim_id": "uns_1", "reason": "No evidence", "rejected_atom_ids": ["a1"]}]
    _, _, _, intelligence = _seed(conn, workspace_id, unsupported=unsupported)
    _decide(conn, workspace_id, intelligence, "content_unit", "cv_1")
    pack = build_application_pack(conn, workspace_id)
    assert all(unit.get("claim_id") != "uns_1" for unit in pack["cv_content"])
    assert pack["review_record"]["informational_items"]["application_intelligence_unsupported_claims"] == unsupported


def test_empty_needs_review_shell_from_fully_rejected_unit_cannot_enter_pack(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    unsupported = [{"claim_id": "uns_1", "reason": "Unknown evidence", "rejected_atom_ids": ["a1"]}]
    shell = {
        "unit_id": "cv_rejected", "unit_type": "cv_bullet", "text": "",
        "status": "NEEDS_REVIEW", "profile_evidence_ids": [],
    }
    _, _, _, intelligence = _seed(
        conn, workspace_id, units=[shell], unsupported=unsupported
    )
    _decide(conn, workspace_id, intelligence, "content_unit", "cv_rejected")

    pack = build_application_pack(conn, workspace_id)

    assert pack["cv_content"] == []
    assert pack["review_record"]["informational_items"]["application_intelligence_unsupported_claims"] == unsupported


def test_cited_placeholder_and_conflict_are_gate1_review_items(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    profile = {
        "claims": [{"id": "clm_1", "concept_id": "concept_1", "placeholder": True}],
        "conflicts": [{"id": "conf_1", "concept_id": "concept_1", "values": []}],
    }
    fit = {"direct_matches": [{"match_id": "direct_1", "profile_evidence_ids": ["clm_1"], "job_requirement_ids": ["jobev_1"]}]}
    profile_artifact, _, _, intelligence = _seed(conn, workspace_id, profile=profile, fit=fit)
    _decide(conn, workspace_id, intelligence, "content_unit", "cv_1")
    with pytest.raises(PipelineError) as exc:
        build_application_pack(conn, workspace_id)
    assert "profile_conflict:conf_1" in str(exc.value)
    assert "profile_placeholder:clm_1" in str(exc.value)
    _decide(conn, workspace_id, profile_artifact, "profile_conflict", "conf_1")
    _decide(conn, workspace_id, profile_artifact, "profile_placeholder", "clm_1")
    with pytest.raises(PipelineError, match="profile_conflict:conf_1"):
        build_application_pack(conn, workspace_id)

    _decide(conn, workspace_id, profile_artifact, "profile_conflict", "conf_1", "omit_from_positioning")
    _decide(conn, workspace_id, profile_artifact, "profile_placeholder", "clm_1", "omit_from_positioning")
    pack = build_application_pack(conn, workspace_id)
    assert pack["fit_summary"]["direct_matches"] == []
    assert pack["cv_content"] == []
    assert {item["disposition"] for item in pack["review_record"]["exclusions"]} >= {
        "omit_from_positioning", "excluded_by_gate1",
    }


def test_content_only_profile_integrity_issue_is_quarantined_by_gate1(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    profile = {
        "claims": [{
            "id": "clm_unsafe", "concept_id": "concept_unsafe", "placeholder": True,
        }],
        "conflicts": [{
            "id": "conf_unsafe", "concept_id": "concept_unsafe", "values": [],
        }],
    }
    unit = {
        "unit_id": "cv_unsafe", "unit_type": "cv_bullet", "text": "Unsafe claim",
        "status": "READY", "profile_evidence_ids": ["clm_unsafe"],
    }
    profile_artifact, _, _, _ = _seed(
        conn, workspace_id, profile=profile, units=[unit],
    )

    with pytest.raises(PipelineError) as exc:
        build_application_pack(conn, workspace_id)
    assert "profile_conflict:conf_unsafe" in str(exc.value)
    assert "profile_placeholder:clm_unsafe" in str(exc.value)

    _decide(
        conn, workspace_id, profile_artifact, "profile_conflict", "conf_unsafe",
        "omit_from_positioning",
    )
    _decide(
        conn, workspace_id, profile_artifact, "profile_placeholder", "clm_unsafe",
        "omit_from_positioning",
    )
    pack = build_application_pack(conn, workspace_id)
    assert pack["cv_content"] == []
    assert any(
        item["domain_item_id"] == "cv_unsafe"
        and item["disposition"] == "excluded_by_gate1"
        for item in pack["review_record"]["exclusions"]
    )


def test_gate2_surfaces_require_exact_decisions_and_gaps_remain_informational(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    fit = {
        "gate_assessments": [{"gate_id": "language", "status": "UNVERIFIED"}],
        "human_judgment_questions": [{"question_id": "q1", "question": "Confirm language"}],
        "gaps": [{"gap_id": "gap1", "gap_type": "missing_evidence"}],
    }
    _, _, fit_artifact, intelligence = _seed(conn, workspace_id, fit=fit)
    _decide(conn, workspace_id, intelligence, "content_unit", "cv_1")
    with pytest.raises(PipelineError) as exc:
        build_application_pack(conn, workspace_id)
    assert "gate_flag:gate:language" in str(exc.value)
    assert "human_judgment_question:q1" in str(exc.value)
    _decide(conn, workspace_id, fit_artifact, "gate_flag", "gate:language")
    _decide(conn, workspace_id, fit_artifact, "human_judgment_question", "q1")
    pack = build_application_pack(conn, workspace_id)
    assert pack["review_record"]["informational_items"]["gaps"] == fit["gaps"]


@pytest.mark.parametrize(
    ("collection", "item_type"),
    [("functionally_equivalent_matches", "functionally_equivalent_match"),
     ("transferable_matches", "transferable_match")],
)
def test_review_bearing_matches_require_decision_and_preserve_details(tmp_path, collection, item_type):
    conn, workspace_id = _workspace(tmp_path)
    match = {
        "match_id": "m1", "profile_evidence_ids": ["clm_1"],
        "job_requirement_ids": ["jobev_1"], "conditions": ["Confirm context"],
        "limitations": ["Not identical"],
    }
    _, _, fit_artifact, intelligence = _seed(conn, workspace_id, fit={collection: [match]})
    _decide(conn, workspace_id, intelligence, "content_unit", "cv_1")
    with pytest.raises(PipelineError, match=f"{item_type}:m1"):
        build_application_pack(conn, workspace_id)
    _decide(conn, workspace_id, fit_artifact, item_type, "m1")
    assert build_application_pack(conn, workspace_id)["fit_summary"][collection] == [match]


def test_pack_records_exact_source_artifacts_and_full_job_and_fit_audit(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    profile, job, fit, intelligence = _seed(conn, workspace_id)
    _decide(conn, workspace_id, intelligence, "content_unit", "cv_1")
    pack = build_application_pack(conn, workspace_id)
    assert pack["source_artifacts"] == {
        "profile_snapshot": {"artifact_id": profile["id"], "artifact_type": "profile_snapshot", "content_id": "profilesnap_A"},
        "job_posting_snapshot": {"artifact_id": job["id"], "artifact_type": "job_posting_snapshot", "content_id": "jobsnap_A"},
        "job_fit_result": {"artifact_id": fit["id"], "artifact_type": "job_fit_result", "content_id": "jobfit_A"},
        "application_intelligence_result": {"artifact_id": intelligence["id"], "artifact_type": "application_intelligence_result", "content_id": "aiintel_A"},
    }
    assert pack["job"]["description"] == "Exact posting text"
    assert "gate_assessments" in pack["fit_summary"]


def test_stale_fit_or_intelligence_chain_is_rejected(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, _, _, intelligence = _seed(conn, workspace_id)
    _decide(conn, workspace_id, intelligence, "content_unit", "cv_1")
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot", payload={"claims": [], "conflicts": []}, content_id="profilesnap_B")
    with pytest.raises(PipelineError, match="stale artifacts"):
        build_application_pack(conn, workspace_id)


def test_missing_dependency_identity_cannot_masquerade_as_fresh_chain(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _, _, _, intelligence = _seed(conn, workspace_id)
    _decide(conn, workspace_id, intelligence, "content_unit", "cv_1")
    conn.execute(
        "DELETE FROM dependency_fingerprints WHERE artifact_id=? AND upstream_artifact_type='profile_snapshot'",
        (intelligence["id"],),
    )
    conn.commit()
    with pytest.raises(PipelineError, match="required fingerprint 'profile_snapshot' is missing"):
        build_application_pack(conn, workspace_id)


def test_gate4_binds_exact_immutable_pack_and_allows_redraft_before_submission(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    first = confirm_application_pack(conn, workspace_id, effective_date="2026-08-20", documents_root=tmp_path / "documents")
    first_payload = copy.deepcopy(get_artifact(conn, first["artifact"]["id"])["payload"])
    assert first_payload["completion_contract_version"] == "substantive-completion.v1"
    assert first_payload["completion_metrics"] == {
        "qualifying_cv_unit_count": 2,
        "cv_word_count": 20,
        "qualifying_cover_letter_paragraph_count": 1,
        "cover_letter_word_count": 40,
    }
    second = confirm_application_pack(conn, workspace_id, effective_date="2026-08-21", documents_root=tmp_path / "documents")
    assert first["artifact"]["id"] != second["artifact"]["id"]
    events = list_workflow_events(conn, workspace_id)
    assert {event["submitted_pack_artifact_id"] for event in events[:2]} == {first["artifact"]["id"], second["artifact"]["id"]}
    assert get_artifact(conn, first["artifact"]["id"])["payload"] == first_payload
    first_fingerprints = {
        row["upstream_artifact_type"]: row["upstream_content_id"]
        for row in conn.execute(
            "SELECT upstream_artifact_type, upstream_content_id FROM dependency_fingerprints "
            "WHERE artifact_id=?", (first["artifact"]["id"],),
        ).fetchall()
    }
    assert first_fingerprints == {
        "job_fit_result": first_payload["source_artifacts"]["job_fit_result"]["content_id"],
        "application_intelligence_result": first_payload["source_artifacts"][
            "application_intelligence_result"
        ]["content_id"],
    }
    assert len(list_artifact_history(conn, workspace_id, "application_pack")) == 2


def test_after_submission_applied_binds_current_pack_and_reconfirmation_fails(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    confirmed = confirm_application_pack(conn, workspace_id, effective_date="2026-08-20", documents_root=tmp_path)
    applied = record_status_change(
        conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-21",
        submitted_pack_artifact_id=confirmed["artifact"]["id"],
    )
    assert applied["submitted_pack_artifact_id"] == confirmed["artifact"]["id"]
    with pytest.raises(PipelineError, match="after submission"):
        confirm_application_pack(conn, workspace_id, effective_date="2026-08-22", documents_root=tmp_path)


def test_projection_failure_is_partial_success_and_retry_targets_exact_pack(tmp_path, monkeypatch):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)

    from webapp.services import archive_projection

    real_writer = archive_projection.write_application_pack_projection

    def fail_projection(*args, **kwargs):
        raise OSError("simulated read-only archive")

    monkeypatch.setattr(archive_projection, "write_application_pack_projection", fail_projection)
    result = confirm_application_pack(
        conn, workspace_id, effective_date="2026-08-20", documents_root=tmp_path / "documents"
    )

    assert result["gate4_status"] == "SUCCEEDED"
    assert result["projection"] == {
        "status": "FAILED",
        "archive_path": None,
        "pack_artifact_id": result["artifact"]["id"],
        "retryable": True,
        "error": {
            "type": "OSError",
            "message": "compatibility projection failed; retry this exact pack",
        },
    }
    assert result["archive_path"] is None
    assert len(list_artifact_history(conn, workspace_id, "application_pack")) == 1
    events = list_workflow_events(conn, workspace_id)
    assert len(events) == 1
    assert events[0]["new_status"] == "drafted"
    assert events[0]["submitted_pack_artifact_id"] == result["artifact"]["id"]

    monkeypatch.setattr(archive_projection, "write_application_pack_projection", real_writer)
    retry = retry_application_pack_projection(
        conn, workspace_id, pack_artifact_id=result["artifact"]["id"],
        documents_root=tmp_path / "documents",
    )
    assert retry["status"] == "SUCCEEDED"
    assert retry["pack_artifact_id"] == result["artifact"]["id"]
    assert retry["archive_path"]
    assert len(list_artifact_history(conn, workspace_id, "application_pack")) == 1
    assert len(list_workflow_events(conn, workspace_id)) == 1


def test_projection_retry_is_idempotent_for_exact_pack_artifact(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    confirmed = confirm_application_pack(
        conn, workspace_id, effective_date="2026-08-20", documents_root=tmp_path
    )
    retried = retry_application_pack_projection(
        conn, workspace_id, pack_artifact_id=confirmed["artifact"]["id"], documents_root=tmp_path
    )
    assert retried["archive_path"] == confirmed["archive_path"]
    assert len(list_artifact_history(conn, workspace_id, "application_pack")) == 1
    assert len(list_workflow_events(conn, workspace_id)) == 1


@pytest.mark.parametrize("failure_point", ["first_fingerprint", "second_fingerprint", "status"])
def test_gate4_database_steps_are_atomic_and_retry_safe(tmp_path, monkeypatch, failure_point):
    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)

    from webapp.services import application_pack as module

    real_fingerprint = module.record_dependency_fingerprint
    real_status = module.record_status_change
    calls = 0

    def injected_fingerprint(*args, **kwargs):
        nonlocal calls
        calls += 1
        if (failure_point == "first_fingerprint" and calls == 1) or (
            failure_point == "second_fingerprint" and calls == 2
        ):
            raise sqlite3.OperationalError(f"injected {failure_point}")
        return real_fingerprint(*args, **kwargs)

    def injected_status(*args, **kwargs):
        if failure_point == "status":
            raise sqlite3.OperationalError("injected status")
        return real_status(*args, **kwargs)

    import sqlite3
    monkeypatch.setattr(module, "record_dependency_fingerprint", injected_fingerprint)
    monkeypatch.setattr(module, "record_status_change", injected_status)
    with pytest.raises(sqlite3.OperationalError, match="injected"):
        confirm_application_pack(
            conn, workspace_id, effective_date="2026-08-20", documents_root=tmp_path,
        )

    assert list_artifact_history(conn, workspace_id, "application_pack") == []
    assert get_current_artifact(conn, workspace_id, "application_pack") is None
    assert list_workflow_events(conn, workspace_id) == []
    assert get_workspace(conn, workspace_id)["workflow_status"] is None

    monkeypatch.setattr(module, "record_dependency_fingerprint", real_fingerprint)
    monkeypatch.setattr(module, "record_status_change", real_status)
    retry = confirm_application_pack(
        conn, workspace_id, effective_date="2026-08-20", documents_root=tmp_path,
    )
    assert retry["gate4_status"] == "SUCCEEDED"
    assert len(list_artifact_history(conn, workspace_id, "application_pack")) == 1
    assert len(list_workflow_events(conn, workspace_id)) == 1


def test_application_pack_service_is_only_webapp_drafted_bypass():
    from pathlib import Path

    occurrences = []
    for path in Path("webapp").rglob("*.py"):
        if "_allow_drafted=True" in path.read_text(encoding="utf-8"):
            occurrences.append(path.as_posix())
    assert occurrences == ["webapp/services/application_pack.py"]
    assert "set_workflow_status" not in Path("webapp/persistence/workspaces.py").read_text(
        encoding="utf-8"
    )
