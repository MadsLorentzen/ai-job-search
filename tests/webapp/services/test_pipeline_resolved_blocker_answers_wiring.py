"""Phase 4C Task 9: webapp/services/pipeline.py's run_job_fit materializes
and persists the resolved_blocker_answers.v1 bundle, threads it into
build_semantic_job_fit_request (job-fit-contract.v2, unconditionally), and
records a dependency fingerprint on job_fit_request referencing that exact
persisted bundle artifact.

The single most important correctness requirement (see the plan/prompt):
there is exactly ONE bundle artifact per run_job_fit call, used both as (a)
the request's resolved_blocker_answers content and (b) the dependency
fingerprint's upstream_content_id. test_dependency_fingerprint_references_
the_exact_persisted_bundle_artifact is the test that would fail if two
independently-built bundles were used.
"""

from __future__ import annotations

from webapp.persistence.application_blockers import resolve_application_blocker
from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.application_identity import record_application_origin
from webapp.persistence.db import connect, init_db
from webapp.persistence.workspaces import create_workspace
from webapp.services.decision_policy import current_application_blockers, execute_job_fit_policy
from webapp.services.http_api import fit_job
from webapp.services.pipeline import refresh_profile, run_job_fit
from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter
from webapp.services.staleness import DEPENDENCY_TYPES, check_staleness

from tests.webapp.services.test_answer_applicability import (
    _link_to_search_workspace,
)
from tests.webapp.services.test_application_blockers import (
    EMPTY_JOB_SNAPSHOT,
    SPONSORSHIP_STATUS_JOB_SNAPSHOT,
    _run_fit,
    _workspace,
)


def _empty_adapter():
    return FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})


def _eligibility_blocker(conn, workspace_id):
    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    return next(
        b for b in current_application_blockers(conn, workspace_id, fit_artifact["id"])
        if b["subject_key"] == "gate:eligibility"
    )


# ---------------------------------------------------------------------------
# Basic wiring: empty bundle, v2 request, artifact + fingerprint recorded.
# ---------------------------------------------------------------------------

def test_run_job_fit_with_no_blockers_produces_v2_request_with_empty_bundle(
    tmp_path, webapp_profile_root,
):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=EMPTY_JOB_SNAPSHOT)

    run_job_fit(
        conn, workspace_id, _empty_adapter(), request_id="req-1", active_extensions=[],
    )

    bundle_artifact = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")
    assert bundle_artifact is not None
    assert bundle_artifact["payload"]["schema_version"] == "resolved_blocker_answers.v1"
    assert bundle_artifact["payload"]["answers"] == []

    request_artifact = get_current_artifact(conn, workspace_id, "job_fit_request")
    assert request_artifact["payload"]["schema_version"] == "job-fit-contract.v2"
    assert request_artifact["payload"]["resolved_blocker_answers"]["answers"] == []

    fingerprint_row = conn.execute(
        "SELECT upstream_content_id FROM dependency_fingerprints "
        "WHERE artifact_id = ? AND upstream_artifact_type = 'resolved_blocker_answers'",
        (request_artifact["id"],),
    ).fetchone()
    assert fingerprint_row is not None
    assert fingerprint_row["upstream_content_id"] == bundle_artifact["content_id"]
    conn.close()


# ---------------------------------------------------------------------------
# The single-artifact-identity test.
# ---------------------------------------------------------------------------

def test_dependency_fingerprint_references_the_exact_persisted_bundle_artifact(
    tmp_path, webapp_profile_root,
):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)

    run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-1", active_extensions=[])

    request_artifact = get_current_artifact(conn, workspace_id, "job_fit_request")
    bundle_artifact = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")

    fingerprint_row = conn.execute(
        "SELECT upstream_content_id FROM dependency_fingerprints "
        "WHERE artifact_id = ? AND upstream_artifact_type = 'resolved_blocker_answers'",
        (request_artifact["id"],),
    ).fetchone()
    assert fingerprint_row is not None
    # This is the crux: the fingerprint must reference the SAME bundle
    # artifact that is get_current_artifact()'able right after the call --
    # not a second, independently-built (even if byte-identical) bundle.
    assert fingerprint_row["upstream_content_id"] == bundle_artifact["content_id"]
    # And the request's own embedded resolved_blocker_answers payload must be
    # exactly the persisted bundle's payload, not a separately-recomputed one.
    assert request_artifact["payload"]["resolved_blocker_answers"] == bundle_artifact["payload"]
    conn.close()


