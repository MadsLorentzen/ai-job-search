"""Phase 4C Task 11: resume_job_fit_after_resolution end-to-end (spec Sec 11,
Sec 20 acceptance scenarios).

resume_job_fit_after_resolution is a thin orchestration layer over existing,
already-reviewed production behavior: it does not call resolve_blocker/
resolve_application_blocker itself (that must have already happened,
separately, before this function runs), does not reimplement bundle
construction (webapp/services/resolved_blocker_answers.py, wired into
run_job_fit since Task 9), and does not reimplement workflow-state
derivation (decision_policy.derive_workspace_policy_state, unchanged).

Setup conventions are copied from tests/webapp/services/test_application_
blockers.py's _workspace/_run_fit helpers and tests/webapp/services/
test_pipeline_resolved_blocker_answers_wiring.py / test_answer_
applicability.py's sibling-workspace helpers -- not from the implementation
plan's own (stale, guessed-API) prose.
"""

from __future__ import annotations

from webapp.persistence.application_blockers import (
    get_effective_resolution,
    list_blocker_resolution_history,
    resolve_application_blocker,
)
from webapp.persistence.artifacts import get_artifact, get_current_artifact, save_artifact
from webapp.persistence.workspaces import create_workspace
from webapp.services.decision_policy import (
    current_application_blockers,
    current_policy_decisions,
    resume_job_fit_after_resolution,
)
from webapp.services.http_api import fit_job
from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter

from tests.webapp.services.test_answer_applicability import _link_to_search_workspace
from tests.webapp.services.test_application_blockers import (
    SPONSORSHIP_STATUS_JOB_SNAPSHOT,
    TWO_MATERIAL_GATES_JOB_SNAPSHOT,
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


def _sponsorship_adapter(conn, blocker_id):
    """A FakeSemanticProposalAdapter whose eligibility-gate proposal reacts
    to the blocker's REAL, current effective resolution at the moment
    Job Fit actually calls propose() -- not a value fixed at construction
    time. This is the minimal test-support extension described in
    FakeSemanticProposalAdapter's own docstring: propose_fn is a plain
    closure over conn/blocker_id, reading the live database each call via
    the existing, unmodified get_effective_resolution persistence
    function. It performs no adjudication of its own -- it only decides
    which canned-shaped proposal to hand to the real, unmodified
    _build_gate_assessments/validate_resolved_answer_citation/
    execute_job_fit_policy pipeline, exactly parallel to what a fixed
    canned_response already does when the case doesn't need to react to
    a live, correctable answer.
    """

    def propose_fn(context):
        resolution = get_effective_resolution(conn, blocker_id)
        if resolution is None:
            return {"matches": [], "gates": []}
        requires_sponsorship = resolution["answer_value"]["value"]
        job_evidence_id = "jobev_elig_spons_1"
        if requires_sponsorship:
            gate_proposal = {
                "gate_id": "eligibility",
                "status": "FAIL",
                "reason": "Candidate confirmed sponsorship would be required; posting states none is offered.",
                "job_evidence_ids": [job_evidence_id],
                "profile_evidence_ids": [],
                "resolved_answer_ids": [resolution["id"]],
            }
        else:
            gate_proposal = {
                "gate_id": "eligibility",
                "status": "PASS",
                "reason": "Candidate confirmed no sponsorship is required for this role.",
                "job_evidence_ids": [job_evidence_id],
                "profile_evidence_ids": [],
                "resolved_answer_ids": [resolution["id"]],
            }
        return {"matches": [], "gates": [gate_proposal]}

    return FakeSemanticProposalAdapter(propose_fn=propose_fn)


# ---------------------------------------------------------------------------
# Scenario 1: primary unblock.
# ---------------------------------------------------------------------------


def test_primary_scenario_sponsorship_answer_unblocks_workspace(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    old_fit_artifact = _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)

    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    result = resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )

    assert result["workflow_state"] == "PROCEEDING"

    new_fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    assert new_fit_artifact["id"] != old_fit_artifact["id"]

    eligibility_decision = next(
        d for d in result["policy_decisions"] if d["subject_key"] == "gate:eligibility"
    )
    assert eligibility_decision["outcome"] == "AUTO_PROCEED"

    # No duplicate/false blocker exists for gate:eligibility on the new
    # artifact -- AUTO_PROCEED creates none at all (_maybe_create_blocker
    # only ever fires for REQUIRE_USER).
    new_blockers = current_application_blockers(conn, workspace_id, new_fit_artifact["id"])
    assert not [b for b in new_blockers if b["subject_key"] == "gate:eligibility"]

    # result["job_fit_result"] IS the current artifact, not merely some dict.
    assert result["job_fit_result"] == get_artifact(conn, new_fit_artifact["id"])

    # result["policy_decisions"] matches current_policy_decisions for the
    # same artifact.
    assert result["policy_decisions"] == current_policy_decisions(
        conn, workspace_id, new_fit_artifact["id"]
    )
    conn.close()


