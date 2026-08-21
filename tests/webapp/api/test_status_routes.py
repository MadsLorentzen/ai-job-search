from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workflow import record_status_change
from webapp.persistence.workspaces import create_workspace, ensure_profile_workspace


def _client_workspace(tmp_path):
    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3")
    app = create_app(settings)
    with TestClient(app):
        conn = connect(settings.db_path)
        workspace = create_workspace(conn, company="Acme", title="Engineer")
        conn.close()
    return TestClient(app), settings, workspace["id"]


def test_generic_status_rejects_drafted_and_unknown_status(tmp_path):
    client, _, workspace_id = _client_workspace(tmp_path)
    with client:
        drafted = client.patch(f"/api/workspaces/{workspace_id}/status", json={
            "new_status": "drafted", "effective_date": "2026-08-20"
        })
        assert drafted.status_code == 400
        assert "application-pack" in drafted.json()["detail"]
        assert client.patch(f"/api/workspaces/{workspace_id}/status", json={
            "new_status": "ghosted", "effective_date": "2026-08-20"
        }).status_code == 400


def test_applied_ignores_client_pack_id_and_binds_current_pack_server_side(tmp_path):
    client, settings, workspace_id = _client_workspace(tmp_path)
    with client:
        conn = connect(settings.db_path)
        old_pack = save_artifact(
            conn, workspace_id=workspace_id, artifact_type="application_pack",
            payload={
                "pack": "A", "cv_content": [{"text": "Reviewed A"}],
                "cover_letter_content": [],
            },
        )
        record_status_change(
            conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18",
            submitted_pack_artifact_id=old_pack["id"], _allow_drafted=True,
        )
        current_pack = save_artifact(
            conn, workspace_id=workspace_id, artifact_type="application_pack",
            payload={
                "pack": "B", "cv_content": [{"text": "Reviewed B"}],
                "cover_letter_content": [],
            },
        )
        conn.close()
        response = client.patch(f"/api/workspaces/{workspace_id}/status", json={
            "new_status": "applied", "effective_date": "2026-08-20"
        })
        assert response.status_code == 200
        events = client.get(f"/api/workspaces/{workspace_id}/events").json()["events"]
        applied = next(item for item in events if item["new_status"] == "applied")
        assert applied["submitted_pack_artifact_id"] == current_pack["id"]
        assert set(applied) == {
            "id", "workspace_id", "previous_status", "new_status", "effective_date",
            "note", "submitted_pack_artifact_id", "created_at",
        }


def test_status_body_cannot_supply_pack_binding(tmp_path):
    client, _, workspace_id = _client_workspace(tmp_path)
    with client:
        response = client.patch(f"/api/workspaces/{workspace_id}/status", json={
            "new_status": "applied", "effective_date": "2026-08-20",
            "submitted_pack_artifact_id": "art_attacker",
        })
        assert response.status_code == 422


def test_profile_pseudo_workspace_rejected_by_status_and_events(tmp_path):
    client, settings, _ = _client_workspace(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        conn.close()
        assert client.patch("/api/workspaces/profile/status", json={
            "new_status": "interview", "effective_date": "2026-08-20"
        }).status_code == 404
        assert client.get("/api/workspaces/profile/events").status_code == 404


def test_no_apply_submit_send_or_email_endpoints(tmp_path):
    client, _, workspace_id = _client_workspace(tmp_path)
    with client:
        for suffix in ("apply", "submit", "send", "email"):
            assert client.post(f"/api/workspaces/{workspace_id}/{suffix}").status_code == 404
