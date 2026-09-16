"""Phase 4C Task 13: closes the last two scenarios of the design spec's
Sec19 16-scenario fail-first acceptance matrix
(docs/superpowers/specs/2026-09-14-phase-4c-blocker-resolution-consumption-resume-design.md)
that Task 13's coverage audit found had no dedicated regression test:

  - Scenario 11: profile evidence and a resolved blocker answer disagree
    -> evidence_disposition becomes CONFLICTING, not SUPPORTIVE, and policy
    classification remains/returns REQUIRE_USER (spec Sec9's table, the
    "Present, supportive [profile] + Present, validated, disagrees
    [resolved answer]" row).
  - Scenario 13: resolving a blocker (resolve_application_blocker alone,
    with NO resume_job_fit_after_resolution call) does not itself change
    any governing state for the still-current artifact (spec Sec11 step 3,
    step 10).

Both are genuine production-path exercises, not hand-constructed results:
Scenario 11 supplies the SAME gate proposal shape production Job Fit
already accepts (a semantic adapter proposal citing both a real
profile_evidence_id and a validated resolved_answer_ids entry), and lets
the real _build_gate_assessments/validate_resolved_answer_citation/
execute_job_fit_policy pipeline derive CONFLICTING and REQUIRE_USER
itself -- the test never constructs evidence_disposition or outcome by
hand. Scenario 13 never touches resume at all; it proves the ABSENCE of
its effect.
"""

from __future__ import annotations

from webapp.persistence.application_blockers import resolve_application_blocker
from webapp.persistence.artifacts import get_current_artifact
from webapp.services.decision_policy import (
    current_application_blockers,
    current_policy_decisions,
    derive_workspace_policy_state,
    resume_job_fit_after_resolution,
)
from webapp.services.pipeline import get_current_profile_snapshot, run_job_fit
from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter

from tests.webapp.services.test_application_blockers import (
    SPONSORSHIP_STATUS_JOB_SNAPSHOT,
    _run_fit,
    _workspace,
)
from tests.webapp.services.test_job_fit_resume import _eligibility_blocker, _sponsorship_adapter


# ---------------------------------------------------------------------------
# Scenario 11: profile evidence and a resolved answer disagree -> CONFLICTING
# -> REQUIRE_USER, not silently AUTO_PROCEED or AUTO_REJECT.
# ---------------------------------------------------------------------------


