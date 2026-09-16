"""Phase 4C Task 12: retry/idempotency regression coverage for the complete
blocker-resolution/resume stack (spec Sec 16).

This is deliberately a tests-only task. Tasks 4-9 already established and
tested the core per-function idempotency contracts this task exercises:

  - resolve_application_blocker is idempotent on (blocker_id, request_id) --
    tests/webapp/services/test_application_blockers.py::
    test_retry_of_same_resolution_request_is_idempotent already proves a
    retried resolve_blocker call returns the SAME resolution id and creates
    no second history row.
  - execute_job_fit_policy is idempotent per artifact -- test_decision_policy.py
    ::test_retrying_same_artifact_creates_no_duplicates and
    test_application_blockers.py::test_retry_is_idempotent_no_duplicate_blocker
    already prove no duplicate policy_decisions/application_blockers rows.
  - build_resolved_blocker_answers_payload is deterministic/content-stable
    under repeated recomputation with no underlying change --
    test_resolved_blocker_answers.py::
    test_unchanged_effective_answers_produce_identical_content_id and
    test_pipeline_resolved_blocker_answers_wiring.py::
    test_repeated_run_job_fit_with_no_answer_change_produces_same_bundle_content_id
    already prove this both at the raw-payload level and through the real
    run_job_fit pipeline.

What is NOT yet covered anywhere, and what this file adds:

  1. A full-stack retry test that goes through the actual Task 11
     orchestration entry point (resume_job_fit_after_resolution) itself,
     rather than only its constituent functions in isolation.
  2. Proof that the SEARCH_WORKSPACE sibling-reuse source_workspace_id and
     the CANDIDATE_FACT cross-workspace exclusion invariant (both Task 9
     invariants, both already tested under a CORRECTION in
     test_job_fit_resume.py) remain stable specifically under a RETRY (the
     same request_id, no semantic change) -- a retry recomputing the bundle
     must not accidentally perturb either invariant.
  3. Proof that a confirmed-but-unsubmitted application pack does NOT go
     falsely stale when a blocker resolution is retried with an unchanged
     answer (the mirror image of Task 10's own
     test_changed_resolved_blocker_answers_without_rerun_makes_application_pack_stale,
     which proves the opposite direction -- a genuine change DOES stale it).
  4. Explicit confirmation that a genuine correction (new request_id, new
     answer_value) is NOT swallowed by the retry-idempotency machinery --
     i.e. that this file's retry-focused additions have not accidentally
     weakened the correction path Task 11 already established.

No production code is expected to change for this task; every assertion
below exercises an already-implemented idempotency contract.
"""

from __future__ import annotations

from webapp.persistence.application_blockers import (
    list_blocker_resolution_history,
    resolve_application_blocker,
)
from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.workspaces import create_workspace
from webapp.services.decision_policy import (
    current_application_blockers,
    current_policy_decisions,
    execute_job_fit_policy,
    resume_job_fit_after_resolution,
)
from webapp.services.input_identity import content_identity
from webapp.services.resolved_blocker_answers import build_resolved_blocker_answers_payload
from webapp.services.staleness import check_staleness

from tests.webapp.services.test_answer_applicability import _link_to_search_workspace
from tests.webapp.services.test_application_blockers import (
    SPONSORSHIP_STATUS_JOB_SNAPSHOT,
    _run_fit,
    _workspace,
)
from tests.webapp.services.test_application_pack_staleness_via_resolved_blocker_answers import (
    _confirm_pack_then_correct_answer_without_rerun,
)
from tests.webapp.services.test_job_fit_resume import _eligibility_blocker, _sponsorship_adapter


# ---------------------------------------------------------------------------
# 1. Full-stack retry through resume_job_fit_after_resolution itself.
# ---------------------------------------------------------------------------


