"""build_resolved_blocker_answers_payload: the resolved_blocker_answers.v1
bundle (Phase 4C spec §4). Deterministic ordering, no volatile
timestamps, content-addressed via content_identity()."""

from __future__ import annotations

from webapp.persistence.application_blockers import resolve_application_blocker
from webapp.persistence.application_identity import record_application_origin
from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.workspaces import create_workspace
from webapp.services.decision_policy import current_application_blockers
from webapp.services.input_identity import content_identity
from webapp.services.resolved_blocker_answers import (
    RESOLVED_BLOCKER_ANSWERS_SCHEMA_VERSION,
    build_resolved_blocker_answers_payload,
)

from tests.webapp.services.test_answer_applicability import (
    _ensure_search_workspace,
    _link_to_search_workspace,
)
from tests.webapp.services.test_application_blockers import (
    EMPTY_JOB_SNAPSHOT,
    SPONSORSHIP_STATUS_JOB_SNAPSHOT,
    TWO_MATERIAL_GATES_JOB_SNAPSHOT,
    _run_fit,
    _workspace,
)


def _resolve_the_sponsorship_gate(conn, workspace_id, tmp_path, *, value: bool, request_id: str, answer_scope: str = "APPLICATION_ONLY"):
    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    if fit_artifact is None:
        _run_fit(conn, workspace_id, tmp_path, request_id=f"req-fit-{request_id}")
        fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    blocker = next(
        b for b in current_application_blockers(conn, workspace_id, fit_artifact["id"])
        if b["subject_key"] == "gate:eligibility"
    )
    return resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id=request_id,
        answer_value={"type": "boolean", "value": value},
        answer_scope=answer_scope, resolved_by="user_1",
    )


def test_empty_bundle_for_workspace_with_no_blockers(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=EMPTY_JOB_SNAPSHOT)
    payload = build_resolved_blocker_answers_payload(conn, workspace_id)
    assert payload["schema_version"] == RESOLVED_BLOCKER_ANSWERS_SCHEMA_VERSION
    assert payload["answers"] == []
    conn.close()


def test_bundle_includes_effective_application_only_answer(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    resolution = _resolve_the_sponsorship_gate(
        conn, workspace_id, tmp_path, value=False, request_id="req-answer-1",
    )
    payload = build_resolved_blocker_answers_payload(conn, workspace_id)
    assert len(payload["answers"]) == 1
    entry = payload["answers"][0]
    assert entry["resolution_id"] == resolution["id"]
    assert entry["subject_key"] == "gate:eligibility"
    assert entry["semantic_subject_key"] == "work_authorization.sponsorship_required"
    assert entry["value"] == {"type": "boolean", "value": False}
    assert entry["matched_scope_source"] == "APPLICATION_ONLY"
    conn.close()


def test_bundle_payload_has_no_timestamp_field(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    _resolve_the_sponsorship_gate(conn, workspace_id, tmp_path, value=False, request_id="req-answer-1")
    payload = build_resolved_blocker_answers_payload(conn, workspace_id)
    entry = payload["answers"][0]
    assert "created_at" not in entry
    assert "resolved_at" not in entry
    conn.close()


def test_unchanged_effective_answers_produce_identical_content_id(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    _resolve_the_sponsorship_gate(conn, workspace_id, tmp_path, value=False, request_id="req-answer-1")

    payload_1 = build_resolved_blocker_answers_payload(conn, workspace_id)
    payload_2 = build_resolved_blocker_answers_payload(conn, workspace_id)
    assert content_identity("blockeranswers_", payload_1) == content_identity("blockeranswers_", payload_2)
    conn.close()


def test_correction_changes_content_id(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    _resolve_the_sponsorship_gate(conn, workspace_id, tmp_path, value=False, request_id="req-answer-1")
    payload_before = build_resolved_blocker_answers_payload(conn, workspace_id)

    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    blocker = next(
        b for b in current_application_blockers(conn, workspace_id, fit_artifact["id"])
        if b["subject_key"] == "gate:eligibility"
    )
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-2-correction",
        answer_value={"type": "boolean", "value": True},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )
    payload_after = build_resolved_blocker_answers_payload(conn, workspace_id)
    assert content_identity("blockeranswers_", payload_before) != content_identity("blockeranswers_", payload_after)
    assert payload_after["answers"][0]["value"] == {"type": "boolean", "value": True}
    conn.close()


def test_own_workspace_candidate_fact_answer_is_included(tmp_path, webapp_profile_root):
    # Correction per spec §5 point 3 / §17: CANDIDATE_FACT resolves its
    # own originating application exactly like APPLICATION_ONLY -- it
    # must appear in this workspace's own bundle via tier 1, not be
    # skipped because it isn't APPLICATION_ONLY.
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    resolution = _resolve_the_sponsorship_gate(
        conn, workspace_id, tmp_path, value=False, request_id="req-answer-1",
        answer_scope="CANDIDATE_FACT",
    )
    payload = build_resolved_blocker_answers_payload(conn, workspace_id)
    assert len(payload["answers"]) == 1
    entry = payload["answers"][0]
    assert entry["resolution_id"] == resolution["id"]
    assert entry["answer_scope"] == "CANDIDATE_FACT"
    assert entry["matched_scope_source"] == "CANDIDATE_FACT"
    conn.close()


def test_candidate_fact_answer_on_a_never_appears_in_b_bundle(tmp_path, webapp_profile_root):
    # Correction per spec §5 point 3 / §17: no cross-workspace lookup for
    # CANDIDATE_FACT exists anywhere in Phase 4C, even for a genuine
    # SEARCH_WORKSPACE sibling.
    conn, workspace_a_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    workspace_b = create_workspace(conn, company="Acme", title="Backend Engineer (Sibling)")
    workspace_b_id = workspace_b["id"]
    save_artifact(
        conn, workspace_id=workspace_b_id, artifact_type="job_posting_snapshot",
        payload=SPONSORSHIP_STATUS_JOB_SNAPSHOT, content_id="jobsnap_sibling",
    )

    _link_to_search_workspace(conn, workspace_a_id, search_workspace_id="search_1", suffix="a")
    _link_to_search_workspace(conn, workspace_b_id, search_workspace_id="search_1", suffix="b")

    _run_fit(conn, workspace_a_id, tmp_path, request_id="req-fit-a")
    _run_fit(conn, workspace_b_id, tmp_path, request_id="req-fit-b")

    fit_artifact_a = get_current_artifact(conn, workspace_a_id, "job_fit_result")
    blocker_a = next(
        b for b in current_application_blockers(conn, workspace_a_id, fit_artifact_a["id"])
        if b["subject_key"] == "gate:eligibility"
    )
    resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="CANDIDATE_FACT", resolved_by="user_1",
    )
    payload_b = build_resolved_blocker_answers_payload(conn, workspace_b_id)
    assert payload_b["answers"] == []
    conn.close()


def test_answers_are_sorted_by_subject_key_then_resolution_id(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=TWO_MATERIAL_GATES_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    blockers = current_application_blockers(conn, workspace_id, fit_artifact["id"])
    for i, blocker in enumerate(blockers):
        resolve_application_blocker(
            conn, blocker_id=blocker["id"], request_id=f"req-answer-{i}",
            answer_value={"type": "string", "value": "yes"},
            answer_scope="APPLICATION_ONLY", resolved_by="user_1",
        )
    payload = build_resolved_blocker_answers_payload(conn, workspace_id)
    subject_keys = [entry["subject_key"] for entry in payload["answers"]]
    assert subject_keys == sorted(subject_keys)
    conn.close()