def test_conflicting_profile_and_resolved_answer_evidence_stays_require_user(
    tmp_path, webapp_profile_root,
):
    """Real profile evidence (a genuine, non-placeholder claim from the
    profile snapshot) is cited alongside a resolved blocker answer that
    supplies contradictory information (the candidate confirmed
    sponsorship IS required). The semantic adapter's own proposal --
    exactly the trust boundary spec Sec9 assigns to it -- asserts the
    disagreement via the EXPLICIT cross_source_relation="CONFLICTING"
    field (ENGINE_VERSION v2's contract fix), not by merely citing both
    evidence lists together with a reason string that says "conflict".

    This distinction matters: neither _supportive_profile_claims nor
    validate_resolved_answer_citation ever compares evidence CONTENT to
    detect disagreement -- both only check citation legitimacy (real,
    non-placeholder, in-bundle, scope-valid). Populating both citation
    arrays proves nothing about whether the two sources actually
    disagree (see Task 11's own _sponsorship_adapter, whose FAIL proposal
    cites resolved_answer_ids ALONE and correctly resolves to SUPPORTIVE/
    AUTO_REJECT, not CONFLICTING, even though it is also a FAIL). Only
    the adapter's explicit cross_source_relation value is the genuine
    agree/disagree signal; _build_gate_assessments reads it verbatim and
    never infers it from citation-list shape.

    The deterministic layer (_build_gate_assessments) must derive
    evidence_disposition=CONFLICTING from this explicit relation -- never
    SUPPORTIVE, and never by silently preferring one source over the
    other. The Application Decision Policy classifier must then respond
    with REQUIRE_USER (ENGINE_VERSION v2: CONFLICTING takes precedence
    over the ordinary supported-FAIL AUTO_REJECT rule), not AUTO_REJECT
    (AUTO_REJECT is reserved for a gate status FAIL whose disposition is
    NOT CONFLICTING -- the DIFFERENT code path Task 11's correction-
    scenario test exercises, where the FAIL is supported by the resolved
    answer alone with no profile evidence in play at all).

    This test constructs nothing about evidence_disposition or outcome by
    hand -- it supplies inputs through the real production request/
    proposal shape (including the explicit cross_source_relation field)
    and reads the real, persisted policy_decisions/application_blockers
    rows that execute_job_fit_policy produces.
    """
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)

    # A real, non-placeholder profile claim whose category is one
    # select_semantic_profile_evidence/build_prompt_context actually
    # include in the adapter's context (webapp/services/
    # semantic_proposal_adapter.py's SEMANTIC_CATEGORIES) -- an "identity"
    # claim like the candidate's name is real and non-placeholder but is
    # never semantic evidence the adapter can cite, so it must be excluded
    # here exactly as production does. Evidence Profile authority is never
    # touched or reinterpreted by this test; the claim is cited exactly
    # as-is, the same way test_application_pack_staleness_via_resolved_
    # blocker_answers.py's own fixture picks one (that fixture happens to
    # land on an identity claim because it never cites the claim through
    # the semantic adapter -- this test does, so it needs a claim the
    # adapter's own context actually carries).
    from webapp.services.semantic_proposal_adapter import SEMANTIC_CATEGORIES

    profile_artifact = get_current_profile_snapshot(conn)
    claim_id = next(
        claim["id"] for claim in profile_artifact["payload"]["claims"]
        if not claim.get("placeholder") and claim.get("category") in SEMANTIC_CATEGORIES
    )

    # The candidate answers "yes, sponsorship IS required" -- directly
    # contradicting the otherwise-supportive profile claim's implication
    # that the candidate can freely proceed.
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-conflict-1",
        answer_value={"type": "boolean", "value": True},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    def propose_fn(context):
        from webapp.persistence.application_blockers import get_effective_resolution

        resolution = get_effective_resolution(conn, blocker["id"])
        job_evidence_id = "jobev_elig_spons_1"
        # The adapter's OWN explicit judgment that the two sources
        # conflict -- exactly the trust boundary spec Sec9 assigns to it.
        # cross_source_relation="CONFLICTING" is the genuine agree/
        # disagree signal (ENGINE_VERSION v2's contract fix); citing both
        # profile_evidence_ids and resolved_answer_ids together is NOT
        # itself evidence of conflict (see this test's own docstring and
        # test_dual_source_aligned_fail_is_supportive_not_conflicting in
        # tests/product/test_cross_source_relation_integration.py, where
        # the same dual citation shape with cross_source_relation=ALIGNED
        # correctly resolves to SUPPORTIVE, not CONFLICTING). The
        # deterministic layer never re-derives agreement/disagreement
        # itself -- it only validates each citation is legitimate and
        # reads this field verbatim.
        gate_proposal = {
            "gate_id": "eligibility",
            "status": "FAIL",
            "reason": (
                "Profile evidence suggests no sponsorship barrier, but the "
                "candidate's own confirmed answer states sponsorship IS "
                "required -- these two sources conflict."
            ),
            "job_evidence_ids": [job_evidence_id],
            "profile_evidence_ids": [claim_id],
            "resolved_answer_ids": [resolution["id"]],
            "cross_source_relation": "CONFLICTING",
        }
        return {"matches": [], "gates": [gate_proposal]}

    adapter = FakeSemanticProposalAdapter(propose_fn=propose_fn)

    result = resume_job_fit_after_resolution(
        conn, workspace_id, adapter,
        request_id="req-fit-2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )

    # The production adjudication path actually validated the citation and
    # derived CONFLICTING -> REQUIRE_USER; the test never asserted this
    # directly into existence.
    new_fit_artifact = result["job_fit_result"]
    gate_assessment = next(
        g for g in new_fit_artifact["payload"]["gate_assessments"] if g["gate_id"] == "eligibility"
    )
    assert gate_assessment["evidence_disposition"] == "CONFLICTING"
    assert claim_id in gate_assessment["profile_evidence_ids"]
    assert gate_assessment["resolved_answer_ids"]  # citation was validated, not silently dropped

    eligibility_decision = next(
        d for d in result["policy_decisions"] if d["subject_key"] == "gate:eligibility"
    )
    assert eligibility_decision["outcome"] == "REQUIRE_USER"
    assert result["workflow_state"] == "BLOCKED_FOR_USER"

    # A real governing blocker exists for gate:eligibility on the new
    # artifact -- the conflict was NOT silently resolved in either
    # direction (not AUTO_PROCEED favoring the profile claim, not
    # AUTO_REJECT favoring the resolved answer).
    governing_blockers = current_application_blockers(conn, workspace_id, new_fit_artifact["id"])
    eligibility_blockers = [b for b in governing_blockers if b["subject_key"] == "gate:eligibility"]
    assert eligibility_blockers
    assert eligibility_blockers[0]["status"] == "open"
    conn.close()


# ---------------------------------------------------------------------------
# Scenario 13: resolving a blocker alone (no resume call) changes nothing
# governing -- resolve records history; only resume recomputes state.
# ---------------------------------------------------------------------------


def test_resolving_blocker_without_resume_does_not_change_governing_state(
    tmp_path, webapp_profile_root,
):
    """Establish a Job Fit artifact with a governing REQUIRE_USER blocker/
    policy decision, persist a valid resolution via
    resolve_application_blocker, and deliberately never call
    resume_job_fit_after_resolution. Prove the answer alone does not:

      - generate a new job_fit_result artifact (get_current_artifact for
        the workspace's job_fit_result must be byte-identical, same id
        and same content_id, before and after the resolve call);
      - replace/supersede the existing governing policy_decisions row;
      - close, resolve, or replace the existing governing
        application_blockers row's status as OBSERVED by
        current_application_blockers (the blocker's own row transitions
        open->resolved as an ATTRIBUTE of having been answered -- Phase 4B
        behavior, unchanged -- but it remains the SAME governing row tied
        to the SAME source_artifact_id, never superseded/replaced by a
        new one, and no NEW block is created);
      - change derive_workspace_policy_state's derived result.

    Then, for contrast, invoke resume_job_fit_after_resolution and prove
    THAT is what actually performs the recomputation/state transition --
    demonstrating the intended separation of responsibilities: resolve
    records user evidence/history, resume consumes it and recomputes
    state (spec Sec11 step 3, step 10).
    """
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    original_fit_artifact = _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _eligibility_blocker(conn, workspace_id)

    decisions_before = current_policy_decisions(conn, workspace_id, original_fit_artifact["id"])
    blockers_before = current_application_blockers(conn, workspace_id, original_fit_artifact["id"])
    state_before = derive_workspace_policy_state(decisions_before)
    assert state_before == "BLOCKED_FOR_USER"
    eligibility_decision_before = next(
        d for d in decisions_before if d["subject_key"] == "gate:eligibility"
    )
    assert eligibility_decision_before["outcome"] == "REQUIRE_USER"

    # Persist a valid resolution -- but deliberately do NOT call
    # resume_job_fit_after_resolution.
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="APPLICATION_ONLY", resolved_by="user_1",
    )

    # 1. No new job_fit_result artifact was generated.
    current_fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    assert current_fit_artifact["id"] == original_fit_artifact["id"]
    assert current_fit_artifact["content_id"] == original_fit_artifact["content_id"]

    # 2. The governing policy decision for gate:eligibility, tied to the
    # SAME (still-current) source artifact, is completely unchanged.
    decisions_after = current_policy_decisions(conn, workspace_id, original_fit_artifact["id"])
    assert decisions_after == decisions_before
    eligibility_decision_after = next(
        d for d in decisions_after if d["subject_key"] == "gate:eligibility"
    )
    assert eligibility_decision_after["outcome"] == "REQUIRE_USER"
    assert eligibility_decision_after["id"] == eligibility_decision_before["id"]

    # 3. No NEW governing blocker was created for gate:eligibility -- there
    # is still exactly one, tied to the same source artifact (its status
    # legitimately flips open->resolved as an attribute of having been
    # answered, per Phase 4B's existing, unchanged resolve_application_
    # blocker contract -- but it is the SAME row, never superseded/
    # replaced, and current_application_blockers still returns exactly
    # one entry for this subject on this artifact).
    blockers_after = current_application_blockers(conn, workspace_id, original_fit_artifact["id"])
    eligibility_blockers_after = [
        b for b in blockers_after if b["subject_key"] == "gate:eligibility"
    ]
    assert len(eligibility_blockers_after) == 1
    assert eligibility_blockers_after[0]["id"] == blocker["id"]
    assert eligibility_blockers_after[0]["status"] == "resolved"
    assert eligibility_blockers_after[0]["source_artifact_id"] == original_fit_artifact["id"]

    # 4. derive_workspace_policy_state over the (still-current, still
    # unrecomputed) governing decisions is completely unchanged.
    state_after = derive_workspace_policy_state(decisions_after)
    assert state_after == state_before == "BLOCKED_FOR_USER"

    # Contrast: invoking resume IS what performs the recomputation/state
    # transition -- proving the two responsibilities are genuinely
    # separate, not that resume is inert too. Uses the same
    # answer-reactive adapter Task 11's own tests use (an empty/canned
    # adapter would propose nothing for eligibility at all, which would
    # merely reflect "no evidence supplied" rather than demonstrating that
    # resume is what performs recomputation once the resolved answer IS
    # actually consumed and cited).
    result = resume_job_fit_after_resolution(
        conn, workspace_id, _sponsorship_adapter(conn, blocker["id"]),
        request_id="req-fit-2", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    new_fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    assert new_fit_artifact["id"] != original_fit_artifact["id"]
    assert result["workflow_state"] == "PROCEEDING"
    conn.close()
