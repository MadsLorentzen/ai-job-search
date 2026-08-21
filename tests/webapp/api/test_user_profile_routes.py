from __future__ import annotations

from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings


def _client(tmp_path):
    return TestClient(create_app(Settings(db_path=tmp_path / "user-profile.sqlite3")))


def _payload(**overrides):
    value = {
        "target_roles": ["Project Manager", "Planner"],
        "locations": ["Aberdeen, UK"],
        "remote_preference": "remote_or_hybrid",
        "seniority_levels": ["senior", "lead"],
        "industries": ["Energy"],
        "employment_types": ["full_time", "contract"],
        "search_terms": ["Primavera P6", "project controls"],
        "source_preferences": ["linkedin-search", "freehire-search"],
        "recency_days": 14,
        "compensation": {"currency": "GBP", "minimum": 60000, "period": "year"},
    }
    value.update(overrides)
    return value


def test_get_then_put_round_trip_and_idempotent_update(tmp_path):
    with _client(tmp_path) as client:
        empty = client.get("/api/user-profile")
        assert empty.status_code == 200
        assert empty.json()["user_profile"] is None
        assert empty.json()["defaults"]["schema_version"] == "user-profile.v1"

        created = client.put("/api/user-profile", json=_payload())
        assert created.status_code == 200, created.text
        record = created.json()["user_profile"]
        assert record["payload"]["target_roles"] == ["Project Manager", "Planner"]
        assert record["content_id"].startswith("userprofile_")
        assert client.get("/api/profile").json()["profile"] is None
        assert client.get("/api/workspaces").json()["workspaces"] == []

        repeated = client.put("/api/user-profile", json=_payload())
        assert repeated.json()["user_profile"]["id"] == record["id"]
        assert client.get("/api/user-profile").json()["user_profile"]["id"] == record["id"]


def test_request_shape_and_preference_values_are_strict(tmp_path):
    with _client(tmp_path) as client:
        assert client.put(
            "/api/user-profile", json={**_payload(), "skills": ["unsupported evidence field"]},
        ).status_code == 422
        invalid = client.put(
            "/api/user-profile", json=_payload(remote_preference="sometimes"),
        )
        assert invalid.status_code == 400
        assert "remote_preference" in invalid.json()["detail"]


def test_user_profile_page_is_distinct_from_evidence_profile_and_editable(tmp_path):
    with _client(tmp_path) as client:
        client.put("/api/user-profile", json=_payload())
        page = client.get("/user-profile")

        assert page.status_code == 200
        assert "Job search preferences" in page.text
        assert "Project Manager" in page.text
        assert "These preferences do not become candidate evidence" in page.text
        assert 'id="user-profile-form"' in page.text
        assert 'href="/profile">Evidence Profile</a>' in page.text
        assert 'href="/user-profile">User Profile</a>' in page.text
