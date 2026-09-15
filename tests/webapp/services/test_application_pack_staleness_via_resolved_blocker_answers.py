"""Phase 4C Task 10: does a changed resolved_blocker_answers bundle, WITHOUT
a Job Fit rerun, make an already-confirmed-but-unsubmitted application pack
stale and block 'applied' -- via the existing transitive dependency chain,
with no new edge in DEPENDENCY_TYPES["application_pack"]?

DEPENDENCY_TYPES["application_pack"] has never listed resolved_blocker_answers
directly, and Phase 4C's Task 9 did not add it there. The chain is:

    resolved_blocker_answers (Task 9)
        -> fingerprinted into job_fit_request (Task 9's DEPENDENCY_TYPES change)
        -> job_fit_request feeds job_fit_result (pre-4C)
        -> application_pack depends on job_fit_result (pre-4C)

tests/webapp/services/test_application_pack_staleness_characterization.py
(Task 1) already proved the general invariant -- "a confirmed-but-unsubmitted
pack whose Job Fit basis has gone stale cannot be marked applied" -- for a
job-posting-driven basis change. That characterization test, however,
documents a CONFIRMED GAP: no check_staleness call exists anywhere in
webapp/persistence/workflow.py's 'applied' branch, and the 'applied'
transition actually succeeds despite the pack being stale (see that test's
own docstring/comments and its final assertions, which assert success, not
a raised ValueError). webapp/persistence/workflow.py has never been touched
by any Phase 4C commit (verified via git log), so this gap is present today
regardless of which artifact type caused the staleness.

This test proves the narrower, Task-10-specific question -- does
_check_staleness_recursive's existing recursive descent detect a
resolved_blocker_answers-driven change specifically, one hop further out at
application_pack, via the SAME transitive mechanism Task 9's own
test_changed_answer_without_rerun_makes_job_fit_stale
(tests/webapp/services/test_pipeline_resolved_blocker_answers_wiring.py)
already proved one hop closer in (job_fit_request/job_fit_result) -- and
separately proves the real, current behavior of the 'applied' gate given
the gap Task 1 already found.
"""

from __future__ import annotations

import pytest

from webapp.persistence.application_blockers import resolve_application_blocker
from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.db import connect, init_db
from webapp.persistence.review import save_review_decision
from webapp.persistence.workflow import record_status_change
from webapp.persistence.workspaces import create_workspace, ensure_profile_workspace
from webapp.services.application_pack import confirm_application_pack
from webapp.services.decision_policy import current_application_blockers, execute_job_fit_policy
from webapp.services.pipeline import refresh_profile, run_job_fit
from webapp.services.resolved_blocker_answers import build_resolved_blocker_answers_payload
from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter
from webapp.services.staleness import check_staleness, record_dependency_fingerprint
from webapp.services.input_identity import (
    application_intelligence_generation_contract_identity,
    application_intelligence_policy_identity,
)

from tests.webapp.services.test_application_blockers import (
    TWO_MATERIAL_GATES_JOB_SNAPSHOT,
    SPONSORSHIP_STATUS_JOB_SNAPSHOT,
)


def _empty_adapter():
    return FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})


def _eligibility_blocker(conn, workspace_id):
    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    return next(
        b for b in current_application_blockers(conn, workspace_id, fit_artifact["id"])
        if b["subject_key"] == "gate:eligibility"
    )