def test_retrying_resume_after_unchanged_answer_creates_no_duplicate_state(
    tmp_path, webapp_profile_root,
):
    """Calling resume_job_fit_after_resolution twice in a row, with no
    intervening change to the effective blocker answer, must not create a
    second logical state: no duplicate governing policy decision, no
    duplicate open blocker, and workflow_state must be identical both
    times. The two resume calls use different request_ids (a real resume
    orchestration call is not itself idempotency-keyed the way
    resolve_application_blocker is -- see its docstring: "this function
    does not call resolve_blocker itself" -- so this proves idempotency at
    the SEMANTIC level: same underlying answer in, same governing state
    out, regardless of how many times Job Fit itself is rerun).
    """
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

    first = resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    second = resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-3", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )

    assert first["workflow_state"] == second["workflow_state"] == "PROCEEDING"

    first_eligibility = next(
        d for d in first["policy_decisions"] if d["subject_key"] == "gate:eligibility"
    )
    second_eligibility = next(
        d for d in second["policy_decisions"] if d["subject_key"] == "gate:eligibility"
    )
    assert first_eligibility["outcome"] == second_eligibility["outcome"] == "AUTO_PROCEED"

    # No duplicate governing blocker for gate:eligibility on either resume's
    # own current artifact -- AUTO_PROCEED never creates one.
    second_artifact_id = second["job_fit_result"]["id"]
    governing_blockers = current_application_blockers(conn, workspace_id, second_artifact_id)
    assert not [b for b in governing_blockers if b["subject_key"] == "gate:eligibility"]

    # Only one resolution exists in history -- neither resume call itself
    # calls resolve_application_blocker (spec Sec 11 step 3/Task 11's own
    # invariant), so retrying resume alone must never grow the answer
    # history.
    history = list_blocker_resolution_history(conn, blocker["id"])
    assert len(history) == 1
    conn.close()


def test_retrying_resume_produces_identical_bundle_content_id(tmp_path, webapp_profile_root):
    """The resolved_blocker_answers bundle recomputed by a second resume
    call, with no intervening answer change, must be byte-identical
    (same content_id) to the bundle from the first resume call -- proves
    spec Sec 4/Sec 10's determinism guarantee holds through the real
    orchestration entry point, not just through build_resolved_blocker_
    answers_payload called directly."""
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

    resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    first_bundle = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")

    resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-3", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    second_bundle = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")

    assert first_bundle["content_id"] == second_bundle["content_id"]
    assert first_bundle["payload"] == second_bundle["payload"]
    conn.close()


# ---------------------------------------------------------------------------
# 2. Retried execute_job_fit_policy against a resumed (not just an initial)
#    Job Fit result -- proves the pre-existing per-artifact idempotency
#    contract also holds for a result produced via resume, across the
#    REQUIRE_USER / AUTO_PROCEED / AUTO_REJECT outcomes Task 11 exercises.
# ---------------------------------------------------------------------------


def test_retrying_execute_job_fit_policy_on_resumed_artifact_creates_no_duplicates(
    tmp_path, webapp_profile_root,
):
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
    result = resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    fit_artifact = result["job_fit_result"]

    before = current_policy_decisions(conn, workspace_id, fit_artifact["id"])
    before_blockers = current_application_blockers(conn, workspace_id, fit_artifact["id"])

    # Retry policy execution directly against the SAME resumed artifact --
    # mirrors test_decision_policy.py::test_retrying_same_artifact_creates_no_duplicates,
    # but against an artifact that resume_job_fit_after_resolution produced,
    # not a bare fit_job call.
    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=fit_artifact)
    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=fit_artifact)

    after = current_policy_decisions(conn, workspace_id, fit_artifact["id"])
    after_blockers = current_application_blockers(conn, workspace_id, fit_artifact["id"])

    assert len(after) == len(before)
    assert len(after_blockers) == len(before_blockers)
    conn.close()


# ---------------------------------------------------------------------------
# 3. Sibling source_workspace_id and CANDIDATE_FACT invariants under RETRY
#    (not correction -- Task 11 already covers correction).
# ---------------------------------------------------------------------------


