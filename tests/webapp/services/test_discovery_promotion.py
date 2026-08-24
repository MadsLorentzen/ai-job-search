from __future__ import annotations

import pytest

from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.db import connect, init_db
from webapp.persistence.discovery import ingest_discovery_record
from webapp.persistence.search_workspaces import create_search_workspace
from webapp.services.discovery import DiscoveryServiceError, promote_discovery_candidate
from webapp.services.pipeline import create_job_from_source_record


def test_promotion_is_idempotent_and_uses_exact_stored_source_record(tmp_path):
    path = tmp_path / "promotion.db"; init_db(path); conn = connect(path)
    source_record = {
        "schema_version": "job-source-record.v0", "source": "freehire-search",
        "source_record_id": "planner-77", "source_url": "https://freehire.me/jobs/planner-77",
        "captured_at": "2026-08-21T09:00:00+00:00", "company": "Energy Co",
        "title": "Project Planner", "location": "Aberdeen",
        "description": "Exact stored description — do not refetch.",
        "requirements": [], "responsibilities": [], "language_requirements": [],
        "eligibility_requirements": [], "logistics_requirements": [],
    }
    candidate = ingest_discovery_record(conn, source_record)["candidate"]

    first = promote_discovery_candidate(conn, candidate["id"])
    second = promote_discovery_candidate(conn, candidate["id"])

    assert first["created"] is True
    assert second["created"] is False
    assert first["workspace"]["id"] == second["workspace"]["id"]
    assert conn.execute("select count(*) from workspaces where kind='job'").fetchone()[0] == 1
    artifact = get_current_artifact(conn, first["workspace"]["id"], "job_posting_snapshot")
    assert artifact["payload"]["description"] == source_record["description"]
    assert second["candidate"]["lifecycle_status"] == "promoted"


def test_same_strong_job_from_two_search_workspaces_reuses_one_application(tmp_path):
    path = tmp_path / "promotion.db"; init_db(path); conn = connect(path)
    other = create_search_workspace(conn, name="Project Manager")
    source_record = {
        "schema_version": "job-source-record.v0", "source": "portal-a",
        "source_record_id": "shared-1", "source_url": "https://jobs.example/shared-1",
        "captured_at": "2026-08-21T09:00:00+00:00", "company": "Energy Co",
        "title": "Project Planner", "location": "London", "description": "Plan work.",
        "requirements": [], "responsibilities": [], "language_requirements": [],
        "eligibility_requirements": [], "logistics_requirements": [],
    }
    first_candidate = ingest_discovery_record(conn, source_record)["candidate"]
    second_candidate = ingest_discovery_record(
        conn,
        {**source_record, "captured_at": "2026-08-22T09:00:00+00:00"},
        search_workspace_id=other["id"],
    )["candidate"]

    first = promote_discovery_candidate(conn, first_candidate["id"])
    second = promote_discovery_candidate(
        conn, second_candidate["id"], search_workspace_id=other["id"]
    )

    assert first["created"] is True
    assert second["created"] is False
    assert second["workspace"]["id"] == first["workspace"]["id"]
    assert conn.execute(
        "SELECT COUNT(*) FROM workspaces WHERE kind = 'job'"
    ).fetchone()[0] == 1
    assert conn.execute(
        "SELECT COUNT(*) FROM application_workspace_origins "
        "WHERE application_workspace_id = ?", (first["workspace"]["id"],)
    ).fetchone()[0] == 2


def test_different_strong_jobs_with_same_fallback_never_merge(tmp_path):
    path = tmp_path / "promotion.db"; init_db(path); conn = connect(path)
    other = create_search_workspace(conn, name="Project Manager")
    base = {
        "schema_version": "job-source-record.v0", "source": "portal-a",
        "captured_at": "2026-08-21T09:00:00+00:00", "company": "Shell",
        "title": "Project Planner", "location": "London", "requirements": [],
        "responsibilities": [], "language_requirements": [],
        "eligibility_requirements": [], "logistics_requirements": [],
    }
    first_candidate = ingest_discovery_record(
        conn,
        {**base, "source_record_id": "vacancy-1", "source_url": "https://jobs.example/1"},
    )["candidate"]
    second_candidate = ingest_discovery_record(
        conn,
        {**base, "source_record_id": "vacancy-2", "source_url": "https://jobs.example/2"},
        search_workspace_id=other["id"],
    )["candidate"]

    first = promote_discovery_candidate(conn, first_candidate["id"])
    second = promote_discovery_candidate(
        conn, second_candidate["id"], search_workspace_id=other["id"]
    )

    assert first["workspace"]["id"] != second["workspace"]["id"]
    assert conn.execute(
        "SELECT COUNT(*) FROM workspaces WHERE kind = 'job'"
    ).fetchone()[0] == 2


