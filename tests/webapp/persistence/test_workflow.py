import pytest

from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import create_workspace, get_workspace
from webapp.persistence.workflow import (
    TRACKER_STATUSES, FINAL_STATUSES, is_final, record_status_change, list_workflow_events,
)


def _workspace(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    return conn, ws["id"]


def test_tracker_statuses_exact_vocabulary():
    assert TRACKER_STATUSES == (
        "drafted", "applied", "interview", "offer",
        "hired", "rejected", "no_response", "offer_declined", "withdrawn",
    )


def test_final_statuses_grouping():
    assert FINAL_STATUSES == {"hired", "rejected", "no_response", "offer_declined", "withdrawn"}
    assert is_final("drafted") is False
    assert is_final("hired") is True


def test_record_status_change_rejects_drafted_without_explicit_allow(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(ValueError, match="drafted"):
        record_status_change(conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18")
    conn.close()


def test_record_status_change_rejects_applied_without_prior_drafted(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(ValueError, match="applied requires the workspace"):
        record_status_change(conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-18")
    conn.close()


def test_record_status_change_rejects_applied_without_pack_binding(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    from webapp.persistence.artifacts import save_artifact
    pack = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_pack",
        payload={"cv_content": [{"text": "Reviewed material"}], "cover_letter_content": []},
    )
    record_status_change(conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18",
                          submitted_pack_artifact_id=pack["id"], _allow_drafted=True)
    with pytest.raises(ValueError, match="applied requires submitted_pack_artifact_id"):
        record_status_change(conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-19")
    conn.close()


def test_record_status_change_allows_applied_after_drafted_with_pack_binding(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    from webapp.persistence.artifacts import save_artifact
    pack = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_pack",
        payload={"cv_content": [{"text": "Reviewed material"}], "cover_letter_content": []},
    )
    record_status_change(conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18",
                          submitted_pack_artifact_id=pack["id"], _allow_drafted=True)
    record_status_change(conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-19",
                          submitted_pack_artifact_id=pack["id"])
    assert get_workspace(conn, workspace_id)["workflow_status"] == "applied"
    events = list_workflow_events(conn, workspace_id)
    applied_event = next(e for e in events if e["new_status"] == "applied")
    assert applied_event["submitted_pack_artifact_id"] == pack["id"]
    conn.close()


def test_record_status_change_rejects_applied_with_incomplete_pack_binding(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    from webapp.persistence.artifacts import save_artifact
    pack = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_pack",
        payload={"cv_content": [], "cover_letter_content": []},
    )
    # Simulate a legacy row created before completion gating existed. The
    # applied transition must still defend the invariant independently.
    conn.execute(
        "UPDATE workspaces SET workflow_status = 'drafted' WHERE id = ?", (workspace_id,)
    )
    conn.commit()

    with pytest.raises(ValueError, match="no reviewed usable application material"):
        record_status_change(
            conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-19",
            submitted_pack_artifact_id=pack["id"],
        )

    assert get_workspace(conn, workspace_id)["workflow_status"] == "drafted"


def test_record_status_change_allows_drafted_with_internal_flag_and_pack_binding(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    from webapp.persistence.artifacts import save_artifact
    pack = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_pack",
        payload={"cv_content": [{"text": "Reviewed material"}], "cover_letter_content": []},
    )
    record_status_change(
        conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18",
        submitted_pack_artifact_id=pack["id"], _allow_drafted=True,
    )
    assert get_workspace(conn, workspace_id)["workflow_status"] == "drafted"
    events = list_workflow_events(conn, workspace_id)
    assert events[0]["submitted_pack_artifact_id"] == pack["id"]
    conn.close()


def test_record_status_change_updates_workspace_and_logs_event_for_non_drafted(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    record_status_change(conn, workspace_id=workspace_id, new_status="interview", effective_date="2026-08-18", note="x")
    assert get_workspace(conn, workspace_id)["workflow_status"] == "interview"
    events = list_workflow_events(conn, workspace_id)
    assert len(events) == 1
    assert events[0]["previous_status"] is None
    assert events[0]["new_status"] == "interview"
    conn.close()


def test_record_status_change_rejects_unknown_status(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(ValueError):
        record_status_change(conn, workspace_id=workspace_id, new_status="ghosted", effective_date="2026-08-18")
    conn.close()


def test_record_status_change_tracks_previous_status(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    record_status_change(conn, workspace_id=workspace_id, new_status="interview", effective_date="2026-08-18")
    record_status_change(conn, workspace_id=workspace_id, new_status="offer", effective_date="2026-08-19")
    events = list_workflow_events(conn, workspace_id)
    assert events[0]["previous_status"] == "interview"
    assert events[0]["new_status"] == "offer"
    conn.close()


def test_status_and_event_commit_atomically(tmp_path):
    # If record_status_change raises partway through, neither the workspace row
    # nor the event row should reflect a partial write. Simulate by forcing a
    # constraint violation on the event insert (invalid FK) and asserting the
    # workspace status did not change.
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(Exception):
        record_status_change(
            conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18",
            submitted_pack_artifact_id="art_does_not_exist", _allow_drafted=True,
        )
    assert get_workspace(conn, workspace_id)["workflow_status"] is None
    assert list_workflow_events(conn, workspace_id) == []
    conn.close()
