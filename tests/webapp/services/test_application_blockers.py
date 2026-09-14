"""Phase 4B: durable blocker/resolution persistence and scoped-answer contract.

Covers webapp/persistence/application_blockers.py and the blocker-related
functions in webapp/services/decision_policy.py. No UI, no downstream
resume -- Phase 4B only needs to answer "are there any current unresolved
governing blockers?" and persist a scoped answer when one is resolved.
"""

from __future__ import annotations

import pytest

from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.application_blockers import (
    list_application_blockers,
    list_blocker_resolutions,
)
from webapp.persistence.application_identity import record_application_origin
from webapp.persistence.db import connect, init_db
from webapp.persistence.workspaces import create_workspace
from webapp.services.decision_policy import (
    current_application_blockers,
    find_reusable_answer,
    has_unresolved_governing_blockers,
    resolve_blocker,
    validate_answer_scope,
)
from webapp.services.http_api import fit_job
from webapp.services.pipeline import refresh_profile
from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter


EMPTY_JOB_SNAPSHOT = {
    "schema_version": "job-posting-snapshot.v0", "job_id": "jobsrc_test0000000000",
    "source": "manual", "captured_at": "2026-08-18T00:00:00Z",
    "company": "Acme", "title": "Backend Engineer",
    "requirements": [], "responsibilities": [], "language_requirements": [],
    "eligibility_requirements": [], "logistics_requirements": [],
    "metadata": {"ingestion": {}},
}

MATERIAL_ELIGIBILITY_JOB_SNAPSHOT = {
    **EMPTY_JOB_SNAPSHOT,
    "eligibility_requirements": [
        {"id": "jobev_elig_1", "text": "Must have the right to work in the UK.", "kind": "required"},
    ],
}

TWO_MATERIAL_GATES_JOB_SNAPSHOT = {
    **EMPTY_JOB_SNAPSHOT,
    "eligibility_requirements": [
        {"id": "jobev_elig_1", "text": "Must have the right to work in the UK.", "kind": "required"},
    ],
    "language_requirements": [
        {"id": "jobev_lang_1", "text": "Fluent German is required.", "kind": "required"},
    ],
}

# A dimension blocker (subject_key "dimension:*") is not in
# _APPLICATION_ONLY_SUBJECT_KEYS, so it defaults to the full scope set --
# used by tests exercising SEARCH_WORKSPACE/CANDIDATE_FACT, which the
# eligibility gate blocker deliberately refuses.
UNMATCHED_TECHNICAL_SKILL_JOB_SNAPSHOT = {
    **EMPTY_JOB_SNAPSHOT,
    "requirements": [
        {"id": "jobev_req_1", "text": "Python required.", "kind": "required"},
    ],
}


def _workspace(tmp_path, profile_root, *, job_snapshot=None):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    refresh_profile(conn, root=str(profile_root))
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    save_artifact(
        conn, workspace_id=ws["id"], artifact_type="job_posting_snapshot",
        payload=job_snapshot or EMPTY_JOB_SNAPSHOT, content_id="jobsnap_test",
    )
    return conn, ws["id"]


def _empty_adapter():
    return FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})


def _run_fit(conn, workspace_id, tmp_path, *, request_id="req_1"):
    return fit_job(
        conn, workspace_id, _empty_adapter(), request_id=request_id,
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )


def test_one_require_user_decision_creates_one_blocker(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blockers = current_application_blockers(conn, workspace_id, artifact["id"])
    open_blockers = [b for b in blockers if b["status"] == "open"]
    assert len(open_blockers) == 1
    assert open_blockers[0]["subject_key"] == "gate:eligibility"
    assert open_blockers[0]["policy_decision_id"]
    conn.close()


def test_retry_is_idempotent_no_duplicate_blocker(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    from webapp.services.decision_policy import execute_job_fit_policy

    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=artifact)
    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=artifact)

    blockers = list_application_blockers(conn, workspace_id, source_artifact_id=artifact["id"])
    assert len(blockers) == 1
    conn.close()


def test_two_different_blockers_for_one_application_remain_independent(
    tmp_path, webapp_profile_root
):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=TWO_MATERIAL_GATES_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blockers = current_application_blockers(conn, workspace_id, artifact["id"])
    open_blockers = {b["subject_key"]: b for b in blockers if b["status"] == "open"}
    assert set(open_blockers) == {"gate:eligibility", "gate:language"}
    assert open_blockers["gate:eligibility"]["id"] != open_blockers["gate:language"]["id"]
    conn.close()