def _confirm_pack_then_correct_answer_without_rerun(tmp_path, webapp_profile_root):
    """Build a real workspace through run_job_fit, resolve the sponsorship
    blocker, rerun Job Fit (so job_fit_result reflects the answer), run
    Application Intelligence (hand-built, matching test_application_pack.py's
    own _seed/_decide pattern -- no real AI provider needed for this test),
    confirm the pack (Gate 4, binding it to the CURRENT job_fit_result), then
    -- WITHOUT rerunning Job Fit again -- correct the blocker's answer and
    materialize+save a fresh resolved_blocker_answers bundle directly, exactly
    as test_changed_answer_without_rerun_makes_job_fit_stale does one hop
    closer in.

    Returns (conn, workspace_id, pack_artifact_id).
    """
    from webapp.services.pipeline import _hash_artifact, get_current_profile_snapshot

    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ensure_profile_workspace(conn)
    refresh_profile(conn, root=str(webapp_profile_root))

    # Two-gate snapshot so the sponsorship gate's blocker instance survives
    # the rerun after being answered (a second, unrelated material gate --
    # the language requirement -- stays REQUIRE_USER, so the workspace never
    # fully unblocks and the sponsorship blocker instance remains addressable
    # for the later correction). Mirrors Task 9's own
    # test_changed_answer_without_rerun_makes_job_fit_stale exactly.
    job_snapshot = {
        **TWO_MATERIAL_GATES_JOB_SNAPSHOT,
        "eligibility_requirements": SPONSORSHIP_STATUS_JOB_SNAPSHOT["eligibility_requirements"],
    }
    workspace = create_workspace(conn, company="Acme", title="Backend Engineer")
    workspace_id = workspace["id"]
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
        payload=job_snapshot, content_id="jobsnap_task10",
    )

    # Real Job Understanding run (not hand-built): run_job_fit's XOR guard
    # requires both or neither of understanding_request/result to exist, and
    # DEPENDENCY_TYPES["resolved_job_evidence"] unconditionally requires
    # fingerprints for job_understanding_request/result -- a MISSING
    # fingerprint (never having run Understanding at all) is treated by
    # _check_staleness_recursive as staleness, which would make
    # resolved_job_evidence (and everything downstream, transitively)
    # permanently stale and block confirm_application_pack outright. This is
    # orthogonal to what this test is proving. The job_snapshot fixtures used
    # here (TWO_MATERIAL_GATES_JOB_SNAPSHOT/SPONSORSHIP_STATUS_JOB_SNAPSHOT)
    # have no description/raw_text, so Job Understanding's own source
    # selection resolves to None and the extraction short-circuits to an
    # UNAVAILABLE result without ever calling a provider -- a dummy provider
    # object is passed but never invoked.
    from webapp.services.pipeline import run_job_understanding

    class _UnusedProvider:
        provider_id = "unused"
        model_id = "unused"
        model_version = "v0"

        def extract(self, request):
            raise AssertionError("provider should not be called: job_snapshot has no source text")

    run_job_understanding(conn, workspace_id, _UnusedProvider(), request_id="req-understand-1")

    # Run 1: discover the sponsorship blocker.
    fit_artifact_1 = run_job_fit(
        conn, workspace_id, _empty_adapter(), request_id="req-fit-1", active_extensions=[],
    )
    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=fit_artifact_1)
    blocker = _eligibility_blocker(conn, workspace_id)

    # Answer it: no sponsorship required.
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    # Run 2: Job Fit reruns, reflecting the answer. The sponsorship gate
    # should now resolve favorably; the language gate remains REQUIRE_USER
    # (unanswered), so the sponsorship blocker instance from this run
    # persists as 'open' history and the workspace stays blocked overall --
    # which is fine, since pack confirmation does not require the workflow
    # to be fully unblocked, only that the artifacts used are not stale.
    fit_artifact_2 = run_job_fit(
        conn, workspace_id, _empty_adapter(), request_id="req-fit-2", active_extensions=[],
    )
    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=fit_artifact_2)

    # Acknowledge every review-bearing item on the CURRENT job_fit_result
    # (Gate 2, mirroring test_full_journey_acceptance.py's
    # _decide_current_review_surface, but via the direct persistence call
    # instead of the HTTP review-decisions endpoint) -- required for
    # _build_application_pack_with_profile to not raise "outstanding review
    # items" for gate_flag/human_judgment_question entries. This is
    # independent of and does not affect the sponsorship gate's own
    # REQUIRE_USER/AUTO_PROCEED policy classification, which is governed
    # entirely by application_blockers/policy_decisions, not by
    # review_decisions.
    for gate in fit_artifact_2["payload"].get("gate_assessments", []):
        if gate.get("status") in {"FLAG", "UNVERIFIED"}:
            save_review_decision(
                conn, workspace_id=workspace_id, review_item_type="gate_flag",
                source_artifact_id=fit_artifact_2["id"], domain_item_id=f"gate:{gate['gate_id']}",
                disposition="acknowledged_and_proceed", note="Test acknowledgement",
            )
    for question in fit_artifact_2["payload"].get("human_judgment_questions", []):
        save_review_decision(
            conn, workspace_id=workspace_id, review_item_type="human_judgment_question",
            source_artifact_id=fit_artifact_2["id"], domain_item_id=question["question_id"],
            disposition="acknowledged_and_proceed", note="Test acknowledgement",
        )
    for collection, item_type in (
        ("functionally_equivalent_matches", "functionally_equivalent_match"),
        ("transferable_matches", "transferable_match"),
    ):
        for match in fit_artifact_2["payload"].get(collection, []):
            save_review_decision(
                conn, workspace_id=workspace_id, review_item_type=item_type,
                source_artifact_id=fit_artifact_2["id"], domain_item_id=match["match_id"],
                disposition="acknowledged_and_proceed", note="Test acknowledgement",
            )

    # Application Intelligence: hand-built (matching test_application_pack.py's
    # _seed/_completion_ready_units/_decide pattern), citing a real,
    # non-placeholder claim id from webapp_profile_root's own profile, rather
    # than invoking a real AI provider -- Task 10 is about pack-safety
    # staleness plumbing, not AI generation.
    profile_artifact = get_current_profile_snapshot(conn)
    claim_id = next(
        claim["id"] for claim in profile_artifact["payload"]["claims"]
        if not claim.get("placeholder")
    )

    def _words(count, prefix):
        return " ".join(f"{prefix}{index}" for index in range(count))

    ai_units = [
        {"unit_id": "cv_1", "unit_type": "cv_bullet", "text": _words(10, "bullet"),
         "status": "READY", "profile_evidence_ids": [claim_id]},
        {"unit_id": "cv_2", "unit_type": "cv_summary_line", "text": _words(10, "summary"),
         "status": "READY", "profile_evidence_ids": [claim_id]},
        {"unit_id": "cover_1", "unit_type": "cover_letter_paragraph", "text": _words(40, "cover"),
         "status": "READY", "profile_evidence_ids": [claim_id]},
    ]
    intelligence_request = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_request",
        payload={}, content_id="aiintelreq_task10",
    )
    for upstream_type, upstream_id in (
        ("profile_snapshot", profile_artifact["content_id"]),
        ("job_fit_result", fit_artifact_2["content_id"]),
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
    intelligence = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={
            "recommendation": "APPLY", "recommendation_reason": "Evidence-backed fit.",
            "cv_content": [u for u in ai_units if u["unit_type"] in {"cv_bullet", "cv_summary_line"}],
            "cover_letter_content": [u for u in ai_units if u["unit_type"] == "cover_letter_paragraph"],
            "unsupported_claims": [],
        },
        content_id="aiintel_task10",
    )
    for upstream_type, upstream_id in (
        ("profile_snapshot", profile_artifact["content_id"]),
        ("application_intelligence_request", intelligence_request["content_id"]),
        ("job_fit_result", fit_artifact_2["content_id"]),
    ):
        record_dependency_fingerprint(
            conn, artifact_id=intelligence["id"], upstream_artifact_type=upstream_type,
            upstream_content_id=upstream_id,
        )
    for unit in ai_units:
        save_review_decision(
            conn, workspace_id=workspace_id, review_item_type="content_unit",
            source_artifact_id=intelligence["id"], domain_item_id=unit["unit_id"],
            disposition="acknowledged_and_proceed", note=f"Reviewed {unit['unit_id']}",
        )

    # Gate 4: confirm the pack. This binds the pack to the CURRENT
    # job_fit_result (fit_artifact_2, the one produced after the first answer).
    result = confirm_application_pack(
        conn, workspace_id, effective_date="2026-09-15",
        documents_root=tmp_path / "documents",
    )
    pack_artifact_id = result["artifact"]["id"]

    # Now, WITHOUT rerunning Job Fit again, correct the blocker's answer (a
    # new resolve_application_blocker call with a new request_id), and
    # materialize+save a fresh resolved_blocker_answers bundle directly --
    # exactly like test_changed_answer_without_rerun_makes_job_fit_stale does
    # -- since the orchestration layer that would do this automatically
    # (resume_job_fit_after_resolution) is out of scope for Task 10.
    blocker_after_rerun = _eligibility_blocker(conn, workspace_id)
    resolve_application_blocker(
        conn, blocker_id=blocker_after_rerun["id"], request_id="req-answer-2-correction",
        answer_value={"type": "boolean", "value": True},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )
    fresh_bundle = build_resolved_blocker_answers_payload(conn, workspace_id)
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="resolved_blocker_answers",
        payload=fresh_bundle, content_id=_hash_artifact("blockeranswers_", fresh_bundle),
    )

    return conn, workspace_id, pack_artifact_id