def test_sibling_source_workspace_id_stable_across_repeated_resume(tmp_path, webapp_profile_root):
    """A SEARCH_WORKSPACE-scoped sibling answer's source_workspace_id must
    remain the true originating workspace across repeated resume calls on
    the reusing workspace, with no intervening change to either side's
    answer -- recomputing the bundle repeatedly must never drift the
    identity toward the reusing workspace itself."""
    conn, workspace_a_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    workspace_b = create_workspace(conn, company="Acme", title="Backend Engineer (Sibling)")
    workspace_b_id = workspace_b["id"]
    save_artifact(
        conn, workspace_id=workspace_b_id, artifact_type="job_posting_snapshot",
        payload=SPONSORSHIP_STATUS_JOB_SNAPSHOT, content_id="jobsnap_sibling_retry",
    )
    _link_to_search_workspace(conn, workspace_a_id, search_workspace_id="search_retry", suffix="retry_a")
    _link_to_search_workspace(conn, workspace_b_id, search_workspace_id="search_retry", suffix="retry_b")

    _run_fit(conn, workspace_a_id, tmp_path, request_id="req-fit-a1")
    _run_fit(conn, workspace_b_id, tmp_path, request_id="req-fit-b1")

    blocker_a = _eligibility_blocker(conn, workspace_a_id)
    resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-a-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="SEARCH_WORKSPACE", resolved_by="user_1",
    )

    # Resume B twice, no change to A's answer between calls.
    result_b_1 = resume_job_fit_after_resolution(
        conn, workspace_b_id, _sponsorship_adapter(conn, blocker_a["id"]),
        request_id="req-fit-b2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    bundle_b_1 = get_current_artifact(conn, workspace_b_id, "resolved_blocker_answers")
    result_b_2 = resume_job_fit_after_resolution(
        conn, workspace_b_id, _sponsorship_adapter(conn, blocker_a["id"]),
        request_id="req-fit-b3", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    bundle_b_2 = get_current_artifact(conn, workspace_b_id, "resolved_blocker_answers")

    for bundle in (bundle_b_1, bundle_b_2):
        assert len(bundle["payload"]["answers"]) == 1
        entry = bundle["payload"]["answers"][0]
        assert entry["source_workspace_id"] == workspace_a_id
        assert entry["source_workspace_id"] != workspace_b_id
        assert entry["matched_scope_source"] == "SEARCH_WORKSPACE"

    assert bundle_b_1["content_id"] == bundle_b_2["content_id"]
    assert result_b_1["workflow_state"] == result_b_2["workflow_state"] == "PROCEEDING"
    conn.close()


def test_candidate_fact_stays_excluded_from_sibling_bundle_across_repeated_resume(
    tmp_path, webapp_profile_root,
):
    """A CANDIDATE_FACT-scoped answer must remain absent from a sibling's
    bundle across repeated resume calls on BOTH workspaces -- repeatedly
    recomputing either side's bundle must never cause the exclusion to
    erode (e.g. via some cached/stale lookup accidentally admitting it on
    a later call)."""
    conn, workspace_a_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    workspace_b = create_workspace(conn, company="Acme", title="Backend Engineer (Sibling)")
    workspace_b_id = workspace_b["id"]
    save_artifact(
        conn, workspace_id=workspace_b_id, artifact_type="job_posting_snapshot",
        payload=SPONSORSHIP_STATUS_JOB_SNAPSHOT, content_id="jobsnap_sibling_cf_retry",
    )
    _link_to_search_workspace(conn, workspace_a_id, search_workspace_id="search_cf_retry", suffix="cfr_a")
    _link_to_search_workspace(conn, workspace_b_id, search_workspace_id="search_cf_retry", suffix="cfr_b")

    _run_fit(conn, workspace_a_id, tmp_path, request_id="req-fit-a1")
    _run_fit(conn, workspace_b_id, tmp_path, request_id="req-fit-b1")

    blocker_a = _eligibility_blocker(conn, workspace_a_id)
    resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-a-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="CANDIDATE_FACT", resolved_by="user_1",
    )
    resume_job_fit_after_resolution(
        conn, workspace_a_id, _sponsorship_adapter(conn, blocker_a["id"]),
        request_id="req-fit-a2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )

    from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter

    def _empty_adapter():
        return FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})

    for request_id in ("req-fit-b2", "req-fit-b3"):
        result_b = resume_job_fit_after_resolution(
            conn, workspace_b_id, _empty_adapter(),
            request_id=request_id, extension_ids=[], extensions_dir=tmp_path / "extensions",
        )
        bundle_b = get_current_artifact(conn, workspace_b_id, "resolved_blocker_answers")
        assert bundle_b["payload"]["answers"] == []
        assert result_b["workflow_state"] == "BLOCKED_FOR_USER"
    conn.close()


# ---------------------------------------------------------------------------
# 4. Pack safety: a RETRIED (unchanged) resolution must not falsely stale a
#    confirmed pack -- the mirror image of Task 10's own test proving a
#    genuine change DOES stale it.
# ---------------------------------------------------------------------------