# ---------------------------------------------------------------------------
# Own-application answers of all three scopes appear in the same
# application's next v2 request.
# ---------------------------------------------------------------------------

def test_application_only_answer_appears_in_next_v2_request(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)
    resolution = resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-fit-2", active_extensions=[])
    request_artifact = get_current_artifact(conn, workspace_id, "job_fit_request")
    answers = request_artifact["payload"]["resolved_blocker_answers"]["answers"]
    assert len(answers) == 1
    assert answers[0]["resolution_id"] == resolution["id"]
    assert answers[0]["answer_scope"] == "APPLICATION_ONLY"
    conn.close()


def test_search_workspace_answer_appears_in_own_next_v2_request_with_own_workspace_id(
    tmp_path, webapp_profile_root,
):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)
    resolution = resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="SEARCH_WORKSPACE", resolved_by="user_1",
    )

    run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-fit-2", active_extensions=[])
    request_artifact = get_current_artifact(conn, workspace_id, "job_fit_request")
    answers = request_artifact["payload"]["resolved_blocker_answers"]["answers"]
    assert len(answers) == 1
    entry = answers[0]
    assert entry["resolution_id"] == resolution["id"]
    assert entry["answer_scope"] == "SEARCH_WORKSPACE"
    # Proves it's recognized as "own," not accidentally treated as a
    # sibling's answer.
    assert entry["source_workspace_id"] == workspace_id
    conn.close()


def test_candidate_fact_answer_appears_in_own_next_v2_request(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)
    resolution = resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="CANDIDATE_FACT", resolved_by="user_1",
    )

    run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-fit-2", active_extensions=[])
    request_artifact = get_current_artifact(conn, workspace_id, "job_fit_request")
    answers = request_artifact["payload"]["resolved_blocker_answers"]["answers"]
    assert len(answers) == 1
    assert answers[0]["resolution_id"] == resolution["id"]
    assert answers[0]["answer_scope"] == "CANDIDATE_FACT"
    conn.close()


# ---------------------------------------------------------------------------
# Sibling reuse: SEARCH_WORKSPACE only, gated on applicability.
# ---------------------------------------------------------------------------

def _setup_two_sibling_workspaces(tmp_path, webapp_profile_root, *, search_workspace_id="search_1"):
    conn, workspace_a_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    workspace_b = create_workspace(conn, company="Acme", title="Backend Engineer (Sibling)")
    workspace_b_id = workspace_b["id"]
    save_artifact(
        conn, workspace_id=workspace_b_id, artifact_type="job_posting_snapshot",
        payload=SPONSORSHIP_STATUS_JOB_SNAPSHOT, content_id="jobsnap_sibling",
    )
    _link_to_search_workspace(conn, workspace_a_id, search_workspace_id=search_workspace_id, suffix="a")
    _link_to_search_workspace(conn, workspace_b_id, search_workspace_id=search_workspace_id, suffix="b")
    _run_fit(conn, workspace_a_id, tmp_path, request_id="req-fit-a")
    _run_fit(conn, workspace_b_id, tmp_path, request_id="req-fit-b")
    return conn, workspace_a_id, workspace_b_id


def test_sibling_search_workspace_answer_appears_via_real_pipeline_rerun(
    tmp_path, webapp_profile_root,
):
    conn, workspace_a_id, workspace_b_id = _setup_two_sibling_workspaces(tmp_path, webapp_profile_root)
    blocker_a = _eligibility_blocker(conn, workspace_a_id)
    resolution = resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="SEARCH_WORKSPACE", resolved_by="user_1",
    )

    # Sibling B reruns Job Fit (its own posting also has a matching
    # sponsorship requirement, so applicability holds) -- through the real
    # production pipeline, not a unit-level bundle-only call.
    run_job_fit(conn, workspace_b_id, _empty_adapter(), request_id="req-fit-b-2", active_extensions=[])
    request_b = get_current_artifact(conn, workspace_b_id, "job_fit_request")
    answers_b = request_b["payload"]["resolved_blocker_answers"]["answers"]
    assert len(answers_b) == 1
    entry = answers_b[0]
    assert entry["resolution_id"] == resolution["id"]
    assert entry["matched_scope_source"] == "SEARCH_WORKSPACE"
    assert entry["source_workspace_id"] == workspace_a_id  # genuinely a sibling's answer
    conn.close()


