"""Product-owned Job Posting Snapshot v0 contract.

This module is a behavior-preserving home for the Job Posting validation,
evidence constants, and deterministic content identity originally defined by
``product.job_fit``. It has no candidate, extension, or evaluation imports.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable


SCHEMA_PATH = Path(__file__).with_name("schemas") / "job-fit-contract.v0.schema.json"
CONTRACT_SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

JOB_POSTING_SNAPSHOT_VERSION = CONTRACT_SCHEMA["$defs"]["jobPostingSnapshotVersion"]["const"]
REQUIREMENT_KINDS = set(CONTRACT_SCHEMA["$defs"]["requirementKind"]["enum"])
ID_RE = re.compile(CONTRACT_SCHEMA["$defs"]["id"]["pattern"])

JOB_EVIDENCE_COLLECTIONS = (
    "requirements",
    "responsibilities",
    "language_requirements",
    "eligibility_requirements",
    "logistics_requirements",
)


class JobPostingValidationError(ValueError):
    """Raised when a Job Posting Snapshot is malformed or unsupported."""

    def __init__(self, errors: str | Iterable[str]):
        if isinstance(errors, str):
            self.errors = [errors]
        else:
            self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def validate_job_posting_snapshot(snapshot: Any) -> None:
    """Validate a normalized Job Posting Snapshot v0 object."""

    errors: list[str] = []
    if not _object_shape(
        snapshot,
        {
            "schema_version",
            "job_id",
            "source",
            "captured_at",
            "company",
            "title",
            "requirements",
            "responsibilities",
        },
        {
            "schema_version",
            "job_id",
            "source",
            "source_url",
            "captured_at",
            "company",
            "title",
            "location",
            "employment_type",
            "description",
            "raw_text",
            "requirements",
            "responsibilities",
            "language_requirements",
            "eligibility_requirements",
            "logistics_requirements",
            "compensation",
            "metadata",
        },
        "$.job_snapshot",
        errors,
    ):
        raise JobPostingValidationError(errors)

    if snapshot.get("schema_version") != JOB_POSTING_SNAPSHOT_VERSION:
        errors.append("$.job_snapshot.schema_version: unsupported job snapshot version")
    _id(snapshot.get("job_id"), "$.job_snapshot.job_id", errors)
    for field in ("source", "captured_at", "company", "title"):
        _nonempty_string(snapshot.get(field), f"$.job_snapshot.{field}", errors)
    for field in ("source_url", "location", "employment_type", "description", "raw_text"):
        if field in snapshot:
            _nonempty_string(snapshot[field], f"$.job_snapshot.{field}", errors)
    if "compensation" in snapshot and not isinstance(snapshot["compensation"], dict):
        errors.append("$.job_snapshot.compensation: must be an object")
    if "metadata" in snapshot and not isinstance(snapshot["metadata"], dict):
        errors.append("$.job_snapshot.metadata: must be an object")

    job_evidence_ids(snapshot, errors)
    if errors:
        raise JobPostingValidationError(errors)


def job_evidence_ids(snapshot: dict[str, Any], errors: list[str]) -> set[str]:
    """Return evidence IDs while appending the contract's validation errors."""

    ids: set[str] = set()
    for collection in JOB_EVIDENCE_COLLECTIONS:
        items = snapshot.get(collection, [])
        if collection in {"requirements", "responsibilities"} and collection not in snapshot:
            items = []
        if not isinstance(items, list):
            errors.append(f"$.job_snapshot.{collection}: must be an array")
            continue
        for index, item in enumerate(items):
            path = f"$.job_snapshot.{collection}[{index}]"
            if not _object_shape(
                item,
                {"id", "text", "kind"},
                {"id", "text", "kind", "source_section", "metadata"},
                path,
                errors,
            ):
                continue
            item_id = item.get("id")
            _id(item_id, f"{path}.id", errors)
            if isinstance(item_id, str):
                if item_id in ids:
                    errors.append(f"{path}.id: duplicate job evidence id {item_id!r}")
                ids.add(item_id)
            _nonempty_string(item.get("text"), f"{path}.text", errors)
            _enum(item.get("kind"), REQUIREMENT_KINDS, f"{path}.kind", errors)
            if "source_section" in item:
                _nonempty_string(item["source_section"], f"{path}.source_section", errors)
            if "metadata" in item and not isinstance(item["metadata"], dict):
                errors.append(f"{path}.metadata: must be an object")
    return ids


def job_snapshot_content_id(job: dict[str, Any]) -> str:
    """Return the existing deterministic, non-durable snapshot content ID."""

    try:
        canonical = json.dumps(
            job,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise JobPostingValidationError(
            f"$.jobsnap: content must be canonical JSON: {exc}"
        ) from exc
    return f"jobsnap_{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"


def _object_shape(
    value: Any,
    required: set[str],
    allowed: set[str],
    path: str,
    errors: list[str],
) -> bool:
    if not isinstance(value, dict):
        errors.append(f"{path}: must be an object")
        return False
    keys = set(value)
    for key in sorted(required - keys):
        errors.append(f"{path}.{key}: required field is missing")
    for key in sorted(keys - allowed, key=str):
        errors.append(f"{path}.{key}: unsupported field")
    return required <= keys


def _id(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        errors.append(f"{path}: malformed identifier")


def _nonempty_string(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: must be a non-empty string")


def _enum(value: Any, allowed: set[str], path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or value not in allowed:
        errors.append(f"{path}: must be one of {', '.join(sorted(allowed))}")
