from __future__ import annotations

import pytest

from webapp.persistence.accounts import create_account
from webapp.persistence.db import connect, init_db
from webapp.persistence.user_profile import get_current_user_profile, save_user_profile
from webapp.persistence.search_workspaces import create_search_workspace
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


def test_preference_staleness_is_derived_and_isolated_by_search_workspace(tmp_path):
    conn = _connection(tmp_path)
    other = create_search_workspace(conn, name="Project Manager")
    save_user_profile(conn, {"target_roles": ["Planner"]})
    save_user_profile(
        conn,
        {"target_roles": ["Project Manager"]},
        search_workspace_id=other["id"],
    )
    default_run = run_discovery_search(
        conn, FakeRunner(), sources=["freehire-search"]
    )["run"]
    other_run = run_discovery_search(
        conn,
        FakeRunner(),
        sources=["freehire-search"],
        search_workspace_id=other["id"],
    )["run"]

    other_current = get_current_user_profile(conn, other["id"])
    save_user_profile(
        conn,
        {"target_roles": ["Programme Manager"]},
        search_workspace_id=other["id"],
        expected_revision=other_current["profile_revision"],
    )

    assert discovery_run_is_stale(
        conn, default_run, search_workspace_id="search_default"
    ) is False
    assert discovery_run_is_stale(
        conn, other_run, search_workspace_id=other["id"]
    ) is True
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(discovery_runs)")
    }
    assert "stale" not in columns


def test_search_and_staleness_use_the_explicit_nondefault_account(tmp_path):
    conn = _connection(tmp_path)
    create_account(conn, account_id="account_search_b", display_name="Search B")
    search = create_search_workspace(
        conn, name="Search B", account_id="account_search_b"
    )
    profile = save_user_profile(
        conn,
        {"target_roles": ["Project Planner"]},
        search_workspace_id=search["id"],
        account_id="account_search_b",
    )

    run = run_discovery_search(
        conn,
        FakeRunner(),
        search_workspace_id=search["id"],
        sources=["freehire-search"],
        account_id="account_search_b",
    )["run"]

    assert run["user_profile_content_id"] == profile["content_id"]
    assert discovery_run_is_stale(
        conn,
        run,
        search_workspace_id=search["id"],
        account_id="account_search_b",
    ) is False
