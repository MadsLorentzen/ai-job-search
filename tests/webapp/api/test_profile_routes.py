from pathlib import Path

from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings

FIXTURE_PROFILE_ROOT = Path(__file__).parents[1] / "fixtures" / "webapp_profile_root"


def _client(tmp_path):
    return TestClient(create_app(Settings(
        db_path=tmp_path / "jobsearch.sqlite3", profile_root=str(FIXTURE_PROFILE_ROOT)
    )))


def test_profile_get_refresh_and_get_round_trip(tmp_path):
    with _client(tmp_path) as client:
        assert client.get("/api/profile").json()["profile"] is None
        refreshed = client.post("/api/profile/refresh")
        assert refreshed.status_code == 200
        content_id = refreshed.json()["profile"]["content_id"]
        assert content_id.startswith("profilesnap_")
        assert client.get("/api/profile").json()["profile"]["content_id"] == content_id


def test_profile_pseudo_workspace_is_hidden_from_job_list_and_detail(tmp_path):
    with _client(tmp_path) as client:
        client.post("/api/profile/refresh")
        assert client.get("/api/workspaces").json()["workspaces"] == []
        assert client.get("/api/workspaces/profile").status_code == 404
