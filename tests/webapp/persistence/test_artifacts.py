from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.artifacts import (
    ARTIFACT_TYPES,
    save_artifact,
    get_current_artifact,
    get_artifact,
    list_artifact_history,
)


def _workspace(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    return conn, ws["id"]


def test_artifact_types_includes_all_three_request_types():
    assert "job_understanding_request" in ARTIFACT_TYPES
    assert "job_fit_request" in ARTIFACT_TYPES
    assert "application_intelligence_request" in ARTIFACT_TYPES
    assert len(ARTIFACT_TYPES) == len(set(ARTIFACT_TYPES)) == 10


def test_save_artifact_becomes_current(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
        payload={"claims": []}, content_id="profilesnap_abc123",
    )
    current = get_current_artifact(conn, workspace_id, "profile_snapshot")
    assert current["id"] == saved["id"]
    assert current["content_id"] == "profilesnap_abc123"
    conn.close()


def test_saving_new_artifact_supersedes_old_current(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    first = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
                           payload={"v": 1}, content_id="profilesnap_1")
    second = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
                            payload={"v": 2}, content_id="profilesnap_2")
    current = get_current_artifact(conn, workspace_id, "profile_snapshot")
    assert current["id"] == second["id"] != first["id"]
    conn.close()


def test_old_artifact_still_retrievable_by_id(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    first = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
                           payload={"v": 1}, content_id="profilesnap_1")
    save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
                   payload={"v": 2}, content_id="profilesnap_2")
    assert get_artifact(conn, first["id"])["payload"]["v"] == 1
    conn.close()


def test_get_current_artifact_missing_returns_none(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    assert get_current_artifact(conn, workspace_id, "job_fit_result") is None
    conn.close()


def test_list_artifact_history_newest_first(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    first = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot", payload={"v": 1})
    second = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot", payload={"v": 2})
    history = list_artifact_history(conn, workspace_id, "profile_snapshot")
    assert [row["id"] for row in history] == [second["id"], first["id"]]
    conn.close()
