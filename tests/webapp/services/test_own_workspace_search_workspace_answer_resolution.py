"""Fail-first regression tests for a review-driven correction to Tasks 5/6/8
(committed d1f5d43, 375bf05, b2580ec).

The bug (confirmed by direct code inspection): resolved_blocker_answers.py's
build_resolved_blocker_answers_payload only accepted tier-1 (this workspace's
own effective answer) when its answer_scope was "APPLICATION_ONLY" or
"CANDIDATE_FACT" -- excluding the third valid scope, "SEARCH_WORKSPACE". A
workspace's own SEARCH_WORKSPACE-scoped answer to its own blocker fell
through to tier 2 (find_semantic_subject_match), whose SQL query did not
exclude the current workspace's own row, so it could match and return the
current workspace's own resolution mislabeled as matched_scope_source =
"SEARCH_WORKSPACE" (a genuine sibling's answer). Downstream,
validate_resolved_answer_citation then validated the citation via the
weaker cross-workspace semantic-subject-equality rule instead of the
strictly stronger exact-subject_key rule that should apply to one's own
blocker -- and could wrongly REJECT a citation that is actually a trivial
exact match, whenever the gate's own text doesn't classify to any semantic
subject at all.

Three fixes close this:
  A. webapp/services/resolved_blocker_answers.py's tier-1 check now accepts
     all three answer_scope values for the workspace's own effective answer
     (resolution is not None is sufficient -- tier 1 is ALREADY exclusively
     "this workspace's own answer," by construction of same_subject_blockers
     over list_application_blockers(conn, workspace_id)).
  B. webapp/services/decision_policy.py's find_semantic_subject_match SQL
     now excludes the current workspace's own row (AND r.workspace_id != ?),
     as defense-in-depth: the function's docstring says it is "the ONLY
     cross-application answer lookup" and must be structurally incapable of
     returning the current workspace's own row, not merely incidentally
     prevented from doing so by tier-1 ordering in its one current caller.
  C. (Discovered while writing/running this test, NOT assumed up front --
     see the second test below.) Fix A alone is insufficient:
     matched_scope_source at tier 1 echoes the resolution's own
     answer_scope verbatim (an already-tested, already-passing contract --
     see test_own_workspace_candidate_fact_answer_is_included), so a
     tier-1 (own-workspace) entry CAN legitimately carry
     matched_scope_source == "SEARCH_WORKSPACE" whenever the user chose
     that scope for their own application's own answer.
     validate_resolved_answer_citation's own/cross-workspace branch was
     keyed on matched_scope_source alone, so it would misroute exactly
     this case to the weaker semantic-subject branch and wrongly reject a
     trivial exact match. Fixed by adding "source_workspace_id" to each
     bundle entry (webapp/services/resolved_blocker_answers.py's
     _bundle_entry) and having validate_resolved_answer_citation
     (product/semantic_job_fit.py) branch on
     entry["source_workspace_id"] == bundle["workspace_id"] instead of on
     matched_scope_source.
"""

from __future__ import annotations

from webapp.persistence.application_blockers import resolve_application_blocker
from webapp.persistence.artifacts import get_current_artifact
from webapp.services.decision_policy import (
    current_application_blockers,
    find_semantic_subject_match,
)
from webapp.services.resolved_blocker_answers import build_resolved_blocker_answers_payload
from product.semantic_job_fit import validate_resolved_answer_citation

from tests.webapp.services.test_answer_applicability import (
    _link_to_search_workspace,
)
from tests.webapp.services.test_application_blockers import (
    EMPLOYER_ATTESTATION_JOB_SNAPSHOT,
    SPONSORSHIP_STATUS_JOB_SNAPSHOT,
    _run_fit,
    _workspace,
)

# Matches _STABLE_FACT_PATTERNS (>=1 stable-fact family, allowing
# SEARCH_WORKSPACE/CANDIDATE_FACT scopes) but matches TWO registry
# families at once ("right to work" and "driving licence"), so
# classify_semantic_subject deliberately returns None (spec §3 rule 3:
# multi-fact requirement text fails restrictive). This is the fixture
# needed to make the "before fix" failure unambiguous: a naive test using
# SPONSORSHIP_STATUS_JOB_SNAPSHOT would have target_semantic_subject_key
# happen to equal the entry's semantic_subject_key even via the (wrong)
# semantic-subject branch, masking the bug.
from tests.webapp.services.test_application_blockers import EMPTY_JOB_SNAPSHOT

