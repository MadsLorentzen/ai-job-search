from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace, ensure_profile_workspace

_FIXTURES_DIR = Path(__file__).parent / "fixtures" / "handoff"


def _live_server_settings(tmp_path):
    return Settings(
        db_path=tmp_path / "jobsearch.sqlite3",
        documents_root=tmp_path / "documents",
        handoff_fixtures_dir=_FIXTURES_DIR,
    )


def test_generic_fixture_page_is_served(tmp_path):
    settings = _live_server_settings(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.get("/test-fixtures/handoff/generic_fixture.html")
        assert response.status_code == 200
        assert "Full Name" in response.text
        assert "certify" in response.text


def test_handoff_session_lifecycle_against_fixture_workspace(tmp_path):
    settings = _live_server_settings(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        workspace = create_workspace(conn, company="Acme", title="Engineer")
        artifact = save_artifact(
            conn, workspace_id=workspace["id"], artifact_type="application_pack",
            payload={"schema_version": "application-pack.v1"},
        )
        conn.close()

        generated = client.post("/api/handoff/pairing/generate")
        one_time_secret = generated.json()["one_time_secret"]
        exchanged = client.post(
            "/api/handoff/pairing/exchange", json={"one_time_secret": one_time_secret},
        )
        credential = exchanged.json()["durable_secret"]
        headers = {"X-Handoff-Credential": credential}

        started = client.post(
            "/api/handoff/sessions", headers=headers,
            json={
                "workspace_id": workspace["id"], "pack_artifact_id": artifact["id"],
                "target_url": "http://testserver/test-fixtures/handoff/generic_fixture.html",
                "target_domain": "testserver", "ats_adapter_id": "generic",
                "ats_adapter_version": "generic@1",
            },
        )
        assert started.status_code == 201
        session_id = started.json()["id"]

        # Simulates what the extension's content script + background
        # worker would report after scanning the real fixture page: only
        # safe-catalog fields autofilled, the certification checkbox
        # never touched.
        for field_name, value in [("name", "Test User"), ("email", "test@example.com")]:
            response = client.post(
                f"/api/handoff/sessions/{session_id}/events", headers=headers,
                json={
                    "event_id": f"evt_{field_name}", "event_type": "value_inserted",
                    "event_payload": {"value": value},
                    "normalized_field_type": field_name,
                    "page_field_key": f"generic:{field_name}",
                },
            )
            assert response.status_code == 201

        replay = client.get(
            f"/api/handoff/sessions/{session_id}/events", headers=headers
        )
        events = replay.json()["events"]
        assert len(events) == 2
        assert all(event["event_type"] == "value_inserted" for event in events)

        confirmed = client.post(
            f"/api/handoff/sessions/{session_id}/confirm-submission",
            headers=headers, json={"mark_workflow_applied": False},
        )
        assert confirmed.status_code == 201
        assert confirmed.json()["session"]["status"] == "user_confirmed_submitted"