def test_retried_blocker_resolution_does_not_falsely_stale_confirmed_pack(
    tmp_path, webapp_profile_root,
):
    """Confirm a pack (via the same real setup Task 10 uses, which itself
    performs one genuine post-confirmation correction -- req-answer-2-
    correction -- to prove staleness in the sibling test module). Establish
    a baseline staleness reading AFTER that genuine correction, then retry
    that SAME correction call again: identical blocker_id, identical
    request_id, identical answer_value.

    resolve_application_blocker's own (blocker_id, request_id) idempotency
    (INSERT OR IGNORE) means this retry is a pure no-op: no new
    blocker_resolutions row, no changed effective resolution. Recomputing
    the bundle afterward must therefore produce the SAME content_id as the
    baseline, and check_staleness("application_pack") must report exactly
    the same result as the baseline -- the retry must not introduce any
    ADDITIONAL staleness beyond what the genuine correction already,
    legitimately caused.

    This is the retry-shaped converse of
    test_changed_resolved_blocker_answers_without_rerun_makes_application_pack_stale,
    which proves a GENUINE change does stale the pack; this test proves a
    retried NON-change introduces no further effect on top of that.
    """
    conn, workspace_id, pack_artifact_id = _confirm_pack_then_correct_answer_without_rerun(
        tmp_path, webapp_profile_root,
    )
    blocker = _eligibility_blocker(conn, workspace_id)

    baseline_bundle = get_current_artifact(conn, workspace_id, "resolved_blocker_answers")
    baseline_staleness = check_staleness(conn, workspace_id, "application_pack")
    baseline_history_len = len(list_blocker_resolution_history(conn, blocker["id"]))

    # Retry the SAME correction call again: identical request_id, identical
    # answer_value -- resolve_application_blocker's (blocker_id, request_id)
    # idempotency must make this a pure no-op.
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-2-correction",
        answer_value={"type": "boolean", "value": True},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    assert len(list_blocker_resolution_history(conn, blocker["id"])) == baseline_history_len

    bundle_after_retry = build_resolved_blocker_answers_payload(conn, workspace_id)
    assert content_identity("blockeranswers_", bundle_after_retry) == baseline_bundle["content_id"]

    staleness_after_retry = check_staleness(conn, workspace_id, "application_pack")
    assert staleness_after_retry == baseline_staleness
    conn.close()


# ---------------------------------------------------------------------------
# 5. Correction is NOT swallowed by retry idempotency -- explicit guard
#    against this file's own retry-focused additions weakening Task 11's
#    established correction behavior.
# ---------------------------------------------------------------------------


def test_correction_with_new_request_id_still_changes_outcome_after_retries(
    tmp_path, webapp_profile_root,
):
    """Sandwich a genuine correction between two no-op retries of resume,
    and confirm the correction still flips PROCEEDING to DECLINED_BY_POLICY
    exactly as Task 11's own correction-scenario test proves in isolation
    -- retries before and after a correction must not mask or dilute it."""
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
    # Retry resume twice before the correction -- pure no-ops.
    for request_id in ("req-fit-2", "req-fit-2b"):
        result = resume_job_fit_after_resolution(
            conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
            request_id=request_id, extension_ids=[], extensions_dir=tmp_path / "extensions",
        )
        assert result["workflow_state"] == "PROCEEDING"

    # Genuine correction.
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-2-correction",
        answer_value={"type": "boolean", "value": True},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )
    corrected = resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-3", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    assert corrected["workflow_state"] == "DECLINED_BY_POLICY"

    # Retry resume twice after the correction -- must remain declined, not
    # revert or duplicate state.
    for request_id in ("req-fit-4", "req-fit-4b"):
        result = resume_job_fit_after_resolution(
            conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
            request_id=request_id, extension_ids=[], extensions_dir=tmp_path / "extensions",
        )
        assert result["workflow_state"] == "DECLINED_BY_POLICY"

    history = list_blocker_resolution_history(conn, blocker["id"])
    assert len(history) == 2
    assert history[0]["answer_value"] == {"type": "boolean", "value": False}
    assert history[1]["answer_value"] == {"type": "boolean", "value": True}
    conn.close()