MULTI_FACT_NO_SEMANTIC_SUBJECT_JOB_SNAPSHOT = {
    **EMPTY_JOB_SNAPSHOT,
    "eligibility_requirements": [
        {
            "id": "jobev_elig_multi_1",
            "text": "Must have the right to work in the UK and hold a valid driving licence.",
            "kind": "required",
        },
    ],
}


def _get_eligibility_blocker(conn, workspace_id):
    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    return next(
        b for b in current_application_blockers(conn, workspace_id, fit_artifact["id"])
        if b["subject_key"] == "gate:eligibility"
    )


def test_own_workspace_search_workspace_answer_validates_via_exact_subject_key(
    tmp_path, webapp_profile_root,
):
    """Core bug reproduction, variant 1 (honest-scope, semantic subject
    present): a workspace answers its own blocker with
    answer_scope="SEARCH_WORKSPACE" and no sibling exists. The bundle entry
    must reflect this is the workspace's OWN answer (matched_scope_source
    == "SEARCH_WORKSPACE" is fine -- that's the honest scope value) but
    validate_resolved_answer_citation must accept it via the strong
    exact-subject_key rule when cited by the exact gate that produced it.

    Before the fix: tier 1 excludes SEARCH_WORKSPACE, so the workspace's own
    answer falls to tier 2 (find_semantic_subject_match), whose SQL has no
    "AND r.workspace_id != ?" guard -- with no real sibling and no
    application_workspace_origins row at all, get_search_workspace_for_
    application returns None, so find_semantic_subject_match returns None
    immediately (short-circuits before ever running the SQL) and the entry
    is MISSING from the bundle entirely. This test's assertion on
    payload["answers"] length captures that failure unambiguously.
    """

    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT,
    )
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _get_eligibility_blocker(conn, workspace_id)
    resolution = resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="SEARCH_WORKSPACE", resolved_by="user_1",
    )

    payload = build_resolved_blocker_answers_payload(conn, workspace_id)
    assert len(payload["answers"]) == 1
    entry = payload["answers"][0]
    assert entry["resolution_id"] == resolution["id"]
    assert entry["matched_scope_source"] == "SEARCH_WORKSPACE"  # honest scope value

    # The own-workspace case must validate via the strong exact-match rule,
    # not the weaker semantic-subject rule -- prove it by citing with a
    # target_semantic_subject_key of None (which would fail the
    # SEARCH_WORKSPACE cross-application branch, but must not matter for a
    # genuinely own-workspace entry once matched_scope_source correctly
    # reflects "own workspace" -- see variant 2 below for the unambiguous
    # case; this variant demonstrates the length/entry-shape failure).
    assert validate_resolved_answer_citation(
        resolution["id"], payload,
        blocker_type="gate_flag", subject_key="gate:eligibility",
        target_semantic_subject_key="work_authorization.sponsorship_required",
        target_job_evidence_ids=["jobev_elig_spons_1"],
    ) is True
    conn.close()


