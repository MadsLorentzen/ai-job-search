from __future__ import annotations

import pytest

from webapp.persistence.db import connect, init_db
from webapp.persistence.user_profile import save_user_profile
from webapp.services.discovery import DiscoveryServiceError, discovery_run_is_stale, run_discovery_search


class FakeRunner:
    def __init__(self):
        self.calls = []

    def search(self, source, **kwargs):
        self.calls.append((source, kwargs))
        if source == "linkedin-search":
            raise RuntimeError("rate limited")
        return [{
            "id": "planner-1", "title": "Project Planner", "company": "Energy Co",
            "location": "Aberdeen", "date": "2026-08-20",
            "url": "https://freehire.me/jobs/planner-1", "description": "Plan work.",
            "work_mode": "hybrid", "regions": ["eu"], "countries": ["GB"], "skills": [],
        }]


def _connection(tmp_path):
    path = tmp_path / "search.db"
    init_db(path)
    return connect(path)


def test_search_requires_user_profile(tmp_path):
    with pytest.raises(DiscoveryServiceError, match="User Profile"):
        run_discovery_search(_connection(tmp_path), FakeRunner())


def test_search_fingerprints_preferences_and_isolates_source_failure(tmp_path):
    conn = _connection(tmp_path)
    profile = save_user_profile(conn, {
        "target_roles": ["Project Planner"], "locations": ["Aberdeen"],
        "search_terms": ["project controls"], "source_preferences": ["freehire-search", "linkedin-search"],
        "recency_days": 7,
    })
    runner = FakeRunner()

    result = run_discovery_search(conn, runner, limit_per_source=10)

    assert result["run"]["status"] == "partial"
    assert result["run"]["user_profile_content_id"] == profile["content_id"]
    assert result["run"]["request"]["queries"] == ["project controls"]
    assert result["run"]["source_status"]["freehire-search"]["accepted"] == 1
    assert result["run"]["source_status"]["linkedin-search"]["status"] == "failed"
    assert len(result["candidate_ids"]) == 1
    assert conn.execute("select count(*) from workspaces").fetchone()[0] == 0
    assert discovery_run_is_stale(conn, result["run"]) is False
    save_user_profile(conn, {"target_roles": ["Changed role"]})
    assert discovery_run_is_stale(conn, result["run"]) is True