def test_strong_to_weak_only_fallback_match_blocks_as_ambiguous(tmp_path):
    path = tmp_path / "promotion.db"; init_db(path); conn = connect(path)
    other = create_search_workspace(conn, name="Project Manager")
    base = {
        "schema_version": "job-source-record.v0", "source": "manual",
        "captured_at": "2026-08-21T09:00:00+00:00", "company": "Shell",
        "title": "Project Planner", "location": "London", "requirements": [],
        "responsibilities": [], "language_requirements": [],
        "eligibility_requirements": [], "logistics_requirements": [],
    }
    strong = ingest_discovery_record(
        conn, {**base, "source_record_id": "vacancy-1"}
    )["candidate"]
    weak = ingest_discovery_record(
        conn,
        base,
        search_workspace_id=other["id"],
    )["candidate"]
    promote_discovery_candidate(conn, strong["id"])

    with pytest.raises(DiscoveryServiceError, match="ambiguous"):
        promote_discovery_candidate(
            conn, weak["id"], search_workspace_id=other["id"]
        )

    assert conn.execute(
        "SELECT COUNT(*) FROM workspaces WHERE kind = 'job'"
    ).fetchone()[0] == 1


def test_two_weak_only_requisitions_never_silently_merge(tmp_path):
    """Regression: matching company/title/location with no strong identity on
    either side, but genuinely different posting content, must never
    auto-promote into the same application workspace — these are two
    distinct requisitions that happen to share weak fields."""
    path = tmp_path / "promotion.db"; init_db(path); conn = connect(path)
    other = create_search_workspace(conn, name="Project Manager")
    base = {
        "schema_version": "job-source-record.v0", "source": "manual",
        "captured_at": "2026-08-21T09:00:00+00:00", "company": "Shell",
        "title": "Project Planner", "location": "London", "requirements": [],
        "responsibilities": [], "language_requirements": [],
        "eligibility_requirements": [], "logistics_requirements": [],
    }
    first_candidate = ingest_discovery_record(
        conn, {**base, "description": "Plan onshore projects."}
    )["candidate"]
    second_candidate = ingest_discovery_record(
        conn,
        {**base, "description": "Plan offshore decommissioning projects."},
        search_workspace_id=other["id"],
    )["candidate"]

    first = promote_discovery_candidate(conn, first_candidate["id"])
    assert first["created"] is True

    with pytest.raises(DiscoveryServiceError, match="ambiguous"):
        promote_discovery_candidate(
            conn, second_candidate["id"], search_workspace_id=other["id"]
        )

    assert conn.execute(
        "SELECT COUNT(*) FROM workspaces WHERE kind = 'job'"
    ).fetchone()[0] == 1


def test_identical_resubmission_of_weak_only_record_is_still_idempotent(tmp_path):
    """A weak-only record resubmitted with identical content (e.g. a retry)
    must still resolve to the same application workspace, not ambiguous."""
    path = tmp_path / "promotion.db"; init_db(path); conn = connect(path)
    source_record = {
        "schema_version": "job-source-record.v0", "source": "manual",
        "captured_at": "2026-08-21T09:00:00+00:00", "company": "Shell",
        "title": "Project Planner", "location": "London",
        "description": "Plan onshore projects.", "requirements": [],
        "responsibilities": [], "language_requirements": [],
        "eligibility_requirements": [], "logistics_requirements": [],
    }
    candidate = ingest_discovery_record(conn, source_record)["candidate"]
    first = promote_discovery_candidate(conn, candidate["id"])

    direct = create_job_from_source_record(
        conn,
        company=source_record["company"],
        title=source_record["title"],
        source_record=source_record,
    )

    assert direct["created"] is False
    assert direct["workspace"]["id"] == first["workspace"]["id"]
    assert conn.execute(
        "SELECT COUNT(*) FROM workspaces WHERE kind = 'job'"
    ).fetchone()[0] == 1


def test_direct_add_and_discovery_promotion_converge_on_one_application(tmp_path):
    path = tmp_path / "promotion.db"; init_db(path); conn = connect(path)
    source_record = {
        "schema_version": "job-source-record.v0", "source": "portal-a",
        "source_record_id": "shared-1", "source_url": "https://jobs.example/shared-1",
        "captured_at": "2026-08-21T09:00:00+00:00", "company": "Energy Co",
        "title": "Project Planner", "location": "London", "requirements": [],
        "responsibilities": [], "language_requirements": [],
        "eligibility_requirements": [], "logistics_requirements": [],
    }
    direct = create_job_from_source_record(
        conn,
        company=source_record["company"],
        title=source_record["title"],
        source_record=source_record,
    )
    candidate = ingest_discovery_record(conn, source_record)["candidate"]

    promoted = promote_discovery_candidate(conn, candidate["id"])

    assert promoted["created"] is False
    assert promoted["workspace"]["id"] == direct["workspace"]["id"]
    assert conn.execute(
        "SELECT COUNT(*) FROM workspaces WHERE kind = 'job'"
    ).fetchone()[0] == 1