# ---------------------------------------------------------------------------
# Scenario 2: correction flips PASS to FAIL.
# ---------------------------------------------------------------------------


def test_correction_scenario_flips_outcome_to_declined(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)

    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )
    first_resume = resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    assert first_resume["workflow_state"] == "PROCEEDING"
    first_resume_fit_artifact_id = first_resume["job_fit_result"]["id"]
    first_resume_bundle = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")

    # Correction: the user actually DOES require sponsorship.
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-2-correction",
        answer_value={"type": "boolean", "value": True},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    second_resume = resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-3", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )

    assert second_resume["workflow_state"] == "DECLINED_BY_POLICY"
    eligibility_decision = next(
        d for d in second_resume["policy_decisions"] if d["subject_key"] == "gate:eligibility"
    )
    assert eligibility_decision["outcome"] == "AUTO_REJECT"

    # The corrected answer is reflected in a NEW resolved_blocker_answers
    # bundle with a different content_id from before.
    second_resume_bundle = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")
    assert second_resume_bundle["content_id"] != first_resume_bundle["content_id"]

    # The original "favorable" resolution remains in history, untouched.
    history = list_blocker_resolution_history(conn, blocker["id"])
    assert len(history) == 2
    assert history[0]["answer_value"] == {"type": "boolean", "value": False}
    assert history[1]["answer_value"] == {"type": "boolean", "value": True}

    # The PREVIOUS job_fit_result/policy-decision artifacts from the first
    # resume remain in the database, unmodified, still readable.
    prior_fit_artifact = get_artifact(conn, first_resume_fit_artifact_id)
    assert prior_fit_artifact is not None
    assert prior_fit_artifact["id"] == first_resume_fit_artifact_id
    prior_decisions = current_policy_decisions(conn, workspace_id, first_resume_fit_artifact_id)
    prior_eligibility_decision = next(
        d for d in prior_decisions if d["subject_key"] == "gate:eligibility"
    )
    assert prior_eligibility_decision["outcome"] == "AUTO_PROCEED"
    conn.close()


# ---------------------------------------------------------------------------
# Scenario 3: still blocked (a second, unrelated, unanswered blocker).
# ---------------------------------------------------------------------------


def test_still_blocked_scenario_second_unrelated_blocker_remains_open(
    tmp_path, webapp_profile_root,
):
    job_snapshot = {
        **TWO_MATERIAL_GATES_JOB_SNAPSHOT,
        "eligibility_requirements": SPONSORSHIP_STATUS_JOB_SNAPSHOT["eligibility_requirements"],
    }
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root, job_snapshot=job_snapshot)
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)

    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )
    # Note: the language gate blocker is deliberately left unanswered.

    result = resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )

    assert result["workflow_state"] == "BLOCKED_FOR_USER"
    eligibility_decision = next(
        d for d in result["policy_decisions"] if d["subject_key"] == "gate:eligibility"
    )
    assert eligibility_decision["outcome"] == "AUTO_PROCEED"

    new_fit_artifact_id = result["job_fit_result"]["id"]
    new_blockers = current_application_blockers(conn, workspace_id, new_fit_artifact_id)
    language_blockers = [b for b in new_blockers if b["subject_key"] == "gate:language"]
    assert language_blockers
    assert language_blockers[0]["status"] == "open"
    conn.close()


# ---------------------------------------------------------------------------
# CANDIDATE_FACT invariant, exercised THROUGH resume_job_fit_after_resolution.
# ---------------------------------------------------------------------------


