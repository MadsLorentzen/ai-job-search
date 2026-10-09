"""Normalize portal records without model calls."""

import hashlib
import re
from typing import Any, Mapping

from app.jobs.models import Job, job_key
from app.state.models import RemoteStatus


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def classify_remote(text: str) -> RemoteStatus:
    value = text.casefold()
    if not value:
        return RemoteStatus.UNKNOWN
    if re.search(r"\bhybrid|partly remote|partially remote|hybridarbejde\b", value):
        return RemoteStatus.HYBRID
    if re.search(r"\bon[- ]?site|office[- ]based|kontor\b", value) and not re.search(r"\bfully remote|remote\b", value):
        return RemoteStatus.ONSITE
    if re.search(r"\bremote\b|\bfjernarbejde\b|\bhjemmearbejde\b", value):
        if re.search(r"worldwide|global|anywhere|work from anywhere", value):
            return RemoteStatus.FULLY_REMOTE_GLOBAL
        if re.search(r"\b(eu|europe(an)?( union)?)\b", value):
            return RemoteStatus.FULLY_REMOTE_REGION_RESTRICTED
        return RemoteStatus.FULLY_REMOTE_COUNTRY_RESTRICTED
    return RemoteStatus.UNKNOWN


def normalize_job(raw: Mapping[str, Any], portal: str | None = None) -> Job:
    title = _text(raw.get("title")) or "Untitled role"
    company = _text(raw.get("company")) or "Unknown company"
    url = _text(raw.get("url"))
    description = _text(raw.get("description"))
    job_id = _text(raw.get("id")) or _text(raw.get("job_id")) or hashlib.sha256(
        job_key(company, title).encode("utf-8")
    ).hexdigest()[:16]
    remote_text = " ".join(filter(None, [_text(raw.get("location")), description]))
    return Job(
        job_id=job_id,
        title=title,
        company=company,
        url=url,
        description=description,
        location=_text(raw.get("location")) or None,
        remote_status=classify_remote(remote_text),
        country=_text(raw.get("country")) or None,
        region=_text(raw.get("region")) or None,
        salary_min=raw.get("salary_min"),
        salary_max=raw.get("salary_max"),
        salary_currency=_text(raw.get("salary_currency")) or None,
        salary_period=_text(raw.get("salary_period")) or None,
        portal=portal or _text(raw.get("portal")) or None,
        posted_date=_text(raw.get("date")) or None,
        deadline=_text(raw.get("deadline")) or None,
        skills=[_text(skill) for skill in raw.get("skills", []) if _text(skill)],
    )