def test_own_workspace_search_workspace_answer_with_no_semantic_subject_validates(
    tmp_path, webapp_profile_root,
):
    """Core bug reproduction, variant 2 (unambiguous): the gate's own
    requirement text classifies to NO semantic subject at all (multi-fact
    text, spec §3 rule 3), so target_semantic_subject_key is None. This
    forces validate_resolved_answer_citation's SEARCH_WORKSPACE branch to
    return False unconditionally (its own rule: `if
    target_semantic_subject_key is None: return False`) -- so if the bundle
    ever mislabels this own-workspace answer's matched_scope_source as
    "SEARCH_WORKSPACE" via the tier-2 cross-workspace path, the citation is
    wrongly rejected even though it is a trivial exact match on the exact
    same blocker.

    Before fix A: tier 1 excludes SEARCH_WORKSPACE scope, so this workspace's
    own answer is invisible to tier 1. Tier 2 (find_semantic_subject_match)
    is then tried with semantic_subject_key=None (the blocker's own
    semantic_subject_key, since multi-fact text classifies to None) --
    find_semantic_subject_match returns None immediately for a None key, so
    the bundle ends up with ZERO entries for this subject. Fails at the
    `len(payload["answers"]) == 1` assertion.

    After fix A alone (without fix C): tier 1 accepts the SEARCH_WORKSPACE-
    scoped own-workspace resolution, so the entry appears with
    matched_scope_source == "SEARCH_WORKSPACE" -- the honest answer_scope
    value, but ALSO the same string tier 2 uses for a genuine sibling.
    validate_resolved_answer_citation, prior to fix C, branched on
    matched_scope_source alone, so it would route this entry to the (wrong)
    cross-application semantic-subject branch, see target_semantic_subject_
    key is None, and wrongly return False -- an incorrect REJECT of a
    trivial exact match. This confirmed the prompt's anticipated risk was
    real, not hypothetical: fix A alone was NOT sufficient.

    After fix C: validate_resolved_answer_citation branches on
    entry["source_workspace_id"] == bundle["workspace_id"] instead of on
    matched_scope_source, correctly recognizing this as an own-workspace
    entry regardless of which answer_scope value it carries, and validates
    it via the strong exact-subject_key rule.
    """

    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MULTI_FACT_NO_SEMANTIC_SUBJECT_JOB_SNAPSHOT,
    )
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _get_eligibility_blocker(conn, workspace_id)
    assert blocker["semantic_subject_key"] is None  # sanity: multi-fact -> None
    assert "SEARCH_WORKSPACE" in blocker["allowed_scopes"]  # sanity: still a stable-fact gate

    resolution = resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="SEARCH_WORKSPACE", resolved_by="user_1",
    )

    payload = build_resolved_blocker_answers_payload(conn, workspace_id)
    assert len(payload["answers"]) == 1
    entry = payload["answers"][0]
    assert entry["resolution_id"] == resolution["id"]
    assert entry["matched_scope_source"] == "SEARCH_WORKSPACE"  # honest answer_scope echo
    assert entry["source_workspace_id"] == workspace_id  # the real own-workspace signal

    # The exact gate that produced this answer cites it. Its own target
    # semantic subject is None (multi-fact text). Exact subject_key match
    # must still succeed -- this is the assertion that fails before fix A
    # (entry never lands in the bundle at all) and, without fix C, fails
    # again for a different reason (misrouted to the semantic-subject
    # branch via matched_scope_source alone).
    assert validate_resolved_answer_citation(
        resolution["id"], payload,
        blocker_type="gate_flag", subject_key="gate:eligibility",
        target_semantic_subject_key=None,
        target_job_evidence_ids=["jobev_elig_multi_1"],
    ) is True
    conn.close()


def test_find_semantic_subject_match_excludes_current_workspace_own_row(
    tmp_path, webapp_profile_root,
):
    """Defense-in-depth for find_semantic_subject_match (fix B): workspace X
    has its own SEARCH_WORKSPACE-scoped resolution matching semantic subject
    K, and no other sibling workspace has one. find_semantic_subject_match
    must return None -- not X's own row -- because this function is
    documented as "the ONLY cross-application answer lookup" and must never
    surface the current workspace's own row, regardless of tier-1 ordering
    in its one current caller.

    Before the SQL fix: the query has no "AND r.workspace_id != ?" clause,
    so it wrongly matches and returns X's own SEARCH_WORKSPACE row.
    """

    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT,
    )
    _link_to_search_workspace(
        conn, workspace_id, search_workspace_id="search_solo", suffix="solo",
    )
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _get_eligibility_blocker(conn, workspace_id)
    resolve_application_blocker(
        conn, blocker_id=blocker["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="SEARCH_WORKSPACE", resolved_by="user_1",
    )

    match = find_semantic_subject_match(
        conn, workspace_id=workspace_id,
        semantic_subject_key="work_authorization.sponsorship_required",
    )
    assert match is None
    conn.close()


def test_employer_attestation_gate_cannot_use_search_workspace_scope(
    tmp_path, webapp_profile_root,
):
    """Sanity/documentation check (not part of the core bug fix): an
    attestation-framed gate's allowed_scopes stays APPLICATION_ONLY-only,
    confirming the multi-fact fixture above is a genuinely different case
    (stable-fact-shaped, so SEARCH_WORKSPACE is legal) from the
    attestation case (never stable-fact-shaped)."""

    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=EMPLOYER_ATTESTATION_JOB_SNAPSHOT,
    )
    _run_fit(conn, workspace_id, tmp_path, request_id="req-fit-1")
    blocker = _get_eligibility_blocker(conn, workspace_id)
    assert blocker["allowed_scopes"] == ["APPLICATION_ONLY"]
    conn.close()
