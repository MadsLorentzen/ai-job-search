"""Provider-independent job records."""

from dataclasses import dataclass, field
from typing import List, Optional

from app.state.models import RemoteStatus


@dataclass
class Job:
    job_id: str
    title: str
    company: str
    url: str
    description: str = ""
    location: Optional[str] = None
    remote_status: RemoteStatus = RemoteStatus.UNKNOWN
    country: Optional[str] = None
    region: Optional[str] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    salary_currency: Optional[str] = None
    salary_period: Optional[str] = None
    portal: Optional[str] = None
    posted_date: Optional[str] = None
    deadline: Optional[str] = None
    skills: List[str] = field(default_factory=list)


def job_key(company: str, title: str) -> str:
    """Create a stable fallback key when a portal has no identifier."""
    return f"{company.strip().casefold()}::{title.strip().casefold()}"