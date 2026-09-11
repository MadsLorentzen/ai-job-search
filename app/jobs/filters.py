"""Deterministic job gates."""

from dataclasses import dataclass, field
from typing import Iterable, Optional

from app.jobs.models import Job
from app.state.models import RemoteStatus


@dataclass
class FilterResult:
    accepted: bool
    reasons: list[str] = field(default_factory=list)


def filter_job(
    job: Job,
    *,
    require_remote: bool = False,
    allowed_country: Optional[str] = None,
    minimum_salary: Optional[float] = None,
) -> FilterResult:
    reasons: list[str] = []
    if require_remote and job.remote_status in {RemoteStatus.HYBRID, RemoteStatus.ONSITE}:
        reasons.append(f"remote status is {job.remote_status.value}")
    if require_remote and job.remote_status == RemoteStatus.UNKNOWN:
        reasons.append("remote eligibility is unknown")
    if allowed_country and job.remote_status == RemoteStatus.FULLY_REMOTE_COUNTRY_RESTRICTED:
        if job.country and job.country.casefold() != allowed_country.casefold():
            reasons.append(f"remote work is restricted to {job.country}")
    if minimum_salary is not None:
        if job.salary_min is None and job.salary_max is None:
            reasons.append("compensation is not stated")
        elif (job.salary_max or job.salary_min or 0) < minimum_salary:
            reasons.append("stated compensation is below the minimum")
    return FilterResult(accepted=not reasons, reasons=reasons)


def deduplicate_jobs(jobs: Iterable[Job]) -> list[Job]:
    """Keep the first record for each stable URL/id/company-title identity."""
    seen: set[str] = set()
    unique: list[Job] = []
    for job in jobs:
        identity = job.url.casefold().rstrip("/") if job.url else job.job_id
        if not identity:
            identity = f"{job.company.casefold()}::{job.title.casefold()}"
        if identity not in seen:
            seen.add(identity)
            unique.append(job)
    return unique