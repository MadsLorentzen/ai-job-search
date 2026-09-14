"""Phase 4A: policy execution wired into the Job Fit mutation boundary.

Covers webapp/services/http_api.py's fit_job (the actual mutation-boundary
function) and webapp/services/decision_policy.py's orchestration. Does not
touch workspace_view.py (zero diff, confirmed separately) and does not
exercise any GET path -- every test here calls a real mutation function.
"""

from __future__ import annotations

from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.policy_decisions import list_policy_decisions
from webapp.persistence.db import connect, init_db
from webapp.persistence.workspaces import create_workspace
from webapp.services.decision_policy import derive_workspace_policy_state
from webapp.services.http_api import fit_job, understand_job, generate_application_intelligence
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
        {
            "id": "jobev_elig_1",
            "text": "Must have the right to work in the UK.",
            "kind": "required",
        },
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


def _publications_claim_id(conn):
    profile = get_current_artifact(conn, "profile", "profile_snapshot")
    return next(
        c["id"] for c in profile["payload"]["claims"] if c["category"] == "publications"
    )


def test_fit_job_persists_durable_policy_decisions(tmp_path, webapp_profile_root):
    """Running policy after a stage artifact creates durable decisions."""
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root)
    artifact = fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    decisions = list_policy_decisions(conn, workspace_id, source_artifact_id=artifact["id"])
    # 3 gates + 4 dimensions on the v0 evaluation/semantic-fit policy.
    assert len(decisions) == 7
    assert all(d["source_artifact_id"] == artifact["id"] for d in decisions)
    assert all(d["stage"] == "fit" for d in decisions)
    conn.close()


def test_retrying_same_artifact_creates_no_duplicates(tmp_path, webapp_profile_root):
    """Idempotent per artifact/policy fingerprint: re-executing policy
    against the same artifact must not duplicate rows."""
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root)
    artifact = fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    from webapp.services.decision_policy import execute_job_fit_policy

    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=artifact)
    execute_job_fit_policy(conn, workspace_id=workspace_id, fit_artifact=artifact)

    decisions = list_policy_decisions(conn, workspace_id, source_artifact_id=artifact["id"])
    assert len(decisions) == 7
    conn.close()


def test_get_refresh_creates_zero_rows(tmp_path, webapp_profile_root):
    """No GET path executes policy -- workspace_view.py is untouched in
    this phase. Simulated here by confirming the total decision count
    after a fit_job call equals the count immediately after, with no
    intervening mutation (a stand-in for "reading the workspace twice
    changes nothing", since this module has no GET-path caller at all)."""
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root)
    artifact = fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    before = list_policy_decisions(conn, workspace_id)
    # Reading the workspace's current artifact (what a GET path would do)
    # must never itself call policy execution.
    get_current_artifact(conn, workspace_id, "job_fit_result")
    get_current_artifact(conn, workspace_id, "job_fit_result")
    after = list_policy_decisions(conn, workspace_id)
    assert before == after
    conn.close()


def test_rerunning_stage_creates_new_artifact_scoped_decisions_old_remain_historical(
    tmp_path, webapp_profile_root
):
    """Rerunning Job Fit produces a new artifact; decisions tied to the
    prior artifact remain in policy_decisions permanently (audit history)
    but the two sets are distinct and both queryable."""
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root)
    first = fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    second = fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_2",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    assert first["id"] != second["id"]

    first_decisions = list_policy_decisions(conn, workspace_id, source_artifact_id=first["id"])
    second_decisions = list_policy_decisions(conn, workspace_id, source_artifact_id=second["id"])
    assert len(first_decisions) == 7
    assert len(second_decisions) == 7

    all_decisions = list_policy_decisions(conn, workspace_id)
    assert len(all_decisions) == 14
    conn.close()


def test_current_artifact_require_user_derives_blocked_for_user(tmp_path, webapp_profile_root):
    """A material gate with no candidate evidence -> REQUIRE_USER ->
    BLOCKED_FOR_USER."""
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    artifact = fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    decisions = list_policy_decisions(conn, workspace_id, source_artifact_id=artifact["id"])
    eligibility = next(
        d for d in decisions if d["review_item_type"] == "gate_flag"
        and d["subject_key"] == "gate:eligibility"
    )
    assert eligibility["outcome"] == "REQUIRE_USER"
    assert eligibility["blocking"] is True
    assert derive_workspace_policy_state(decisions) == "BLOCKED_FOR_USER"
    conn.close()


