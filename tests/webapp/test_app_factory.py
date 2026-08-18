from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings


def test_create_app_returns_fastapi_instance():
    app = create_app(Settings(db_path="./.jobsearch/test.sqlite3"))
    assert app.title == "Job Application Workspace"


def test_default_settings_bind_to_localhost_only():
    assert Settings().host == "127.0.0.1"


def test_health_endpoint_ok():
    app = create_app(Settings(db_path="./.jobsearch/test.sqlite3"))
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_health_response_never_contains_api_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-never-leak")
    app = create_app(Settings(db_path="./.jobsearch/test.sqlite3"))
    with TestClient(app) as client:
        response = client.get("/health")
        assert "sk-should-never-leak" not in response.text
