from __future__ import annotations

from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings


class Runner:
    def search(self, source, **kwargs):
        return [{
            "id": "planner-1", "title": "Project Planner", "company": "Energy Co",
            "location": "Aberdeen", "date": "2026-08-20",
            "url": "https://freehire.me/jobs/planner-1", "description": "Plan work.",
            "work_mode": "hybrid", "regions": ["eu"], "countries": ["GB"], "skills": [],
        }]


def test_discovery_search_lifecycle_and_idempotent_promotion(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "discovery.sqlite3"))
    app.state.discovery_portal_runner = Runner()
    with TestClient(app) as client:
        client.put("/api/user-profile", json={
            "target_roles": ["Project Planner"], "locations": ["Aberdeen"],
            "source_preferences": ["freehire-search"], "recency_days": 14,
        })
        searched = client.post("/api/discovery/search", json={"limit_per_source": 5})
        assert searched.status_code == 200, searched.text
        candidate_id = searched.json()["candidate_ids"][0]
        page = client.get("/discover")
        assert page.status_code == 200
        assert "Project Planner" in page.text
        assert "No invented score" in page.text

        saved = client.patch(f"/api/discovery/candidates/{candidate_id}", json={"status": "saved"})
        assert saved.json()["candidate"]["lifecycle_status"] == "saved"
        first = client.post(f"/api/discovery/candidates/{candidate_id}/promote")
        second = client.post(f"/api/discovery/candidates/{candidate_id}/promote")
        assert first.status_code == 200
        assert first.json()["created"] is True
        assert second.json()["created"] is False
        assert first.json()["workspace"]["id"] == second.json()["workspace"]["id"]
        assert len(client.get("/api/workspaces").json()["workspaces"]) == 1


def test_discovery_requires_profile_and_rejects_unknown_source(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "discovery.sqlite3"))
    app.state.discovery_portal_runner = Runner()
    with TestClient(app) as client:
        assert client.post("/api/discovery/search", json={}).status_code == 400
        client.put("/api/user-profile", json={})
        invalid = client.post("/api/discovery/search", json={"sources": ["made-up"]})
        assert invalid.status_code == 400
        assert "unsupported discovery sources" in invalid.json()["detail"]