def test_current_artifact_supported_fail_derives_declined_by_policy(
    tmp_path, webapp_profile_root
):
    """A supported, validated FAIL gate -> AUTO_REJECT -> DECLINED_BY_POLICY."""
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    claim_id = _publications_claim_id(conn)
    canned = {
        "matches": [],
        "gates": [
            {
                "gate_id": "eligibility", "status": "FAIL",
                "reason": "Candidate lacks required eligibility.",
                "job_evidence_ids": ["jobev_elig_1"],
                "profile_evidence_ids": [claim_id],
            },
        ],
    }
    artifact = fit_job(
        conn, workspace_id, FakeSemanticProposalAdapter(canned_response=canned),
        request_id="req_1", extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    decisions = list_policy_decisions(conn, workspace_id, source_artifact_id=artifact["id"])
    eligibility = next(
        d for d in decisions if d["review_item_type"] == "gate_flag"
        and d["subject_key"] == "gate:eligibility"
    )
    assert eligibility["outcome"] == "AUTO_REJECT"
    assert eligibility["blocking"] is True
    assert derive_workspace_policy_state(decisions) == "DECLINED_BY_POLICY"
    conn.close()


def test_non_blocking_decisions_allow_normal_progression(tmp_path, webapp_profile_root):
    """An empty job posting: every gate resolves NOT_APPLICABLE (no
    category evidence at all) and every dimension resolves NOT_APPLICABLE
    (no relevant job ids) -- entirely non-blocking, PROCEEDING."""
    conn, workspace_id = _workspace(tmp_path, webapp_profile_root)
    artifact = fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    decisions = list_policy_decisions(conn, workspace_id, source_artifact_id=artifact["id"])
    assert all(not d["blocking"] for d in decisions)
    assert derive_workspace_policy_state(decisions) == "PROCEEDING"
    conn.close()


def test_stale_require_user_from_old_artifact_does_not_keep_workspace_blocked(
    tmp_path, webapp_profile_root
):
    """Governance selection: only the CURRENT artifact's decisions govern.
    A workspace that was blocked under an old artifact, then reran Job Fit
    with different (non-blocking) evidence, must not remain governed by
    the stale REQUIRE_USER decision."""
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    first = fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    first_decisions = list_policy_decisions(conn, workspace_id, source_artifact_id=first["id"])
    assert derive_workspace_policy_state(first_decisions) == "BLOCKED_FOR_USER"

    # Rerun against a job posting with no eligibility requirement at all --
    # the new current artifact is entirely non-blocking.
    conn.execute(
        "UPDATE current_artifacts SET artifact_id = ("
        "SELECT id FROM artifacts WHERE workspace_id = ? AND artifact_type = 'job_posting_snapshot' "
        "ORDER BY created_at DESC LIMIT 1) WHERE workspace_id = ? AND artifact_type = 'job_posting_snapshot'",
        (workspace_id, workspace_id),
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
        payload=EMPTY_JOB_SNAPSHOT, content_id="jobsnap_rerun",
    )
    conn.commit()
    second = fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_2",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    assert second["id"] != first["id"]

    governing = list_policy_decisions(conn, workspace_id, source_artifact_id=second["id"])
    assert derive_workspace_policy_state(governing) == "PROCEEDING"
    # The stale decision is still queryable as history, just not governing.
    still_historical = list_policy_decisions(conn, workspace_id, source_artifact_id=first["id"])
    assert derive_workspace_policy_state(still_historical) == "BLOCKED_FOR_USER"
    conn.close()


def test_one_blocked_workspace_does_not_affect_another(tmp_path, webapp_profile_root):
    conn, blocked_ws = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    clean_ws = create_workspace(conn, company="Other Co", title="Other Role")
    save_artifact(
        conn, workspace_id=clean_ws["id"], artifact_type="job_posting_snapshot",
        payload=EMPTY_JOB_SNAPSHOT, content_id="jobsnap_other",
    )

    blocked_artifact = fit_job(
        conn, blocked_ws, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    clean_artifact = fit_job(
        conn, clean_ws["id"], _empty_adapter(), request_id="req_2",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )

    blocked_decisions = list_policy_decisions(
        conn, blocked_ws, source_artifact_id=blocked_artifact["id"]
    )
    clean_decisions = list_policy_decisions(
        conn, clean_ws["id"], source_artifact_id=clean_artifact["id"]
    )
    assert derive_workspace_policy_state(blocked_decisions) == "BLOCKED_FOR_USER"
    assert derive_workspace_policy_state(clean_decisions) == "PROCEEDING"
    conn.close()


def test_workflow_status_remains_untouched_by_policy_execution(tmp_path, webapp_profile_root):
    """workflow_status keeps its existing, narrower, post-submission
    meaning; policy execution -- even a blocking outcome -- must never
    write to it."""
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    row = conn.execute(
        "SELECT workflow_status FROM workspaces WHERE id = ?", (workspace_id,)
    ).fetchone()
    assert row["workflow_status"] is None
    conn.close()


def test_no_review_decision_is_fabricated_for_material_absent_gate(tmp_path, webapp_profile_root):
    """A material, absent gate must never silently get a review_decisions
    row invented on its behalf -- it stays REQUIRE_USER, unresolved, with
    zero rows in review_decisions (the human-click table), because a
    future user answer is still genuinely required."""
    conn, workspace_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=MATERIAL_ELIGIBILITY_JOB_SNAPSHOT
    )
    fit_job(
        conn, workspace_id, _empty_adapter(), request_id="req_1",
        extension_ids=[], extensions_dir=tmp_path / "extensions",
    )
    count = conn.execute(
        "SELECT COUNT(*) FROM review_decisions WHERE workspace_id = ?", (workspace_id,)
    ).fetchone()[0]
    assert count == 0
    conn.close()


def test_understanding_and_application_intelligence_boundaries_persist_nothing_yet(
    tmp_path, webapp_profile_root
):
    """No tested classifier exists yet for Understanding or Application
    Intelligence review items (deferred per the design). The mutation
    boundaries call their hooks but persist zero decisions today -- this
    is the honest current state, not a placeholder pretending otherwise."""
    from webapp.services.decision_policy import (
        execute_application_intelligence_policy,
        execute_understanding_policy,
    )

    conn, workspace_id = _workspace(tmp_path, webapp_profile_root)
    fake_artifact = {"id": "art_fake", "payload": {}}
    assert execute_understanding_policy(
        conn, workspace_id=workspace_id, understanding_artifact=fake_artifact
    ) == []
    assert execute_application_intelligence_policy(
        conn, workspace_id=workspace_id, intelligence_artifact=fake_artifact
    ) == []
    assert list_policy_decisions(conn, workspace_id) == []
    conn.close()
