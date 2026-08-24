from __future__ import annotations

import pytest

from product.job_identity import (
    ApplicationIdentityResolution,
    compare_job_identities,
    job_identity,
)


def _record(
    *,
    source: str = "portal-a",
    source_record_id: str | None = None,
    source_url: str | None = None,
    company: str = "Shell",
    title: str = "Project Planner",
    location: str = "London",
    description: str | None = None,
) -> dict[str, str]:
    record = {
        "source": source,
        "company": company,
        "title": title,
        "location": location,
    }
    if source_record_id is not None:
        record["source_record_id"] = source_record_id
    if source_url is not None:
        record["source_url"] = source_url
    if description is not None:
        record["description"] = description
    return record


@pytest.mark.parametrize(
    ("existing", "incoming", "expected"),
    [
        pytest.param(
            _record(source_record_id="job-1", source_url="https://jobs.example/old"),
            _record(source_record_id="job-1", source_url="https://jobs.example/new"),
            ApplicationIdentityResolution.SAME,
            id="matching-source-record-id-wins-over-changed-url",
        ),
        pytest.param(
            _record(source_record_id="job-1", source_url="https://jobs.example/shared"),
            _record(source_record_id="job-2", source_url="https://jobs.example/shared"),
            ApplicationIdentityResolution.DISTINCT,
            id="different-source-record-ids-never-merge-through-url-or-fallback",
        ),
        pytest.param(
            _record(source_url="https://JOBS.example/roles/77/"),
            _record(source_url="https://jobs.example/roles/77#details"),
            ApplicationIdentityResolution.SAME,
            id="matching-canonical-url-without-comparable-source-ids",
        ),
        pytest.param(
            _record(source_url="https://jobs.example/roles/77"),
            _record(source_url="https://jobs.example/roles/88"),
            ApplicationIdentityResolution.DISTINCT,
            id="different-urls-never-merge-through-fallback",
        ),
        pytest.param(
            _record(source_record_id="job-1", source_url=None),
            _record(source_record_id=None, source_url=None),
            ApplicationIdentityResolution.AMBIGUOUS,
            id="strong-versus-weak-only-match-is-ambiguous",
        ),
        pytest.param(
            _record(source_record_id="job-1", source_url=None),
            _record(
                source_record_id=None,
                source_url=None,
                title="Senior Project Planner",
            ),
            ApplicationIdentityResolution.DISTINCT,
            id="strong-versus-weak-only-nonmatch-is-distinct",
        ),
        pytest.param(
            _record(source_record_id=None, source_url=None, description="Plan projects."),
            _record(source_record_id=None, source_url=None, description="Manage budgets."),
            ApplicationIdentityResolution.AMBIGUOUS,
            id="two-distinct-requisitions-same-company-title-location-are-not-silently-merged",
        ),
        pytest.param(
            _record(source_record_id=None, source_url=None, description="Plan projects."),
            _record(source_record_id=None, source_url=None, description="Plan projects."),
            ApplicationIdentityResolution.SAME,
            id="identical-resubmission-of-same-weak-only-record-is-idempotent",
        ),
        pytest.param(
            _record(source_record_id=None, source_url=None),
            _record(source_record_id=None, source_url=None, location="Aberdeen"),
            ApplicationIdentityResolution.DISTINCT,
            id="different-weak-only-identities-remain-distinct",
        ),
    ],
)
def test_application_identity_resolution_truth_table(existing, incoming, expected):
    assert compare_job_identities(job_identity(existing), job_identity(incoming)) is expected


def test_source_is_part_of_the_strong_source_record_identity():
    existing = job_identity(_record(source="portal-a", source_record_id="job-1"))
    incoming = job_identity(_record(source="portal-b", source_record_id="job-1"))

    assert compare_job_identities(existing, incoming) is ApplicationIdentityResolution.DISTINCT
