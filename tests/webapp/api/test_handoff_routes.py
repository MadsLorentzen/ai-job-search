from __future__ import annotations

from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace, ensure_profile_workspace


def _app(tmp_path):
    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", documents_root=tmp_path / "documents",
    )
    app = create_app(settings)
    with TestClient(app):
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        workspace = create_workspace(conn, company="Acme", title="Engineer")
        artifact = save_artifact(
            conn, workspace_id=workspace["id"], artifact_type="application_pack",
            payload={"schema_version": "application-pack.v1"},
        )
        conn.close()
    return app, workspace["id"], artifact["id"]


def _paired_credential(client) -> str:
    generated = client.post("/api/handoff/pairing/generate")
    assert generated.status_code == 201, generated.text
    one_time_secret = generated.json()["one_time_secret"]

    exchanged = client.post(
        "/api/handoff/pairing/exchange", json={"one_time_secret": one_time_secret}
    )
    assert exchanged.status_code == 201, exchanged.text
    return exchanged.json()["durable_secret"]


def test_pairing_generate_and_exchange_round_trip(tmp_path):
    app, _workspace_id, _artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        credential = _paired_credential(client)
        assert isinstance(credential, str)
        assert len(credential) >= 32


def test_start_session_requires_valid_extension_credential(tmp_path):
    app, workspace_id, artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/handoff/sessions",
            headers={"X-Handoff-Credential": "not-a-real-credential"},
            json={
                "workspace_id": workspace_id, "pack_artifact_id": artifact_id,
                "target_url": "https://x.test/apply", "target_domain": "x.test",
                "ats_adapter_id": "generic", "ats_adapter_version": "generic@1",
            },
        )
        assert response.status_code == 401


def test_full_session_lifecycle_over_http(tmp_path):
    app, workspace_id, artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        credential = _paired_credential(client)
        headers = {"X-Handoff-Credential": credential}

        started = client.post(
            "/api/handoff/sessions", headers=headers,
            json={
                "workspace_id": workspace_id, "pack_artifact_id": artifact_id,
                "target_url": "https://x.test/apply", "target_domain": "x.test",
                "ats_adapter_id": "generic", "ats_adapter_version": "generic@1",
            },
        )
        assert started.status_code == 201, started.text
        session_id = started.json()["id"]

        event_response = client.post(
            f"/api/handoff/sessions/{session_id}/events", headers=headers,
            json={
                "event_id": "evt_1", "event_type": "value_inserted",
                "event_payload": {"value": "shola@example.com"},
                "normalized_field_type": "email", "page_field_key": "generic:email",
            },
        )
        assert event_response.status_code == 201, event_response.text

        # retry with the same event_id must not create a duplicate
        retry_response = client.post(
            f"/api/handoff/sessions/{session_id}/events", headers=headers,
            json={
                "event_id": "evt_1", "event_type": "value_inserted",
                "event_payload": {"value": "different-value-should-be-ignored"},
                "normalized_field_type": "email", "page_field_key": "generic:email",
            },
        )
        assert retry_response.status_code == 201

        replay = client.get(
            f"/api/handoff/sessions/{session_id}/events", headers=headers
        )
        assert replay.status_code == 200
        events = replay.json()["events"]
        assert len(events) == 1
        assert events[0]["event_id"] == "evt_1"

        confirmed = client.post(
            f"/api/handoff/sessions/{session_id}/confirm-submission",
            headers=headers, json={"mark_workflow_applied": False},
        )
        assert confirmed.status_code == 201, confirmed.text
        assert confirmed.json()["session"]["status"] == "user_confirmed_submitted"


def test_sensitive_event_with_value_is_rejected_over_http(tmp_path):
    app, workspace_id, artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        credential = _paired_credential(client)
        headers = {"X-Handoff-Credential": credential}
        started = client.post(
            "/api/handoff/sessions", headers=headers,
            json={
                "workspace_id": workspace_id, "pack_artifact_id": artifact_id,
                "target_url": "https://x.test/apply", "target_domain": "x.test",
                "ats_adapter_id": "generic", "ats_adapter_version": "generic@1",
            },
        )
        session_id = started.json()["id"]

        rejected = client.post(
            f"/api/handoff/sessions/{session_id}/events", headers=headers,
            json={
                "event_id": "evt_sensitive", "event_type": "user_value_present_observed",
                "event_payload": {"value": "should not be sent"},
                "normalized_field_type": "salary_expectation",
                "page_field_key": "generic:salary",
            },
        )
        assert rejected.status_code == 400


def test_cross_account_denial_over_http(tmp_path):
    from webapp.persistence.accounts import create_account

    app, workspace_id, artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        conn = connect(app.state.settings.db_path)
        create_account(conn, account_id="account_other", display_name="Other")
        conn.close()

        # generate/exchange as account_other via a second app instance
        # pointed at the same account_id but a different db connection path
        other_settings = Settings(
            db_path=app.state.settings.db_path,
            documents_root=app.state.settings.documents_root,
            account_id="account_other",
        )
    with TestClient(create_app(other_settings)) as other_client:
        other_credential = _paired_credential(other_client)

    with TestClient(app) as client:
        response = client.post(
            "/api/handoff/sessions",
            headers={"X-Handoff-Credential": other_credential},
            json={
                "workspace_id": workspace_id, "pack_artifact_id": artifact_id,
                "target_url": "https://x.test/apply", "target_domain": "x.test",
                "ats_adapter_id": "generic", "ats_adapter_version": "generic@1",
            },
        )
        assert response.status_code == 404
