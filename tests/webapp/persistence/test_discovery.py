from __future__ import annotations

from webapp.persistence.db import connect, init_db
from webapp.persistence.discovery import (
    DiscoveryLifecycleError,
    get_discovery_candidate,
    ingest_discovery_record,
    list_discovery_candidates,
    set_discovery_candidate_status,
)


def _record(**overrides):
    record = {
        "schema_version": "job-source-record.v0",
        "source": "freehire-search",
        "source_record_id": "job-42",
        "source_url": "https://jobs.example.test/roles/42",
        "captured_at": "2026-08-21T09:00:00+00:00",
        "company": "Example Energy",
        "title": "Project Planner",
        "location": "Aberdeen, UK",
        "description": "Plan and coordinate complex engineering work.",
        "requirements": [],
        "responsibilities": [],
        "language_requirements": [],
        "eligibility_requirements": [],
        "logistics_requirements": [],
    }
    record.update(overrides)
    record = {key: value for key, value in record.items() if value is not None}
    return record


def _connection(tmp_path):
    path = tmp_path / "discovery.db"
    init_db(path)
    return connect(path)


def test_ingestion_creates_candidate_and_occurrence_but_no_workspace(tmp_path):
    conn = _connection(tmp_path)

    result = ingest_discovery_record(conn, _record())

    assert result["candidate"]["lifecycle_status"] == "new"
    assert result["candidate"]["canonical_source_record"]["source_record_id"] == "job-42"
    assert conn.execute("select count(*) from discovery_occurrences").fetchone()[0] == 1
    assert conn.execute("select count(*) from workspaces").fetchone()[0] == 0


def test_deduplicates_source_id_then_url_then_normalized_fallback(tmp_path):
    conn = _connection(tmp_path)
    first = ingest_discovery_record(conn, _record())

    by_source_id = ingest_discovery_record(
        conn, _record(source_url="https://other.example.test/job/42", captured_at="2026-08-21T10:00:00+00:00")
    )
    by_url = ingest_discovery_record(
        conn,
        _record(
            source="linkedin-search",
            source_record_id="linkedin-99",
            source_url="HTTPS://JOBS.EXAMPLE.TEST/roles/42/#details",
            captured_at="2026-08-21T11:00:00+00:00",
        ),
    )
    by_fallback = ingest_discovery_record(
        conn,
        _record(
            source="manual-import",
            source_record_id=None,
            source_url=None,
            company="  EXAMPLE   ENERGY ",
            title="project planner",
            location="Aberdeen,  UK",
            captured_at="2026-08-21T12:00:00+00:00",
        ),
    )

    ids = {first["candidate"]["id"], by_source_id["candidate"]["id"], by_url["candidate"]["id"], by_fallback["candidate"]["id"]}
    assert len(ids) == 1
    assert conn.execute("select count(*) from discovery_occurrences").fetchone()[0] == 4


def test_repeat_discovery_preserves_decision_until_explicit_resurface(tmp_path):
    conn = _connection(tmp_path)
    candidate_id = ingest_discovery_record(conn, _record())["candidate"]["id"]
    set_discovery_candidate_status(conn, candidate_id, "dismissed")

    repeated = ingest_discovery_record(
        conn, _record(captured_at="2026-08-22T09:00:00+00:00")
    )["candidate"]

    assert repeated["lifecycle_status"] == "dismissed"
    assert set_discovery_candidate_status(conn, candidate_id, "new")["lifecycle_status"] == "new"


def test_lifecycle_allows_save_dismiss_expire_and_explicit_resurface(tmp_path):
    conn = _connection(tmp_path)
    candidate_id = ingest_discovery_record(conn, _record())["candidate"]["id"]

    assert set_discovery_candidate_status(conn, candidate_id, "saved")["lifecycle_status"] == "saved"
    assert set_discovery_candidate_status(conn, candidate_id, "dismissed")["lifecycle_status"] == "dismissed"
    assert set_discovery_candidate_status(conn, candidate_id, "new")["lifecycle_status"] == "new"
    assert set_discovery_candidate_status(conn, candidate_id, "expired")["lifecycle_status"] == "expired"
    assert set_discovery_candidate_status(conn, candidate_id, "new")["lifecycle_status"] == "new"

    try:
        set_discovery_candidate_status(conn, candidate_id, "promoted")
    except DiscoveryLifecycleError as exc:
        assert "promotion service" in str(exc)
    else:
        raise AssertionError("direct promoted transition should be rejected")


def test_list_filters_lifecycle_and_returns_occurrence_count(tmp_path):
    conn = _connection(tmp_path)
    saved_id = ingest_discovery_record(conn, _record())["candidate"]["id"]
    set_discovery_candidate_status(conn, saved_id, "saved")
    ingest_discovery_record(conn, _record(source_record_id="job-43", source_url="https://jobs.example.test/43", title="Scheduler"))

    saved = list_discovery_candidates(conn, lifecycle_status="saved")

    assert [item["id"] for item in saved] == [saved_id]
    assert saved[0]["occurrence_count"] == 1
    assert get_discovery_candidate(conn, saved_id)["canonical_source_record"]["title"] == "Project Planner"
