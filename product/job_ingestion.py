#!/usr/bin/env python3
"""Deterministic ingestion of explicit job-source data.

This module transports caller-supplied facts into Job Posting Snapshot v0. It
does not extract meaning from prose. Empty structured-evidence collections mean
"not explicitly structured", never "the posting contains no such evidence".
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable

from product.job_fit import (
    JOB_POSTING_SNAPSHOT_VERSION,
    REQUIREMENT_KINDS,
    JobFitValidationError,
    validate_job_posting_snapshot,
)


SCHEMA_PATH = Path(__file__).with_name("schemas") / "job-source-record.v0.schema.json"
SOURCE_RECORD_SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
JOB_SOURCE_RECORD_VERSION = SOURCE_RECORD_SCHEMA["$defs"]["jobSourceRecordVersion"]["const"]

EVIDENCE_COLLECTIONS = (
    "requirements",
    "responsibilities",
    "language_requirements",
    "eligibility_requirements",
    "logistics_requirements",
)
EVIDENCE_ID_PREFIXES = {
    "requirements": "req",
    "responsibilities": "resp",
    "language_requirements": "lang",
    "eligibility_requirements": "elig",
    "logistics_requirements": "log",
}
EMPTY_EVIDENCE_SEMANTICS = (
    "Empty evidence collections mean no explicit structured evidence was supplied; "
    "they do not assert that the posting contains no such information."
)
EVIDENCE_ID_SEMANTICS = (
    "Deterministic content-derived identifiers from collection, exact text, and kind; "
    "not durable database identifiers."
)
FREEHIRE_ADAPTER_VERSION = "freehire-detail.v0"
FREEHIRE_DESCRIPTION_PROVENANCE = (
    "Saved Freehire detail CLI description preserved exactly as emitted; the CLI may "
    "have cleaned source HTML, so this is not asserted to be original ATS HTML."
)


class JobIngestionValidationError(ValueError):
    """Raised when job-source input is malformed or cannot be normalized safely."""

    def __init__(self, errors: str | Iterable[str]):
        if isinstance(errors, str):
            self.errors = [errors]
        else:
            self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def validate_job_source_record(record: Any) -> None:
    """Validate explicit Job Source Record v0 input without inferring facts."""

    errors: list[str] = []
    required = {"schema_version", "source", "captured_at", "company", "title"}
    allowed = required | {
        "source_record_id",
        "source_url",
        "location",
        "employment_type",
        "description",
        "raw_text",
        "compensation",
        "metadata",
        *EVIDENCE_COLLECTIONS,
    }
    if not _object_shape(record, required, allowed, "$", errors):
        raise JobIngestionValidationError(errors)

    if record.get("schema_version") != JOB_SOURCE_RECORD_VERSION:
        errors.append("$.schema_version: unsupported job source record version")
    for field in ("source", "captured_at", "company", "title"):
        _nonempty_string(record.get(field), f"$.{field}", errors)
    for field in (
        "source_record_id",
        "source_url",
        "location",
        "employment_type",
        "description",
        "raw_text",
    ):
        if field in record:
            _nonempty_string(record.get(field), f"$.{field}", errors)

    for field in ("compensation", "metadata"):
        if field in record:
            value = record.get(field)
            if not isinstance(value, dict):
                errors.append(f"$.{field}: must be an object")
            else:
                _json_value(value, f"$.{field}", errors)

    for collection in EVIDENCE_COLLECTIONS:
        _validate_evidence_collection(record.get(collection, []), collection, errors)

    if errors:
        raise JobIngestionValidationError(errors)


def normalize_job_source_record(record: Any) -> dict[str, Any]:
    """Normalize explicit source facts into a validated Job Posting Snapshot v0."""

    validate_job_source_record(record)
    source_record = copy.deepcopy(record)
    snapshot: dict[str, Any] = {
        "schema_version": JOB_POSTING_SNAPSHOT_VERSION,
        "job_id": _job_id(source_record),
        "source": source_record["source"],
        "captured_at": source_record["captured_at"],
        "company": source_record["company"],
        "title": source_record["title"],
        "requirements": _normalize_evidence_collection(
            source_record.get("requirements", []), "requirements"
        ),
        "responsibilities": _normalize_evidence_collection(
            source_record.get("responsibilities", []), "responsibilities"
        ),
        "language_requirements": _normalize_evidence_collection(
            source_record.get("language_requirements", []), "language_requirements"
        ),
        "eligibility_requirements": _normalize_evidence_collection(
            source_record.get("eligibility_requirements", []), "eligibility_requirements"
        ),
        "logistics_requirements": _normalize_evidence_collection(
            source_record.get("logistics_requirements", []), "logistics_requirements"
        ),
        "metadata": _snapshot_metadata(source_record),
    }
    for field in (
        "source_url",
        "location",
        "employment_type",
        "description",
        "raw_text",
        "compensation",
    ):
        if field in source_record:
            snapshot[field] = copy.deepcopy(source_record[field])

    try:
        validate_job_posting_snapshot(snapshot)
    except JobFitValidationError as exc:
        raise JobIngestionValidationError(
            [f"$.normalized_job_snapshot: {error}" for error in exc.errors]
        ) from exc
    return snapshot


def job_evidence_id(collection: str, text: str, kind: str) -> str:
    """Return a deterministic content ID, not a durable database identifier."""

    if collection not in EVIDENCE_ID_PREFIXES:
        raise JobIngestionValidationError("$.evidence.collection: unsupported collection")
    if not isinstance(text, str) or not text.strip():
        raise JobIngestionValidationError("$.evidence.text: must be a non-empty string")
    if not isinstance(kind, str) or kind not in REQUIREMENT_KINDS:
        raise JobIngestionValidationError("$.evidence.kind: unsupported requirement kind")
    material = json.dumps(
        {"collection": collection, "kind": kind, "text": text},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]
    return f"jobev_{EVIDENCE_ID_PREFIXES[collection]}_{digest}"


def validate_freehire_detail(detail: Any) -> None:
    """Validate saved Freehire detail CLI JSON without making a network call."""

    errors: list[str] = []
    required = {"id", "title", "company", "url"}
    optional_strings = {
        "company_slug",
        "location",
        "date",
        "work_mode",
        "description",
        "seniority",
        "category",
        "employment_type",
        "salary",
    }
    optional_arrays = {"regions", "countries", "skills", "cities"}
    allowed = required | optional_strings | optional_arrays
    if not _object_shape(detail, required, allowed, "$.freehire_detail", errors):
        raise JobIngestionValidationError(errors)

    for field in sorted(required):
        _nonempty_string(detail.get(field), f"$.freehire_detail.{field}", errors)
    for field in sorted(optional_strings):
        if field in detail and detail.get(field) is not None:
            _nonempty_string(detail.get(field), f"$.freehire_detail.{field}", errors)
    for field in sorted(optional_arrays):
        if field in detail:
            _string_list(detail.get(field), f"$.freehire_detail.{field}", errors)

    if errors:
        raise JobIngestionValidationError(errors)


def normalize_freehire_detail(detail: Any, captured_at: Any) -> dict[str, Any]:
    """Normalize one saved Freehire detail result; never fetch live data."""

    validate_freehire_detail(detail)
    capture_errors: list[str] = []
    _nonempty_string(captured_at, "$.captured_at", capture_errors)
    if capture_errors:
        raise JobIngestionValidationError(capture_errors)

    saved = copy.deepcopy(detail)
    freehire_metadata = {
        field: copy.deepcopy(saved[field])
        for field in (
            "company_slug",
            "date",
            "work_mode",
            "regions",
            "countries",
            "skills",
            "cities",
            "seniority",
            "category",
        )
        if field in saved
    }
    source_record: dict[str, Any] = {
        "schema_version": JOB_SOURCE_RECORD_VERSION,
        "source": "freehire-search",
        "source_record_id": saved["id"],
        "source_url": saved["url"],
        "captured_at": captured_at,
        "company": saved["company"],
        "title": saved["title"],
        "requirements": [],
        "responsibilities": [],
        "language_requirements": [],
        "eligibility_requirements": [],
        "logistics_requirements": [],
        "metadata": {
            "adapter": FREEHIRE_ADAPTER_VERSION,
            "description_provenance": FREEHIRE_DESCRIPTION_PROVENANCE,
            "freehire": freehire_metadata,
        },
    }
    for field in ("location", "employment_type"):
        if saved.get(field) is not None:
            source_record[field] = saved[field]
    if saved.get("description") is not None:
        source_record["description"] = saved["description"]
    if saved.get("salary") is not None:
        source_record["compensation"] = {"text": saved["salary"]}

    return normalize_job_source_record(source_record)


def _validate_evidence_collection(
    value: Any,
    collection: str,
    errors: list[str],
) -> None:
    path = f"$.{collection}"
    items = _list(value, path, errors)
    seen: set[str] = set()
    for index, item in enumerate(items):
        item_path = f"{path}[{index}]"
        if not _object_shape(
            item,
            {"text", "kind"},
            {"text", "kind", "source_section", "metadata"},
            item_path,
            errors,
        ):
            continue
        text = item.get("text")
        kind = item.get("kind")
        _nonempty_string(text, f"{item_path}.text", errors)
        _enum(kind, REQUIREMENT_KINDS, f"{item_path}.kind", errors)
        if "source_section" in item:
            _nonempty_string(item.get("source_section"), f"{item_path}.source_section", errors)
        if "metadata" in item:
            metadata = item.get("metadata")
            if not isinstance(metadata, dict):
                errors.append(f"{item_path}.metadata: must be an object")
            else:
                _json_value(metadata, f"{item_path}.metadata", errors)
        if (
            isinstance(text, str)
            and text.strip()
            and isinstance(kind, str)
            and kind in REQUIREMENT_KINDS
        ):
            evidence_id = job_evidence_id(collection, text, kind)
            if evidence_id in seen:
                errors.append(
                    f"{item_path}: duplicate evidence has content-derived id {evidence_id!r}"
                )
            seen.add(evidence_id)


def _normalize_evidence_collection(
    items: list[dict[str, Any]],
    collection: str,
) -> list[dict[str, Any]]:
    normalized = []
    for item in items:
        output = {
            "id": job_evidence_id(collection, item["text"], item["kind"]),
            "text": item["text"],
            "kind": item["kind"],
        }
        for field in ("source_section", "metadata"):
            if field in item:
                output[field] = copy.deepcopy(item[field])
        normalized.append(output)
    return normalized


def _job_id(record: dict[str, Any]) -> str:
    if "source_record_id" in record:
        anchor = {"source": record["source"], "source_record_id": record["source_record_id"]}
    elif "source_url" in record:
        anchor = {"source": record["source"], "source_url": record["source_url"]}
    else:
        anchor = {
            "source": record["source"],
            "company": record["company"],
            "title": record["title"],
        }
        if "location" in record:
            anchor["location"] = record["location"]
    material = json.dumps(
        anchor,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:20]
    return f"jobsrc_{digest}"


def _snapshot_metadata(record: dict[str, Any]) -> dict[str, Any]:
    ingestion = {
        "source_record_schema_version": record["schema_version"],
        "empty_evidence_semantics": EMPTY_EVIDENCE_SEMANTICS,
        "evidence_id_semantics": EVIDENCE_ID_SEMANTICS,
        "job_id_semantics": (
            "Deterministic source-anchor identifier for ingestion; not a durable "
            "database identifier."
        ),
    }
    if "source_record_id" in record:
        ingestion["source_record_id"] = record["source_record_id"]
    output = {"ingestion": ingestion}
    if "metadata" in record:
        output["source_metadata"] = copy.deepcopy(record["metadata"])
    return output


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


def _list(value: Any, path: str, errors: list[str]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(f"{path}: must be an array")
        return []
    return value


def _string_list(value: Any, path: str, errors: list[str]) -> list[str]:
    items = _list(value, path, errors)
    output = []
    for index, item in enumerate(items):
        if not isinstance(item, str) or not item.strip():
            errors.append(f"{path}[{index}]: must be a non-empty string")
        else:
            output.append(item)
    return output


def _nonempty_string(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: must be a non-empty string")


def _enum(value: Any, allowed: set[str], path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or value not in allowed:
        errors.append(f"{path}: must be one of {', '.join(sorted(allowed))}")


def _json_value(value: Any, path: str, errors: list[str]) -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            errors.append(f"{path}: number must be finite")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _json_value(item, f"{path}[{index}]", errors)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                errors.append(f"{path}: object keys must be strings")
                continue
            _json_value(item, f"{path}.{key}", errors)
        return
    errors.append(f"{path}: must contain only JSON-compatible values")


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Normalize saved job-source data")
    commands = parser.add_subparsers(dest="command", required=True)
    normalize = commands.add_parser("normalize", help="normalize Job Source Record v0")
    normalize.add_argument("source", type=Path)
    freehire = commands.add_parser(
        "normalize-freehire", help="normalize saved Freehire detail JSON"
    )
    freehire.add_argument("detail", type=Path)
    freehire.add_argument("--captured-at", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.command == "normalize":
            snapshot = normalize_job_source_record(_load_json(args.source))
        else:
            snapshot = normalize_freehire_detail(
                _load_json(args.detail), args.captured_at
            )
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))
    except (
        JobIngestionValidationError,
        JobFitValidationError,
        FileNotFoundError,
        OSError,
        UnicodeError,
        json.JSONDecodeError,
    ) as exc:
        errors = exc.errors if hasattr(exc, "errors") else [str(exc)]
        print(
            json.dumps({"valid": False, "errors": errors}, ensure_ascii=False),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
