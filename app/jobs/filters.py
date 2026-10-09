"""Deterministic job gates.

Gates are split into two kinds:

* **Hard vetoes** reject a job outright. The only hard veto here is a definite
  location or work-authorization ineligibility, decided by
  :func:`app.jobs.eligibility.evaluate_eligibility`.
* **Soft flags** never reject. Ambiguity, an unstated salary, or a role whose
  work arrangement could not be determined are surfaced to the user instead.

An `unknown` eligibility verdict is a flag, never an acceptance: it is reported
rather than silently dropped, and never silently treated as eligible.
"""

from dataclasses import dataclass, field
from typing import Iterable, Optional

from app.jobs.eligibility import NOT_ELIGIBLE, evaluate_eligibility
from app.jobs.models import Job
from app.state.models import RemoteStatus


@dataclass
class FilterResult:
    accepted: bool
    reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)


def filter_job(
    job: Job,
    *,
    require_remote: bool = False,
    allowed_country: Optional[str] = None,
    minimum_salary: Optional[float] = None,
) -> FilterResult:
    reasons: list[str] = []
    flags: list[str] = []

    # Hard veto: definite location / work-authorization ineligibility. The
    # verdict is computed from the posting text and the country field, so a
    # global marketing phrase can no longer defeat the gate.
    verdict = evaluate_eligibility(job, candidate_country=allowed_country or "KE")
    if verdict.verdict == NOT_ELIGIBLE:
        reasons.extend(verdict.reasons)
    elif verdict.verdict != "eligible":
        flags.append(f"eligibility is unknown: {verdict.reasons[0]}" if verdict.reasons else "eligibility is unknown")
    flags.extend(verdict.notes)

    if require_remote and job.remote_status in {RemoteStatus.HYBRID, RemoteStatus.ONSITE}:
        reasons.append(
            f"remote work required, but the role is {job.remote_status.value}"
        )
    elif require_remote and job.remote_status == RemoteStatus.UNKNOWN:
        flags.append("work arrangement is unknown; confirm whether the role is remote")

    # Compensation is a preference, never a gate. An unstated salary in
    # particular says nothing about whether the role is a fit.
    if minimum_salary is not None:
        if job.salary_min is None and job.salary_max is None:
            flags.append("compensation is not stated")
        elif (job.salary_max or job.salary_min or 0) < minimum_salary:
            flags.append("stated compensation is below the minimum")

    return FilterResult(accepted=not reasons, reasons=reasons, flags=flags)


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