def test_candidate_fact_answer_never_enters_sibling_bundle_via_resume(
    tmp_path, webapp_profile_root,
):
    conn, workspace_a_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    workspace_b = create_workspace(conn, company="Acme", title="Backend Engineer (Sibling)")
    workspace_b_id = workspace_b["id"]
    save_artifact(
        conn, workspace_id=workspace_b_id, artifact_type="job_posting_snapshot",
        payload=SPONSORSHIP_STATUS_JOB_SNAPSHOT, content_id="jobsnap_sibling",
    )
    _link_to_search_workspace(conn, workspace_a_id, search_workspace_id="search_cf", suffix="cf_a")
    _link_to_search_workspace(conn, workspace_b_id, search_workspace_id="search_cf", suffix="cf_b")

    _run_fit(conn, workspace_a_id, tmp_path, request_id="req-fit-a1")
    _run_fit(conn, workspace_b_id, tmp_path, request_id="req-fit-b1")

    blocker_a = _eligibility_blocker(conn, workspace_a_id)
    resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-a-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="CANDIDATE_FACT", resolved_by="user_1",
    )
    # Resume A itself, to prove the CANDIDATE_FACT answer legitimately
    # resolves its OWN originating workspace...
    result_a = resume_job_fit_after_resolution(
        conn, workspace_a_id, _sponsorship_adapter(conn, blocker_a["id"]),
        request_id="req-fit-a2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    assert result_a["workflow_state"] == "PROCEEDING"

    # ...but resuming sibling B (through this same new resume path) must
    # never see A's CANDIDATE_FACT-scoped answer in its own bundle/Job Fit
    # input -- Task 9's build_resolved_blocker_answers_payload/
    # find_semantic_subject_match already enforce this by construction;
    # this test exercises it specifically through resume, not new logic.
    blocker_b = _eligibility_blocker(conn, workspace_b_id)
    result_b = resume_job_fit_after_resolution(
        conn, workspace_b_id, _empty_adapter(),
        request_id="req-fit-b2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    bundle_b = get_current_artifact(conn, workspace_b_id, "resolved_blocker_answers")
    assert bundle_b["payload"]["answers"] == []
    # B's own eligibility blocker is still open/REQUIRE_USER -- A's answer
    # never leaked in to resolve it.
    assert result_b["workflow_state"] == "BLOCKED_FOR_USER"
    conn.close()


# ---------------------------------------------------------------------------
# source_workspace_id invariant, exercised THROUGH resume_job_fit_after_resolution.
# ---------------------------------------------------------------------------


def test_sibling_search_workspace_reuse_keeps_correct_source_workspace_id_via_resume(
    tmp_path, webapp_profile_root,
):
    conn, workspace_a_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    workspace_b = create_workspace(conn, company="Acme", title="Backend Engineer (Sibling)")
    workspace_b_id = workspace_b["id"]
    save_artifact(
        conn, workspace_id=workspace_b_id, artifact_type="job_posting_snapshot",
        payload=SPONSORSHIP_STATUS_JOB_SNAPSHOT, content_id="jobsnap_sibling_sw",
    )
    _link_to_search_workspace(conn, workspace_a_id, search_workspace_id="search_sw", suffix="sw_a")
    _link_to_search_workspace(conn, workspace_b_id, search_workspace_id="search_sw", suffix="sw_b")

    _run_fit(conn, workspace_a_id, tmp_path, request_id="req-fit-a1")
    _run_fit(conn, workspace_b_id, tmp_path, request_id="req-fit-b1")

    blocker_a = _eligibility_blocker(conn, workspace_a_id)
    resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-a-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="SEARCH_WORKSPACE", resolved_by="user_1",
    )

    # Resume sibling B -- its own bundle should legitimately reuse A's
    # SEARCH_WORKSPACE-scoped answer (same search workspace, same semantic
    # subject, B's own posting has a matching requirement).
    blocker_b = _eligibility_blocker(conn, workspace_b_id)
    result_b = resume_job_fit_after_resolution(
        conn, workspace_b_id, _sponsorship_adapter(conn, blocker_a["id"]),
        request_id="req-fit-b2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )

    bundle_b = get_current_artifact(conn, workspace_b_id, "resolved_blocker_answers")
    assert len(bundle_b["payload"]["answers"]) == 1
    entry = bundle_b["payload"]["answers"][0]
    assert entry["matched_scope_source"] == "SEARCH_WORKSPACE"
    # The crux: source_workspace_id correctly identifies the SIBLING (A),
    # never workspace B itself, even though this bundle was materialized
    # as part of B's OWN resume call.
    assert entry["source_workspace_id"] == workspace_a_id
    assert entry["source_workspace_id"] != workspace_b_id

    assert result_b["workflow_state"] == "PROCEEDING"
    conn.close()
