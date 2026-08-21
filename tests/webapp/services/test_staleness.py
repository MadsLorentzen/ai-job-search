from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, ensure_profile_workspace, create_workspace
import pytest

from webapp.persistence.artifacts import save_artifact
from webapp.services.staleness import record_dependency_fingerprint, check_staleness
from tests.webapp.services.test_application_pack import _seed


def _setup(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    # The global profile workspace row must exist before any profile_snapshot
    # artifact can be saved under PROFILE_WORKSPACE_ID (artifacts.workspace_id
    # has a FOREIGN KEY REFERENCES workspaces(id), enforced via PRAGMA
    # foreign_keys = ON in webapp.persistence.db.connect).
    ensure_profile_workspace(conn)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    return conn, ws["id"]


def test_fresh_artifact_with_matching_fingerprint_is_not_stale(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    _, _, fit, _ = _seed(conn, workspace_id)

    result = check_staleness(conn, workspace_id, "job_fit_result")
    assert result == {"stale": False, "reasons": []}
    conn.close()


def test_direct_staleness_after_upstream_change(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    _seed(conn, workspace_id)

    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                   payload={"changed": True}, content_id="profilesnap_B")

    result = check_staleness(conn, workspace_id, "job_fit_result")
    assert result["stale"] is True
    assert any("profile_snapshot" in reason for reason in result["reasons"])
    conn.close()


def test_check_staleness_reads_profile_snapshot_from_global_workspace_not_job_workspace(tmp_path):
    # Direct regression test for the bug where check_staleness looked up
    # profile_snapshot under the caller's workspace_id instead of the global
    # profile workspace, silently no-oping the entire profile-staleness path.
    conn, workspace_id = _setup(tmp_path)
    profile = save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                             payload={}, content_id="profilesnap_A")
    result = check_staleness(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    assert result == {"stale": False, "reasons": []}
    # calling check_staleness for "profile_snapshot" with a job workspace_id
    # must resolve to the SAME global artifact, not a different (nonexistent)
    # one — proving the routing fix, not just that the API doesn't crash.
    assert check_staleness(conn, workspace_id, "profile_snapshot") == result
    conn.close()


def test_transitive_staleness_propagates_downstream(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    _, _, fit, intelligence = _seed(conn, workspace_id)

    # profile changes; job_fit_result is directly stale, and even though nobody
    # has rerun job_fit yet (so job_fit_result's content_id in the DB is still
    # "jobfitresult_A", matching what application_intelligence_result recorded),
    # application_intelligence_result must be reported stale TRANSITIVELY because
    # its direct dependency (job_fit_result) is itself stale.
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                   payload={"changed": True}, content_id="profilesnap_B")

    fit_staleness = check_staleness(conn, workspace_id, "job_fit_result")
    assert fit_staleness["stale"] is True

    intelligence_staleness = check_staleness(conn, workspace_id, "application_intelligence_result")
    assert intelligence_staleness["stale"] is True
    assert any("job_fit_result" in reason for reason in intelligence_staleness["reasons"])
    conn.close()


def test_application_pack_staleness_is_covered(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    _, _, fit, intelligence = _seed(conn, workspace_id)
    pack = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_pack",
                          payload={}, content_id="apppack_A")
    record_dependency_fingerprint(conn, artifact_id=pack["id"], upstream_artifact_type="job_fit_result",
                                   upstream_content_id=fit["content_id"])
    record_dependency_fingerprint(conn, artifact_id=pack["id"], upstream_artifact_type="application_intelligence_result",
                                   upstream_content_id=intelligence["content_id"])

    assert check_staleness(conn, workspace_id, "application_pack")["stale"] is False

    save_artifact(conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
                   payload={"changed": True}, content_id="aiintel_B")

    assert check_staleness(conn, workspace_id, "application_pack")["stale"] is True
    conn.close()


def test_no_fingerprints_recorded_means_not_stale(tmp_path):
    # An artifact type with no recorded dependency fingerprints (e.g. because it
    # has no upstream, like profile_snapshot itself) is never stale.
    conn, workspace_id = _setup(tmp_path)
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                   payload={}, content_id="profilesnap_A")
    assert check_staleness(conn, PROFILE_WORKSPACE_ID, "profile_snapshot") == {"stale": False, "reasons": []}
    conn.close()


def test_missing_current_artifact_is_not_stale(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    assert check_staleness(conn, workspace_id, "job_fit_result") == {"stale": False, "reasons": []}
    conn.close()


@pytest.mark.parametrize(
    ("artifact_type", "upstream_type"),
    [
        ("job_fit_result", "resolved_job_evidence"),
        ("resolved_job_evidence", "job_understanding_result"),
        ("job_fit_request", "server:evaluation_policy"),
        ("job_fit_request", "server:semantic_fit_policy"),
        ("application_intelligence_request", "server:application_intelligence_policy"),
        ("application_intelligence_request", "server:application_intelligence_generation_contract"),
    ],
)
def test_missing_required_fingerprint_fails_closed_at_multiple_depths(
    tmp_path, artifact_type, upstream_type,
):
    conn, workspace_id = _setup(tmp_path)
    _seed(conn, workspace_id)
    artifact = conn.execute(
        "SELECT id FROM artifacts WHERE workspace_id=? AND artifact_type=?",
        (workspace_id, artifact_type),
    ).fetchone()
    conn.execute(
        "DELETE FROM dependency_fingerprints WHERE artifact_id=? AND upstream_artifact_type=?",
        (artifact["id"], upstream_type),
    )
    conn.commit()
    result = check_staleness(conn, workspace_id, "application_intelligence_result")
    assert result["stale"] is True
    assert "required fingerprint" in "; ".join(result["reasons"])


def test_missing_required_upstream_current_pointer_fails_closed(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    _seed(conn, workspace_id)
    conn.execute(
        "DELETE FROM current_artifacts WHERE workspace_id=? AND artifact_type='resolved_job_evidence'",
        (workspace_id,),
    )
    conn.commit()
    result = check_staleness(conn, workspace_id, "job_fit_result")
    assert result["stale"] is True
    assert "required upstream artifact 'resolved_job_evidence' is missing" in result["reasons"]


@pytest.mark.parametrize(
    ("identity_name", "expected_input"),
    [
        ("evaluation_policy_identity", "server:evaluation_policy"),
        ("semantic_fit_policy_identity", "server:semantic_fit_policy"),
        ("semantic_proposer_policy_identity", "server:semantic_proposer_policy"),
        ("application_intelligence_policy_identity", "server:application_intelligence_policy"),
        (
            "application_intelligence_generation_contract_identity",
            "server:application_intelligence_generation_contract",
        ),
    ],
)
def test_mutable_server_policy_identity_change_stales_downstream(
    tmp_path, monkeypatch, identity_name, expected_input,
):
    from webapp.services import input_identity

    conn, workspace_id = _setup(tmp_path)
    _seed(conn, workspace_id)
    monkeypatch.setattr(input_identity, identity_name, lambda: "changed_policy_identity")
    result = check_staleness(conn, workspace_id, "application_intelligence_result")
    assert result["stale"] is True
    assert expected_input in "; ".join(result["reasons"])


def test_promoted_semantic_proposal_request_stales_old_fit_result(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    _seed(conn, workspace_id)
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_request",
        payload={"active_extensions": [], "semantic_proposals": {"matches": [{"proposal_id": "new"}]}},
        content_id="jobfitreq_new_proposals",
    )
    result = check_staleness(conn, workspace_id, "job_fit_result")
    assert result["stale"] is True
    assert "job_fit_request changed" in "; ".join(result["reasons"])


def test_application_intelligence_request_dependency_types_include_generation_contract():
    from webapp.services.staleness import DEPENDENCY_TYPES
    assert (
        "server:application_intelligence_generation_contract"
        in DEPENDENCY_TYPES["application_intelligence_request"]
    )