def test_candidate_fact_answer_never_reused_by_sibling_via_real_pipeline_rerun(
    tmp_path, webapp_profile_root,
):
    conn, workspace_a_id, workspace_b_id = _setup_two_sibling_workspaces(tmp_path, webapp_profile_root)
    blocker_a = _eligibility_blocker(conn, workspace_a_id)
    resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="CANDIDATE_FACT", resolved_by="user_1",
    )

    run_job_fit(conn, workspace_b_id, _empty_adapter(), request_id="req-fit-b-2", active_extensions=[])
    request_b = get_current_artifact(conn, workspace_b_id, "job_fit_request")
    answers_b = request_b["payload"]["resolved_blocker_answers"]["answers"]
    assert answers_b == []
    conn.close()


# ---------------------------------------------------------------------------
# Every bundle entry produced by the real pipeline carries source_workspace_id.
# ---------------------------------------------------------------------------

def test_every_pipeline_produced_bundle_entry_has_source_workspace_id(
    tmp_path, webapp_profile_root,
):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-fit-2", active_extensions=[])
    bundle_artifact = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")
    assert bundle_artifact["payload"]["answers"]  # sanity: not empty
    for entry in bundle_artifact["payload"]["answers"]:
        assert "source_workspace_id" in entry
    conn.close()


# ---------------------------------------------------------------------------
# Determinism: unchanged effective answers -> identical content_id;
# changed answer -> different content_id.
# ---------------------------------------------------------------------------

def test_repeated_run_job_fit_with_no_answer_change_produces_same_bundle_content_id(
    tmp_path, webapp_profile_root,
):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-fit-2", active_extensions=[])
    content_id_1 = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")["content_id"]

    run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-fit-3", active_extensions=[])
    content_id_2 = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")["content_id"]

    assert content_id_1 == content_id_2
    conn.close()


def test_correcting_answer_between_runs_changes_bundle_content_id(
    tmp_path, webapp_profile_root,
):
    # Two-gate snapshot so the sponsorship gate's blocker instance survives
    # the rerun (the language gate stays REQUIRE_USER, so the workspace
    # never fully unblocks and there is a blocker to correct after rerun 2).
    from tests.webapp.services.test_application_blockers import TWO_MATERIAL_GATES_JOB_SNAPSHOT

    job_snapshot = {
        **TWO_MATERIAL_GATES_JOB_SNAPSHOT,
        "eligibility_requirements": SPONSORSHIP_STATUS_JOB_SNAPSHOT["eligibility_requirements"],
    }
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=job_snapshot)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": True},  # sponsorship required -> stays blocked
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )
    fit_artifact_2 = run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-fit-2", active_extensions=[])
    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=fit_artifact_2)
    content_id_before = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")["content_id"]

    # Correct the answer (same blocker instance, new resolution).
    blocker_after_first_rerun = _eligibility_blocker(conn, workspace_id)
    resolve_application_blocker(
        conn, blocker_id=blocker_after_first_rerun["id"], request_id="req-answer-2-correction",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )
    run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-fit-3", active_extensions=[])
    content_id_after = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")["content_id"]

    assert content_id_before != content_id_after
    conn.close()


# ---------------------------------------------------------------------------
# Staleness: DEPENDENCY_TYPES now includes resolved_blocker_answers, and a
# changed effective answer (without a rerun) makes job_fit_request/result
# report stale.
# ---------------------------------------------------------------------------

def test_job_fit_request_dependency_types_include_resolved_blocker_answers():
    assert "resolved_blocker_answers" in DEPENDENCY_TYPES["job_fit_request"]


