from __future__ import annotations

import pytest

from product.discovery_sources import portal_result_to_source_record
from product.job_ingestion import JobIngestionValidationError, normalize_job_source_record


def test_freehire_search_result_adapts_to_source_record_not_workspace_snapshot():
    result = {
        "id": "planner-abc",
        "title": "Project Planner",
        "company": "Example Energy",
        "company_slug": "example-energy",
        "location": "Aberdeen",
        "date": "2026-08-20",
        "url": "https://freehire.me/jobs/planner-abc",
        "work_mode": "hybrid",
        "regions": ["eu"],
        "countries": ["GB"],
        "skills": ["planning"],
        "description": "Coordinate engineering schedules.",
    }

    record = portal_result_to_source_record(
        "freehire-search", result, "2026-08-21T09:00:00+00:00"
    )

    assert record["schema_version"] == "job-source-record.v0"
    assert record["description"] == "Coordinate engineering schedules."
    assert record["metadata"]["freehire"]["work_mode"] == "hybrid"
    assert normalize_job_source_record(record)["company"] == "Example Energy"


def test_linkedin_detail_adapts_exact_posting_text_and_metadata():
    detail = {
        "id": "4426311357",
        "title": "Project Coordinator",
        "company": "Example Energy",
        "companyUrl": "https://linkedin.com/company/example",
        "location": "London, UK",
        "date": "2026-08-20",
        "url": "https://linkedin.com/jobs/view/project-coordinator-4426311357",
        "description": "Coordinate projects & report progress.",
        "seniority": "Mid-Senior level",
        "employmentType": "Full-time",
        "jobFunction": "Project Management",
        "industries": "Energy",
        "applyUrl": "https://example.test/apply",
    }

    record = portal_result_to_source_record(
        "linkedin-search", detail, "2026-08-21T09:00:00+00:00"
    )

    assert record["description"] == detail["description"]
    assert record["employment_type"] == "Full-time"
    assert record["metadata"]["linkedin"]["applyUrl"] == detail["applyUrl"]


def test_unknown_source_and_incomplete_linkedin_results_are_rejected():
    with pytest.raises(JobIngestionValidationError, match="unsupported discovery source"):
        portal_result_to_source_record("unknown", {}, "2026-08-21T09:00:00+00:00")
    with pytest.raises(JobIngestionValidationError, match="company"):
        portal_result_to_source_record(
            "linkedin-search",
            {"id": "1", "title": "Planner", "company": None, "url": "https://example.test/1"},
            "2026-08-21T09:00:00+00:00",
        )
