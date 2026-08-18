from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.review import save_review_decision, list_review_decisions


def _setup(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    artifact = save_artifact(conn, workspace_id=ws["id"], artifact_type="job_fit_result", payload={"gaps": []})
    return conn, ws["id"], artifact["id"]


def test_save_review_decision_roundtrip(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    decision = save_review_decision(
        conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=artifact_id,
        domain_item_id="gap_001", disposition="acknowledged_and_proceed", note="Discussed in interview prep",
    )
    assert decision["disposition"] == "acknowledged_and_proceed"
    decisions = list_review_decisions(conn, workspace_id)
    assert len(decisions) == 1
    assert decisions[0]["domain_item_id"] == "gap_001"
    conn.close()


def test_list_review_decisions_filtered_by_artifact(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    other_artifact = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result", payload={"gaps": []})
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=artifact_id,
                          domain_item_id="gap_001", disposition="acknowledged_and_proceed")
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=other_artifact["id"],
                          domain_item_id="gap_002", disposition="omit_from_positioning")
    filtered = list_review_decisions(conn, workspace_id, source_artifact_id=artifact_id)
    assert len(filtered) == 1
    assert filtered[0]["domain_item_id"] == "gap_001"
    conn.close()
