from pathlib import Path
import shutil

from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings

FIXTURE_PROFILE_ROOT = Path(__file__).parents[1] / "fixtures" / "webapp_profile_root"


def _unconfigured_root(tmp_path):
    root = tmp_path / "profile-root"
    shutil.copytree(FIXTURE_PROFILE_ROOT, root)
    target = root / ".claude/skills/job-application-assistant/01-candidate-profile.md"
    target.write_text(
        "# Candidate Profile\n\n<!-- SETUP: This file is populated by running /setup -->\n"
        "\n## Identity\n- **Name:** [YOUR_NAME]\n",
        encoding="utf-8",
    )
    return root


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


def test_first_time_basic_setup_builds_profile_and_rejects_second_overwrite(tmp_path):
    root = _unconfigured_root(tmp_path)
    app = create_app(Settings(
        db_path=tmp_path / "setup.sqlite3", profile_root=str(root)
    ))
    with TestClient(app) as client:
        page = client.get("/profile?return_to=/workspaces/ws_example")
        assert "Create your Evidence Profile" in page.text
        assert 'data-return-to="/workspaces/ws_example"' in page.text

        response = client.post("/api/profile/setup/basic", json={
            "name": "Ada Lovelace",
            "location": "London, UK",
            "education": ["MSc Computing"],
            "experience": ["Led programme delivery."],
            "skills": ["Power BI"],
            "certifications": ["PRINCE2 Practitioner"],
        })
        assert response.status_code == 201, response.text
        summary = response.json()["profile"]["payload"]["summary"]
        assert summary["claim_count"] > summary["placeholder_claim_count"]
        assert client.get("/api/profile").json()["profile"]["content_id"].startswith("profilesnap_")

        second = client.post("/api/profile/setup/import", json={
            "markdown": "# Candidate Profile\n\n## Identity\n- **Name:** Replacement\n"
        })
        assert second.status_code == 400
        assert "only available" in second.json()["detail"]


def test_import_requires_candidate_profile_heading_and_name(tmp_path):
    root = _unconfigured_root(tmp_path)
    app = create_app(Settings(db_path=tmp_path / "invalid.sqlite3", profile_root=str(root)))
    with TestClient(app) as client:
        assert client.post(
            "/api/profile/setup/import", json={"markdown": "Just some CV text"}
        ).status_code == 400