def test_blocker_from_stale_artifact_no_longer_governs(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    first = _run_fit(conn, workspace_id, tmp_path, request_id="req_1")
    assert has_unresolved_governing_blockers(conn, workspace_id, first["id"])

    # Rerun against a posting with no eligibility requirement -- new
    # artifact, non-blocking.
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
        payload=EMPTY_JOB_SNAPSHOT, content_id="jobsnap_rerun",
    )
    second = _run_fit(conn, workspace_id, tmp_path, request_id="req_2")
    assert second["id"] != first["id"]

    assert not has_unresolved_governing_blockers(conn, workspace_id, second["id"])
    conn.close()


def test_old_blocker_remains_queryable_historically(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    first = _run_fit(conn, workspace_id, tmp_path, request_id="req_1")
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
        payload=EMPTY_JOB_SNAPSHOT, content_id="jobsnap_rerun",
    )
    _run_fit(conn, workspace_id, tmp_path, request_id="req_2")

    historical = list_application_blockers(conn, workspace_id, source_artifact_id=first["id"])
    assert len(historical) == 1
    assert historical[0]["subject_key"] == "gate:eligibility"
    conn.close()


def test_resolve_blocker_creates_separate_immutable_resolution(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blocker = current_application_blockers(conn, workspace_id, artifact["id"])[0]

    resolution = resolve_blocker(
        conn, workspace_id=workspace_id, blocker_id=blocker["id"],
        answer_value="Yes, I have the right to work in the UK.",
        answer_scope="APPLICATION_ONLY", resolved_by="human",
    )
    assert resolution["blocker_id"] == blocker["id"]
    assert resolution["answer_value"] == "Yes, I have the right to work in the UK."
    assert resolution["answer_scope"] == "APPLICATION_ONLY"

    updated_blocker = current_application_blockers(conn, workspace_id, artifact["id"])[0]
    assert updated_blocker["status"] == "resolved"
    assert updated_blocker["resolved_at"] is not None
    conn.close()


def test_resolution_does_not_mutate_originating_policy_decision(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blocker = current_application_blockers(conn, workspace_id, artifact["id"])[0]

    from webapp.persistence.policy_decisions import get_policy_decision

    before = get_policy_decision(conn, blocker["policy_decision_id"])

    resolve_blocker(
        conn, workspace_id=workspace_id, blocker_id=blocker["id"],
        answer_value="yes", answer_scope="APPLICATION_ONLY", resolved_by="human",
    )

    after = get_policy_decision(conn, blocker["policy_decision_id"])
    assert before == after
    assert after["outcome"] == "REQUIRE_USER"
    conn.close()


def test_unresolved_second_blocker_keeps_workspace_blocked(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=TWO_MATERIAL_GATES_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blockers = {
        b["subject_key"]: b
        for b in current_application_blockers(conn, workspace_id, artifact["id"])
    }
    resolve_blocker(
        conn, workspace_id=workspace_id, blocker_id=blockers["gate:eligibility"]["id"],
        answer_value="yes", answer_scope="APPLICATION_ONLY", resolved_by="human",
    )
    # Only the eligibility blocker resolved -- language blocker untouched.
    assert has_unresolved_governing_blockers(conn, workspace_id, artifact["id"])
    remaining_open = [
        b for b in current_application_blockers(conn, workspace_id, artifact["id"])
        if b["status"] == "open"
    ]
    assert len(remaining_open) == 1
    assert remaining_open[0]["subject_key"] == "gate:language"
    conn.close()


def test_resolving_one_blocker_does_not_resolve_unrelated_blocker(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=TWO_MATERIAL_GATES_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blockers = {
        b["subject_key"]: b
        for b in current_application_blockers(conn, workspace_id, artifact["id"])
    }
    resolve_blocker(
        conn, workspace_id=workspace_id, blocker_id=blockers["gate:eligibility"]["id"],
        answer_value="yes", answer_scope="APPLICATION_ONLY", resolved_by="human",
    )
    language_blocker = next(
        b for b in current_application_blockers(conn, workspace_id, artifact["id"])
        if b["subject_key"] == "gate:language"
    )
    assert language_blocker["status"] == "open"
    resolutions = list_blocker_resolutions(conn, workspace_id)
    assert len(resolutions) == 1
    conn.close()


def test_application_only_scope_works_for_manual_workspace(tmp_path, webapp_profile_root):
    """Subsea 7's own scenario: a manually-created workspace with no
    search-workspace origin. APPLICATION_ONLY must always be valid."""
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    validate_answer_scope(conn, workspace_id=workspace_id, answer_scope="APPLICATION_ONLY")
    conn.close()


def test_search_workspace_scope_rejected_for_manual_workspace_with_no_origin(
    tmp_path, webapp_profile_root
):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    with pytest.raises(ValueError, match="no search-workspace origin"):
        validate_answer_scope(conn, workspace_id=workspace_id, answer_scope="SEARCH_WORKSPACE")
    conn.close()


def test_search_workspace_scope_accepted_for_genuinely_linked_search_workspace(
    tmp_path, webapp_profile_root
):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    # search_default is the deterministic default search workspace created
    # by migration 001. discovery_candidates/discovery_occurrences are
    # real foreign keys application_workspace_origins enforces -- minimal
    # valid rows, not fabricated IDs, so this exercises the genuine
    # constraint rather than working around it.
    conn.execute(
        "INSERT INTO discovery_candidates "
        "(id, search_workspace_id, company, title, location, lifecycle_status, "
        "canonical_occurrence_id, promoted_workspace_id, first_seen_at, last_seen_at, updated_at) "
        "VALUES ('candidate_x', 'search_default', 'Acme', 'Backend Engineer', NULL, "
        "'promoted', 'occurrence_x', ?, 'now', 'now', 'now')",
        (workspace_id,),
    )
    conn.execute(
        "INSERT INTO discovery_occurrences "
        "(id, search_workspace_id, candidate_id, run_id, source, source_record_id, "
        "source_url, source_record_json, captured_at, created_at) "
        "VALUES ('occurrence_x', 'search_default', 'candidate_x', NULL, 'manual', NULL, "
        "NULL, '{}', 'now', 'now')"
    )
    conn.commit()
    record_application_origin(
        conn, application_workspace_id=workspace_id, search_workspace_id="search_default",
        discovery_candidate_id="candidate_x", discovery_occurrence_id="occurrence_x",
        discovery_run_id=None,
    )
    validate_answer_scope(conn, workspace_id=workspace_id, answer_scope="SEARCH_WORKSPACE")
    conn.close()


def test_candidate_fact_scope_records_explicit_scope_without_modifying_evidence_profile(
    tmp_path, webapp_profile_root
):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=UNMATCHED_TECHNICAL_SKILL_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blocker = current_application_blockers(conn, workspace_id, artifact["id"])[0]
    assert blocker["subject_key"] == "dimension:technical_skills"

    profile_before = get_current_artifact(conn, "profile", "profile_snapshot")

    resolution = resolve_blocker(
        conn, workspace_id=workspace_id, blocker_id=blocker["id"],
        answer_value="British Citizen, no restrictions.",
        answer_scope="CANDIDATE_FACT", resolved_by="human",
    )
    assert resolution["answer_scope"] == "CANDIDATE_FACT"
    # Phase 4B never promotes into the Evidence Profile automatically.
    assert resolution["promoted_evidence_id"] is None
    profile_after = get_current_artifact(conn, "profile", "profile_snapshot")
    assert profile_before["id"] == profile_after["id"]
    conn.close()


def test_restricted_blocker_refuses_disallowed_broader_scope(tmp_path, webapp_profile_root):
    """The eligibility gate is deliberately restricted to APPLICATION_ONLY
    (sensitive/legal-adjacent) -- attempting CANDIDATE_FACT must be
    refused by the blocker's own allowed_scopes, not silently accepted."""
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blocker = current_application_blockers(conn, workspace_id, artifact["id"])[0]
    assert blocker["allowed_scopes"] == ["APPLICATION_ONLY"]

    with pytest.raises(ValueError, match="not permitted"):
        resolve_blocker(
            conn, workspace_id=workspace_id, blocker_id=blocker["id"],
            answer_value="British Citizen.", answer_scope="CANDIDATE_FACT",
            resolved_by="human",
        )
    conn.close()


def test_answer_ordering_and_json_round_trip_is_stable(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blocker = current_application_blockers(conn, workspace_id, artifact["id"])[0]

    structured_answer = {"eligible": True, "notes": ["right to work", "no restrictions"]}
    resolution = resolve_blocker(
        conn, workspace_id=workspace_id, blocker_id=blocker["id"],
        answer_value=structured_answer, answer_scope="APPLICATION_ONLY", resolved_by="human",
    )
    assert resolution["answer_value"] == structured_answer
    assert resolution["answer_value"]["notes"] == ["right to work", "no restrictions"]

    refetched = list_blocker_resolutions(conn, workspace_id)[0]
    assert refetched["answer_value"] == structured_answer
    conn.close()


def test_workspace_isolation_for_blockers_and_resolutions(tmp_path, webapp_profile_root):
    conn, blocked_ws = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    other_ws = create_workspace(conn, company="Other Co", title="Other Role")
    save_artifact(
        conn, workspace_id=other_ws["id"], artifact_type="job_posting_snapshot",
        payload=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT, content_id="jobsnap_other",
    )

    artifact_a = _run_fit(conn, blocked_ws, tmp_path, request_id="req_a")
    artifact_b = fit_job(
        conn, other_ws["id"], _empty_adapter(), request_id="req_b",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )

    blockers_a = list_application_blockers(conn, blocked_ws)
    blockers_b = list_application_blockers(conn, other_ws["id"])
    assert len(blockers_a) == 1
    assert len(blockers_b) == 1
    assert blockers_a[0]["id"] != blockers_b[0]["id"]
    assert blockers_a[0]["workspace_id"] == blocked_ws
    assert blockers_b[0]["workspace_id"] == other_ws["id"]
    conn.close()


def test_find_reusable_answer_returns_none_when_nothing_recorded(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    result = find_reusable_answer(
        conn, workspace_id=workspace_id, subject_key="gate:eligibility", blocker_type="gate_flag",
    )
    assert result is None
    conn.close()


def test_find_reusable_answer_prefers_application_only_scope_first(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blocker = current_application_blockers(conn, workspace_id, artifact["id"])[0]
    resolve_blocker(
        conn, workspace_id=workspace_id, blocker_id=blocker["id"],
        answer_value="yes", answer_scope="APPLICATION_ONLY", resolved_by="human",
    )

    result = find_reusable_answer(
        conn, workspace_id=workspace_id, subject_key="gate:eligibility", blocker_type="gate_flag",
    )
    assert result is not None
    assert result["matched_scope_source"] == "APPLICATION_ONLY"
    conn.close()


def test_finding_a_reusable_answer_never_auto_applies_it(tmp_path, webapp_profile_root):
    """Phase 4B builds retrieval but never calls it automatically from any
    mutation path -- a second, independent fit_job run on a fresh
    workspace must not have its blocker silently pre-resolved just
    because an answer exists elsewhere."""
    conn, first_ws = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=UNMATCHED_TECHNICAL_SKILL_JOB_SNAPSHOT
    )
    first_artifact = _run_fit(conn, first_ws, tmp_path, request_id="req_1")
    first_blocker = current_application_blockers(conn, first_ws, first_artifact["id"])[0]
    resolve_blocker(
        conn, workspace_id=first_ws, blocker_id=first_blocker["id"],
        answer_value="yes", answer_scope="CANDIDATE_FACT", resolved_by="human",
    )

    second_ws = create_workspace(conn, company="Other Co", title="Other Role")
    save_artifact(
        conn, workspace_id=second_ws["id"], artifact_type="job_posting_snapshot",
        payload=UNMATCHED_TECHNICAL_SKILL_JOB_SNAPSHOT, content_id="jobsnap_second",
    )
    second_artifact = fit_job(
        conn, second_ws["id"], _empty_adapter(), request_id="req_2",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    second_blockers = current_application_blockers(conn, second_ws["id"], second_artifact["id"])
    assert len(second_blockers) == 1
    assert second_blockers[0]["status"] == "open"
    conn.close()


def test_no_blocker_created_for_auto_procced_or_non_blocking_outcomes(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root)
    artifact = _run_fit(conn, workspace_id, tmp_path)
    blockers = list_application_blockers(conn, workspace_id, source_artifact_id=artifact["id"])
    assert blockers == []
    conn.close()


def test_no_blocker_created_for_auto_reject(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    profile = get_current_artifact(conn, "profile", "profile_snapshot")
    claim_id = next(c["id"] for c in profile["payload"]["claims"] if c["category"] == "publications")
    canned = {
        "matches": [],
        "gates": [
            {
                "gate_id": "eligibility", "status": "FAIL",
                "reason": "Candidate lacks required eligibility.",
                "job_evidence_ids": ["jobev_elig_1"], "profile_evidence_ids": [claim_id],
            },
        ],
    }
    artifact = fit_job(
        conn, workspace_id, FakeSemanticProposalAdapter(canned_response=canned),
        request_id="req_1", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    blockers = list_application_blockers(conn, workspace_id, source_artifact_id=artifact["id"])
    assert blockers == []
    conn.close()
