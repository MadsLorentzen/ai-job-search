from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from product.job_understanding_providers import JobUnderstandingProviderError
from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workspaces import ensure_profile_workspace

EXTENSIONS_DIR = Path(__file__).parents[2] / "fixtures" / "extensions"


def _settings(tmp_path):
    return Settings(
        db_path=tmp_path / "jobsearch.sqlite3", extensions_dir=EXTENSIONS_DIR,
        documents_root=tmp_path / "documents",
    )


def _source_record():
    return {
        "schema_version": "job-source-record.v0", "source": "manual",
        "captured_at": "2026-08-18T00:00:00Z", "company": "Acme",
        "title": "Backend Engineer", "description": "Python is required.",
    }


def _create(client):
    response = client.post("/api/workspaces", json={
        "company": "Acme", "title": "Backend Engineer", "source_record": _source_record(),
    })
    assert response.status_code == 201, response.text
    return response.json()["workspace"]["id"]


def test_create_list_and_get_workspace(tmp_path):
    with TestClient(create_app(_settings(tmp_path))) as client:
        workspace_id = _create(client)
        assert client.get("/api/workspaces").json()["workspaces"][0]["id"] == workspace_id
        assert client.get(f"/api/workspaces/{workspace_id}").json()["workspace"]["company"] == "Acme"
        assert client.get("/api/workspaces/missing").status_code == 404


def test_extensions_expose_public_metadata_without_internal_paths(tmp_path):
    with TestClient(create_app(_settings(tmp_path))) as client:
        response = client.get("/api/extensions")
        assert response.status_code == 200
        extensions = response.json()["extensions"]
        assert {item["id"] for item in extensions} == {"geophysics", "plumbing"}
        assert all(set(item) == {"id", "version", "name"} for item in extensions)
        assert "path" not in response.text


def test_extensions_endpoint_rejects_ambiguous_duplicate_ids(tmp_path):
    from tests.webapp.services.test_extension_registry import _write_extension

    extensions_dir = tmp_path / "extensions"
    _write_extension(extensions_dir, "well_control", "1.0.0", "one")
    _write_extension(extensions_dir, "well_control", "2.0.0", "two")
    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", extensions_dir=extensions_dir,
        documents_root=tmp_path / "documents",
    )
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/extensions")
        assert response.status_code == 400
        assert "ambiguous duplicate extension id" in response.json()["detail"]
        assert "path" not in response.json()["detail"].casefold()


@pytest.mark.parametrize("field", ["extension_paths", "extension_path", "paths", "path"])
def test_fit_request_rejects_every_client_path_field(tmp_path, field):
    with TestClient(create_app(_settings(tmp_path))) as client:
        workspace_id = _create(client)
        response = client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={"request_id": "fit_1", "extension_ids": [], field: ["C:/private/extension.json"]},
        )
        assert response.status_code == 422


def test_fit_resolves_extension_ids_server_side(tmp_path, monkeypatch):
    captured = {}

    def fake_run(conn, workspace_id, adapter, *, request_id, active_extensions=None, extension_paths=None):
        captured["active_extensions"] = active_extensions
        captured["extension_paths"] = extension_paths
        return {"id": "art_fit", "artifact_type": "job_fit_result"}

    monkeypatch.setattr("webapp.services.http_api.run_job_fit", fake_run)
    app = create_app(_settings(tmp_path))
    app.state.semantic_adapter = object()
    with TestClient(app) as client:
        workspace_id = _create(client)
        response = client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={"request_id": "fit_1", "extension_ids": ["geophysics"]},
        )
        assert response.status_code == 200, response.text
    assert captured["extension_paths"] is None
    assert [item["id"] for item in captured["active_extensions"]] == ["geophysics"]


def test_unknown_extension_id_is_clean_400(tmp_path):
    app = create_app(_settings(tmp_path))
    app.state.semantic_adapter = object()
    with TestClient(app) as client:
        workspace_id = _create(client)
        response = client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={"request_id": "fit_1", "extension_ids": ["not-installed"]},
        )
        assert response.status_code == 400
        assert "not_installed" in response.json()["detail"]


def test_duplicate_extension_ids_are_rejected_at_http_boundary(tmp_path):
    app = create_app(_settings(tmp_path))
    app.state.semantic_adapter = object()
    with TestClient(app) as client:
        workspace_id = _create(client)
        response = client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={
                "request_id": "fit_duplicate",
                "extension_ids": ["geophysics", "geophysics"],
            },
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "duplicate extension ids are not allowed"


@pytest.mark.parametrize("suffix,body", [
    ("understand", {"request_id": "u"}),
    ("fit", {"request_id": "f", "extension_ids": []}),
    ("application-intelligence", {"request_id": "a"}),
])
def test_profile_pseudo_workspace_cannot_run_processing(tmp_path, suffix, body):
    settings = _settings(tmp_path)
    app = create_app(settings)
    app.state.job_understanding_provider = object()
    app.state.semantic_adapter = object()
    app.state.application_intelligence_provider = object()
    with TestClient(app) as client:
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        conn.close()
        assert client.post(f"/api/workspaces/profile/{suffix}", json=body).status_code == 404


class _FailingUnderstandingProvider:
    provider_id = "failing"
    model_id = "failing"
    model_version = "v0"

    def extract(self, request):
        raise JobUnderstandingProviderError("simulated provider outage")


def test_provider_failure_restores_all_previous_successful_current_artifacts(tmp_path):
    settings = _settings(tmp_path)
    app = create_app(settings)
    app.state.job_understanding_provider = _FailingUnderstandingProvider()
    with TestClient(app) as client:
        workspace_id = _create(client)
        conn = connect(settings.db_path)
        old_request = save_artifact(
            conn, workspace_id=workspace_id, artifact_type="job_understanding_request",
            payload={"old": "request"}, content_id="jureq_old",
        )
        old_result = save_artifact(
            conn, workspace_id=workspace_id, artifact_type="job_understanding_result",
            payload={"old": "result"}, content_id="juresult_old",
        )
        conn.close()
        response = client.post(
            f"/api/workspaces/{workspace_id}/understand", json={"request_id": "new_request"}
        )
        assert response.status_code == 400
        conn = connect(settings.db_path)
        assert get_current_artifact(conn, workspace_id, "job_understanding_request")["id"] == old_request["id"]
        assert get_current_artifact(conn, workspace_id, "job_understanding_result")["id"] == old_result["id"]
        conn.close()
