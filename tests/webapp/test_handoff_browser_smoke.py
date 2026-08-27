from __future__ import annotations

import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
import uvicorn
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


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
def live_server(tmp_path, monkeypatch):
    secret = "task20-secret-sentinel-value"
    monkeypatch.setenv("OPENAI_API_KEY", secret)
    port = _free_port()
    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", host="127.0.0.1", port=port,
        documents_root=tmp_path / "documents", handoff_fixtures_dir=_FIXTURES_DIR,
    )
    app = create_app(settings)
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="warning", access_log=False,
    ))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                break
        except OSError:
            time.sleep(0.05)
    else:
        server.should_exit = True
        thread.join(timeout=5)
        raise RuntimeError("Uvicorn handoff fixture did not start on 127.0.0.1")
    yield SimpleNamespace(base_url=f"http://127.0.0.1:{port}", db_path=settings.db_path, secret=secret)
    server.should_exit = True
    thread.join(timeout=10)
    assert not thread.is_alive(), "Uvicorn handoff fixture did not stop cleanly"


@pytest.fixture(scope="module", autouse=True)
def _build_adapter_bundle():
    npm = shutil.which("npm")
    subprocess.run(
        [npm, "run", "build:test-bundle"], cwd="extension", check=True,
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


def test_greenhouse_fixture_autofills_only_safe_catalog_via_real_adapter(page, live_server):
    page.goto(f"{live_server.base_url}/test-fixtures/handoff/greenhouse_fixture.html")
    page.add_script_tag(path="extension/dist/adapters-bundle.js")

    result = page.evaluate(
        """() => {
            const fields = HandoffAdapters.greenhouseAdapter.scan(document);
            return fields.map(f => ({
                label: f.labelText,
                behavior: HandoffAdapters.greenhouseAdapter.classify(f).behavior,
                normalizedFieldType:
                    HandoffAdapters.greenhouseAdapter.classify(f).normalizedFieldType,
                sourceKind: HandoffAdapters.greenhouseAdapter.classify(f).sourceKind,
            }));
        }"""
    )
    by_label = {row["label"]: row["behavior"] for row in result}
    rows_by_label = {row["label"]: row for row in result}
    assert by_label["First Name"] == "autofill"
    assert rows_by_label["First Name"]["normalizedFieldType"] == "name"
    assert rows_by_label["First Name"]["sourceKind"] == "safe_fact"
    assert by_label["Email"] == "autofill"
    assert by_label["Most Recent Employer"] == "autofill"
    assert (
        rows_by_label["Most Recent Employer"]["normalizedFieldType"]
        == "employment[0].employer"
    )
    assert rows_by_label["Most Recent Employer"]["sourceKind"] == "adapter_rule"
    assert by_label["Years of Experience"] == "suggest"
    disability_label = next(k for k in by_label if "Disability" in k)
    assert by_label[disability_label] == "ask"


def test_generic_employer_field_never_becomes_candidate_identity(page, live_server):
    page.goto(f"{live_server.base_url}/test-fixtures/handoff/generic_fixture.html")
    page.add_script_tag(path="extension/dist/adapters-bundle.js")

    result = page.evaluate(
        """() => {
            const fields = HandoffAdapters.genericAdapter.scan(document);
            const employer = fields.find(f => f.labelText === 'Employer location');
            return HandoffAdapters.genericAdapter.classify(employer);
        }"""
    )
    assert result["behavior"] == "ask"
    assert result["normalizedFieldType"] == "unknown"
    assert result["sourceKind"] == "none"


def test_legal_declaration_checkbox_never_classified_as_actionable(page, live_server):
    page.goto(f"{live_server.base_url}/test-fixtures/handoff/generic_fixture.html")
    page.add_script_tag(path="extension/dist/adapters-bundle.js")

    result = page.evaluate(
        """() => {
            const fields = HandoffAdapters.genericAdapter.scan(document);
            const cert = fields.find(f => f.labelText.includes('certify'));
            return HandoffAdapters.genericAdapter.classify(cert).behavior;
        }"""
    )
    assert result == "never"

    # the checkbox's actual DOM state must be unaffected by classification alone
    checked = page.locator("#f_cert").is_checked()
    assert checked is False


def test_real_submit_button_never_clicked_by_classification_pass(page, live_server):
    page.goto(f"{live_server.base_url}/test-fixtures/handoff/generic_fixture.html")
    page.add_script_tag(path="extension/dist/adapters-bundle.js")
    page.evaluate(
        "() => { window.__submitClicks = 0; "
        "document.getElementById('submit-btn')"
        ".addEventListener('click', () => { window.__submitClicks += 1; }); }"
    )

    page.evaluate(
        """() => {
            const fields = HandoffAdapters.genericAdapter.scan(document);
            fields.forEach(f => HandoffAdapters.genericAdapter.classify(f));
        }"""
    )
    clicks = page.evaluate("() => window.__submitClicks")
    assert clicks == 0


def test_no_sensitive_value_or_secret_leakage_in_fixture_page(page, live_server):
    page.goto(f"{live_server.base_url}/test-fixtures/handoff/generic_fixture.html")
    content = page.content()
    assert "OPENAI_API_KEY" not in content
    assert live_server.secret not in content
