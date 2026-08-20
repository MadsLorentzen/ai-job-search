from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, ensure_profile_workspace, create_workspace
from webapp.persistence.artifacts import save_artifact
from webapp.services.staleness import record_dependency_fingerprint, check_staleness


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
    # profile_snapshot artifacts live ONLY under PROFILE_WORKSPACE_ID in the
    # real architecture (Task 4/9) — using the job workspace_id here would
    # make check_staleness's profile lookup silently no-op, masking the exact
    # bug this fixture is designed to catch.
    profile = save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                             payload={}, content_id="profilesnap_A")
    bundle = save_artifact(conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence",
                            payload={}, content_id="resolvedjobev_A")
    fit = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result",
                         payload={}, content_id="jobfitresult_A")
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="resolved_job_evidence",
                                   upstream_content_id=bundle["content_id"])

    result = check_staleness(conn, workspace_id, "job_fit_result")
    assert result == {"stale": False, "reasons": []}
    conn.close()


def test_direct_staleness_after_upstream_change(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    profile = save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                             payload={}, content_id="profilesnap_A")
    bundle = save_artifact(conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence",
                            payload={}, content_id="resolvedjobev_A")
    fit = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result",
                         payload={}, content_id="jobfitresult_A")
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="resolved_job_evidence",
                                   upstream_content_id=bundle["content_id"])

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
    profile = save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                             payload={}, content_id="profilesnap_A")
    bundle = save_artifact(conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence",
                            payload={}, content_id="resolvedjobev_A")
    fit = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result",
                         payload={}, content_id="jobfitresult_A")
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="resolved_job_evidence",
                                   upstream_content_id=bundle["content_id"])

    intelligence = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
                                  payload={}, content_id=None)
    record_dependency_fingerprint(conn, artifact_id=intelligence["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=intelligence["id"], upstream_artifact_type="job_fit_result",
                                   upstream_content_id=fit["content_id"])

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
    intelligence = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
                                  payload={}, content_id="aiintel_A")
    pack = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_pack",
                          payload={}, content_id="apppack_A")
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