def test_changed_resolved_blocker_answers_without_rerun_makes_application_pack_stale(
    tmp_path, webapp_profile_root,
):
    """Proves the transitive chain (resolved_blocker_answers -> job_fit_request
    -> job_fit_result -> application_pack) actually detects a
    resolved_blocker_answers-driven change, without any new direct edge in
    DEPENDENCY_TYPES["application_pack"]."""
    conn, workspace_id, _pack_artifact_id = _confirm_pack_then_correct_answer_without_rerun(
        tmp_path, webapp_profile_root,
    )

    staleness = check_staleness(conn, workspace_id, "application_pack")
    assert staleness["stale"] is True
    assert any(
        "job_fit_result is itself stale" in reason for reason in staleness["reasons"]
    ), staleness["reasons"]
    conn.close()


def test_changed_resolved_blocker_answers_without_rerun_blocks_applied_via_low_level_record_status_change(
    tmp_path, webapp_profile_root,
):
    """Documents the CURRENT, real behavior of the low-level
    webapp.persistence.workflow.record_status_change primitive itself (not
    the production entry points that call it): it contains NO
    check_staleness call for ANY artifact type, in any branch, and this
    call therefore SUCCEEDS despite the bound pack being stale.

    This is intentional and remains true after Task 10's fix: the fix (see
    test_change_job_status_rejects_applied_when_pack_is_stale below) is
    added at the service-layer call site
    webapp/services/http_api.py::change_job_status (the production HTTP
    entry point for this transition), not inside
    webapp/persistence/workflow.py itself -- webapp/persistence/* never
    imports webapp/services/* anywhere in this codebase (verified: zero
    such imports exist, contrasted with 17 the other direction), and
    reproducing that exact violation here (to make the low-level primitive
    itself staleness-aware) would repeat the same class of layering mistake
    commit 947f5d7 already paid down elsewhere ("product/ must never
    depend on webapp/", the identical principle one layer down:
    persistence/ must never depend on services/).

    NOTE: webapp/services/handoff.py::confirm_handoff_submission is a
    SECOND production entry point that also transitions a workspace to
    'applied' (the extension-handoff submission-confirmation flow) and
    currently has NO equivalent staleness gate. This was left unfixed for
    this task -- it is a separate production module with its own careful,
    already-tested invariants, outside Task 10's mandated regression
    suites and outside the plan's own file list for this task
    (webapp/persistence/workflow.py only) -- and is flagged here as a
    known residual gap rather than silently left unmentioned.
    """
    conn, workspace_id, pack_artifact_id = _confirm_pack_then_correct_answer_without_rerun(
        tmp_path, webapp_profile_root,
    )

    staleness = check_staleness(conn, workspace_id, "application_pack")
    assert staleness["stale"] is True

    event = record_status_change(
        conn, workspace_id=workspace_id, new_status="applied",
        effective_date="2026-09-16",
        submitted_pack_artifact_id=pack_artifact_id,
    )
    assert event["new_status"] == "applied"
    conn.close()


def test_change_job_status_rejects_applied_when_pack_is_stale(tmp_path, webapp_profile_root):
    """The permanent regression test for Phase 4C spec Sec15's required
    invariant, gated at the real production entry point
    (webapp.services.http_api.change_job_status) rather than at the
    low-level persistence primitive (see the test above for why)."""
    from webapp.services.http_api import change_job_status
    from webapp.services.pipeline import PipelineError

    conn, workspace_id, _pack_artifact_id = _confirm_pack_then_correct_answer_without_rerun(
        tmp_path, webapp_profile_root,
    )

    staleness = check_staleness(conn, workspace_id, "application_pack")
    assert staleness["stale"] is True

    with pytest.raises(PipelineError, match="stale"):
        change_job_status(
            conn, workspace_id, new_status="applied",
            effective_date="2026-09-16", note=None,
        )
    conn.close()
