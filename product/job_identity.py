"""Deterministic job identity for global application-workspace resolution.

Discovery may group candidates more broadly inside a search workspace. An
application identity is deliberately conservative because a false merge would
combine independent application histories.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from enum import Enum
from typing import Any
from urllib.parse import urlsplit, urlunsplit


class ApplicationIdentityResolution(str, Enum):
    SAME = "same"
    DISTINCT = "distinct"
    AMBIGUOUS = "ambiguous"


_CONTENT_FIELDS = ("description", "raw_text", "employment_type")


@dataclass(frozen=True)
class JobIdentity:
    source_record_key: str | None
    canonical_url_key: str | None
    weak_fallback_key: str
    content_fingerprint_key: str

    @property
    def has_strong_identity(self) -> bool:
        return self.source_record_key is not None or self.canonical_url_key is not None


def _normalized_text(value: Any) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).split()).casefold()


def _canonical_url(value: str) -> str:
    parsed = urlsplit(unicodedata.normalize("NFKC", value.strip()))
    scheme = parsed.scheme.casefold()
    hostname = (parsed.hostname or "").casefold()
    port = parsed.port
    if port is not None and not (
        (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    ):
        hostname = f"{hostname}:{port}"
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((scheme, hostname, path, parsed.query, ""))


def job_identity(record: dict[str, Any]) -> JobIdentity:
    source_record_id = record.get("source_record_id")
    source_record_key = None
    if source_record_id:
        source_record_key = (
            "source:"
            + _normalized_text(record.get("source"))
            + ":"
            + _normalized_text(source_record_id)
        )

    source_url = record.get("source_url")
    canonical_url_key = "url:" + _canonical_url(source_url) if source_url else None
    weak_fallback_key = "fallback:" + "\x1f".join(
        _normalized_text(record.get(field))
        for field in ("company", "title", "location")
    )
    content_fingerprint_key = "content:" + "\x1f".join(
        _normalized_text(record.get(field)) for field in _CONTENT_FIELDS
    )
    return JobIdentity(
        source_record_key, canonical_url_key, weak_fallback_key, content_fingerprint_key
    )


def compare_job_identities(
    existing: JobIdentity, incoming: JobIdentity
) -> ApplicationIdentityResolution:
    """Apply the locked strong/weak application identity truth table.

    Source-record identity is strongest. When it is comparable on both sides,
    lower-priority keys cannot contradict its decision. Canonical URLs are
    considered next. Weak fallback identity (company/title/location) is never
    sufficient on its own to declare two records the same application. When
    one side carries a strong identity that the other cannot be compared
    against, a matching weak fallback is always AMBIGUOUS regardless of
    content, since a lookalike with no strong identity of its own must never
    claim a specifically identified job. When neither side has any strong
    identity, a matching weak fallback resolves to SAME only when the
    posting content also matches exactly (an idempotent resubmission of the
    same record), and otherwise surfaces as AMBIGUOUS so a false merge
    between two distinct requisitions that merely share company/title/
    location is never silent.
    """

    if existing.source_record_key and incoming.source_record_key:
        if existing.source_record_key == incoming.source_record_key:
            return ApplicationIdentityResolution.SAME
        return ApplicationIdentityResolution.DISTINCT

    if existing.canonical_url_key and incoming.canonical_url_key:
        if existing.canonical_url_key == incoming.canonical_url_key:
            return ApplicationIdentityResolution.SAME
        return ApplicationIdentityResolution.DISTINCT

    weak_matches = existing.weak_fallback_key == incoming.weak_fallback_key
    if not weak_matches:
        return ApplicationIdentityResolution.DISTINCT

    if existing.has_strong_identity or incoming.has_strong_identity:
        return ApplicationIdentityResolution.AMBIGUOUS

    if existing.content_fingerprint_key == incoming.content_fingerprint_key:
        return ApplicationIdentityResolution.SAME

    return ApplicationIdentityResolution.AMBIGUOUS