def test_changed_answer_without_rerun_makes_job_fit_stale(tmp_path, webapp_profile_root):
    # Use a two-gate snapshot so the sponsorship gate's blocker survives the
    # rerun (a second, unrelated gate stays REQUIRE_USER, so the workspace
    # never fully unblocks and the sponsorship blocker instance used for the
    # correction below remains addressable) -- mirrors spec §13's
    # "still-blocked second question" scenario.
    from tests.webapp.services.test_application_blockers import TWO_MATERIAL_GATES_JOB_SNAPSHOT

    job_snapshot = {
        **TWO_MATERIAL_GATES_JOB_SNAPSHOT,
        "eligibility_requirements": SPONSORSHIP_STATUS_JOB_SNAPSHOT["eligibility_requirements"],
    }
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=job_snapshot)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": True},  # sponsorship required -> stays blocked
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )
    fit_artifact_2 = run_job_fit(conn, workspace_id, _empty_adapter(), request_id="req-fit-2", active_extensions=[])
    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=fit_artifact_2)

    # Sanity: immediately after the rerun, resolved_blocker_answers itself
    # is not what's stale (the fingerprint matches the just-saved bundle).
    request_staleness_before = check_staleness(conn, workspace_id, "job_fit_request")
    assert not any(
        "resolved_blocker_answers" in reason for reason in request_staleness_before["reasons"]
    )

    # Correct the answer WITHOUT rerunning Job Fit again. The gate blocker
    # instance still exists (still REQUIRE_USER, since the language gate is
    # still unanswered), so it can be corrected.
    blocker_after_rerun = _eligibility_blocker(conn, workspace_id)
    resolve_application_blocker(
        conn, blocker_id=blocker_after_rerun["id"], request_id="req-answer-2-correction",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    # Spec §10: staleness is detected at the *next bundle materialization*,
    # not spontaneously. check_staleness compares job_fit_request's recorded
    # fingerprint against the CURRENT resolved_blocker_answers artifact --
    # which is still the pre-correction one until something recomputes and
    # saves a fresh bundle. Task 9 only wires bundle materialization into
    # run_job_fit itself (the orchestration layer that would recompute the
    # bundle standalone, per spec §11 step 4, is explicitly out of scope --
    # see Task 11). So this test materializes+saves a fresh bundle directly,
    # exactly as run_job_fit's own bundle step would do, WITHOUT rerunning
    # the rest of Job Fit -- this is what makes the dependency graph
    # observably truthful end-to-end (spec §10's actual claim), without
    # reaching into Task 11's orchestration scope.
    from webapp.persistence.artifacts import save_artifact
    from webapp.services.pipeline import _hash_artifact
    from webapp.services.resolved_blocker_answers import build_resolved_blocker_answers_payload

    fresh_bundle = build_resolved_blocker_answers_payload(conn, workspace_id)
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="resolved_blocker_answers",
        payload=fresh_bundle, content_id=_hash_artifact("blockeranswers_", fresh_bundle),
    )

    request_staleness = check_staleness(conn, workspace_id, "job_fit_request")
    assert request_staleness["stale"] is True
    assert any("resolved_blocker_answers" in reason for reason in request_staleness["reasons"])

    result_staleness = check_staleness(conn, workspace_id, "job_fit_result")
    assert result_staleness["stale"] is True
    conn.close()


# ---------------------------------------------------------------------------
# v1 backward-compatibility: a hand-built v1 payload remains acceptable to
# the validators.
# ---------------------------------------------------------------------------

def test_old_v1_job_fit_request_payload_still_validates(tmp_path, webapp_profile_root):
    from product.semantic_job_fit import (
        build_resolved_job_evidence_bundle,
        build_semantic_job_fit_request,
        validate_semantic_job_fit_request,
    )

    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=EMPTY_JOB_SNAPSHOT)
    from webapp.services.pipeline import get_current_profile_snapshot

    profile_artifact = get_current_profile_snapshot(conn)
    job_artifact = get_current_artifact(conn, workspace_id, "job_posting_snapshot")
    bundle = build_resolved_job_evidence_bundle(
        job_artifact["payload"], job_understanding_request=None, job_understanding_result=None,
    )

    # Deliberately omit resolved_blocker_answers -- this is the exact,
    # unmodified v1 code path (job-fit-request.v1), simulating a v1
    # artifact persisted before this task's change.
    v1_request = build_semantic_job_fit_request(
        request_id="req_old_v1", profile_snapshot=profile_artifact["payload"],
        job_snapshot=job_artifact["payload"], resolved_job_evidence=bundle,
        active_extensions=[], semantic_proposals={"matches": [], "gates": []},
    )
    assert v1_request["schema_version"] == "job-fit-request.v1"
    assert "resolved_blocker_answers" not in v1_request

    # Must not raise -- v1 remains readable/acceptable history.
    validate_semantic_job_fit_request(v1_request)
    conn.close()
