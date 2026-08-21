from __future__ import annotations

from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.db import connect, init_db
from webapp.persistence.discovery import ingest_discovery_record
from webapp.services.discovery import promote_discovery_candidate


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
