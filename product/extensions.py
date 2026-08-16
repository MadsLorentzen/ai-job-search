#!/usr/bin/env python3
"""Passive Extension Package v0 loading, validation, and inspection.

Extensions contain reusable professional knowledge. They never contain private
candidate facts and are never imported or executed as code. Candidate evidence
belongs to the separate profile snapshot contract.

Package layout:

    extensions/<extension-id>/extension.json

The loader also accepts a direct path to an ``extension.json`` file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any, Iterable


SCHEMA_PATH = Path(__file__).with_name("schemas") / "extension-package.v0.schema.json"
# The machine-readable schema owns shared lexical constraints and enums.
# Python validation adds cross-record references and other relational rules.
SCHEMA_CONTRACT = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
SCHEMA_VERSION = SCHEMA_CONTRACT["properties"]["schema_version"]["const"]

ID_RE = re.compile(SCHEMA_CONTRACT["$defs"]["id"]["pattern"])
SEMVER_RE = re.compile(SCHEMA_CONTRACT["$defs"]["semver"]["pattern"])
DATE_RE = re.compile(SCHEMA_CONTRACT["$defs"]["date"]["pattern"])

STATUSES = set(SCHEMA_CONTRACT["properties"]["status"]["enum"])
TRUST_LEVELS = set(SCHEMA_CONTRACT["$defs"]["trust"]["properties"]["level"]["enum"])
PUBLISHER_TYPES = set(
    SCHEMA_CONTRACT["$defs"]["publisher"]["properties"]["type"]["enum"]
)
SENIORITY_LEVELS = set(SCHEMA_CONTRACT["$defs"]["seniority"]["enum"])
SOURCE_TYPES = set(
    SCHEMA_CONTRACT["$defs"]["source"]["properties"]["source_type"]["enum"]
)
REQUIREMENT_TYPES = set(
    SCHEMA_CONTRACT["$defs"]["certification"]["properties"]["requirement_type"]["enum"]
)
TRANSFER_STRENGTHS = set(
    SCHEMA_CONTRACT["$defs"]["transferableMapping"]["properties"]
    ["transfer_strength"]["enum"]
)
PROHIBITED_INFERENCES = set(
    SCHEMA_CONTRACT["$defs"]["disallowedMapping"]["properties"]
    ["prohibited_inference"]["enum"]
)

PRIVATE_FIELD_NAMES = {
    "candidateaddress", "candidateapplicationhistory", "candidateemail",
    "candidateemploymenthistory", "candidateid", "candidatelinkedin",
    "candidatename", "candidatephone", "candidateprofile", "personaladdress",
    "personalemail", "personalgithub", "personallinkedin", "personalphone",
    "applicationhistory", "employmenthistory",
}
EXECUTABLE_FIELD_NAMES = {
    "command", "commands", "executable", "hook", "hooks", "javascript",
    "lifecycle", "python", "script", "scripts", "shell",
}


class ExtensionValidationError(ValueError):
    """Raised when extension data violates the v0 contract."""

    def __init__(self, errors: str | Iterable[str]):
        if isinstance(errors, str):
            self.errors = [errors]
        else:
            self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def load_extension(path: str | Path) -> dict[str, Any]:
    """Read and validate one passive extension package without mutation."""

    extension_path = Path(path)
    if extension_path.is_dir():
        extension_path = extension_path / "extension.json"
    if not extension_path.is_file():
        raise FileNotFoundError(f"extension file not found: {extension_path}")
    try:
        data = json.loads(extension_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ExtensionValidationError(
            f"invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    validate_extension(data)
    return data


def load_extensions(paths: Iterable[str | Path]) -> list[dict[str, Any]]:
    """Load packages in caller order and reject duplicate id/version pairs."""

    extensions: list[dict[str, Any]] = []
    identities: set[tuple[str, str]] = set()
    for path in paths:
        extension = load_extension(path)
        identity = (extension["id"], extension["version"])
        if identity in identities:
            raise ExtensionValidationError(
                f"duplicate extension package: {identity[0]}@{identity[1]}"
            )
        identities.add(identity)
        extensions.append(extension)
    return extensions


def validate_extension(extension: Any) -> None:
    """Validate Extension Package v0 using the Python standard library."""

    errors: list[str] = []
    _reject_boundary_fields(extension, "$", errors)
    if not isinstance(extension, dict):
        raise ExtensionValidationError(errors or ["$: extension must be an object"])

    top_allowed = {
        "schema_version", "id", "name", "version", "status", "description",
        "publisher", "authors", "trust", "metadata", "scope", "sources",
        "terminology", "competencies", "roles", "certifications",
        "transferable_mappings", "disallowed_mappings", "interview_knowledge",
    }
    _object_shape(
        extension,
        required={
            "schema_version", "id", "name", "version", "status", "description",
            "publisher", "trust", "metadata", "scope",
        },
        allowed=top_allowed,
        path="$",
        errors=errors,
    )

    if extension.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"$.schema_version: unsupported schema version; expected {SCHEMA_VERSION!r}")
    _id(extension.get("id"), "$.id", errors)
    _nonempty_string(extension.get("name"), "$.name", errors)
    version = extension.get("version")
    if not isinstance(version, str) or not SEMVER_RE.fullmatch(version):
        errors.append("$.version: must be a semantic version such as '0.1.0'")
    _enum(extension.get("status"), STATUSES, "$.status", errors)
    _nonempty_string(extension.get("description"), "$.description", errors)

    _validate_publisher(extension.get("publisher"), "$.publisher", errors)
    _validate_authors(extension.get("authors", []), "$.authors", errors)
    _validate_trust(extension.get("trust"), "$.trust", errors)
    _validate_metadata(extension.get("metadata"), "$.metadata", errors)
    _validate_scope(extension.get("scope"), "$.scope", errors)

    sources = _list(extension.get("sources", []), "$.sources", errors)
    source_ids = _validate_sources(sources, errors)
    terminology = _list(extension.get("terminology", []), "$.terminology", errors)
    _validate_terminology(terminology, source_ids, errors)
    competencies = _list(extension.get("competencies", []), "$.competencies", errors)
    competency_ids = _validate_competencies(competencies, source_ids, errors)
    roles = _list(extension.get("roles", []), "$.roles", errors)
    _validate_roles(roles, competency_ids, source_ids, errors)
    certifications = _list(
        extension.get("certifications", []), "$.certifications", errors
    )
    _validate_certifications(certifications, source_ids, errors)
    mappings = _list(
        extension.get("transferable_mappings", []),
        "$.transferable_mappings",
        errors,
    )
    _validate_transferable_mappings(mappings, competency_ids, source_ids, errors)
    disallowed = _list(
        extension.get("disallowed_mappings", []), "$.disallowed_mappings", errors
    )
    _validate_disallowed_mappings(disallowed, source_ids, errors)
    interview = _list(
        extension.get("interview_knowledge", []), "$.interview_knowledge", errors
    )
    _validate_interview_knowledge(interview, source_ids, errors)

    if errors:
        raise ExtensionValidationError(errors)


def normalized_extension(extension: dict[str, Any]) -> dict[str, Any]:
    """Return a validated, deep-copied object with deterministic key ordering."""

    validate_extension(extension)
    return json.loads(normalized_extension_json(extension))


def normalized_extension_json(extension: dict[str, Any]) -> str:
    """Return canonical JSON while preserving semantically ordered arrays."""

    validate_extension(extension)
    return json.dumps(
        extension,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def extension_content_id(extension: dict[str, Any]) -> str:
    """Return a deterministic content-derived identifier, not a durable ID."""

    digest = hashlib.sha256(normalized_extension_json(extension).encode("utf-8")).hexdigest()
    return f"extpkg_{digest[:20]}"


def _validate_publisher(value: Any, path: str, errors: list[str]) -> None:
    if not _object_shape(
        value, {"name", "type"}, {"name", "type", "url"}, path, errors
    ):
        return
    _nonempty_string(value.get("name"), f"{path}.name", errors)
    _enum(value.get("type"), PUBLISHER_TYPES, f"{path}.type", errors)
    if "url" in value:
        _url(value["url"], f"{path}.url", errors)


def _validate_authors(value: Any, path: str, errors: list[str]) -> None:
    authors = _list(value, path, errors)
    for index, author in enumerate(authors):
        item_path = f"{path}[{index}]"
        if not _object_shape(
            author, {"name"}, {"name", "organization", "url"}, item_path, errors
        ):
            continue
        _nonempty_string(author.get("name"), f"{item_path}.name", errors)
        if "organization" in author:
            _nonempty_string(
                author["organization"], f"{item_path}.organization", errors
            )
        if "url" in author:
            _url(author["url"], f"{item_path}.url", errors)


def _validate_trust(value: Any, path: str, errors: list[str]) -> None:
    if not _object_shape(value, {"level"}, {"level", "notes"}, path, errors):
        return
    _enum(value.get("level"), TRUST_LEVELS, f"{path}.level", errors)
    if "notes" in value:
        _nonempty_string(value["notes"], f"{path}.notes", errors)


def _validate_metadata(value: Any, path: str, errors: list[str]) -> None:
    if not _object_shape(
        value,
        {"created_date"},
        {"created_date", "reviewed_date"},
        path,
        errors,
    ):
        return
    _date(value.get("created_date"), f"{path}.created_date", errors)
    if value.get("reviewed_date") is not None:
        _date(value.get("reviewed_date"), f"{path}.reviewed_date", errors)


def _validate_scope(value: Any, path: str, errors: list[str]) -> None:
    allowed = {
        "industries", "professions", "role_families", "role_titles",
        "role_aliases", "seniority_levels", "jurisdictions",
    }
    if not _object_shape(value, set(), allowed, path, errors):
        return
    for field in allowed - {"seniority_levels"}:
        _string_list(value.get(field, []), f"{path}.{field}", errors)
    for index, seniority in enumerate(
        _list(value.get("seniority_levels", []), f"{path}.seniority_levels", errors)
    ):
        _enum(seniority, SENIORITY_LEVELS, f"{path}.seniority_levels[{index}]", errors)


def _validate_sources(sources: list[Any], errors: list[str]) -> set[str]:
    ids: set[str] = set()
    allowed = {
        "id", "title", "publisher", "url", "source_type", "jurisdiction",
        "publication_date", "reviewed_date", "notes",
    }
    for index, source in enumerate(sources):
        path = f"$.sources[{index}]"
        if not _object_shape(
            source, {"id", "title", "publisher", "source_type"}, allowed, path, errors
        ):
            continue
        source_id = source.get("id")
        _id(source_id, f"{path}.id", errors)
        if isinstance(source_id, str):
            if source_id in ids:
                errors.append(f"{path}.id: duplicate source id {source_id!r}")
            ids.add(source_id)
        _nonempty_string(source.get("title"), f"{path}.title", errors)
        _nonempty_string(source.get("publisher"), f"{path}.publisher", errors)
        _enum(source.get("source_type"), SOURCE_TYPES, f"{path}.source_type", errors)
        if "url" in source:
            _url(source["url"], f"{path}.url", errors)
        if "jurisdiction" in source:
            _nonempty_string(
                source["jurisdiction"], f"{path}.jurisdiction", errors
            )
        for field in ("publication_date", "reviewed_date"):
            if field in source:
                _date(source[field], f"{path}.{field}", errors)
        if "notes" in source:
            _nonempty_string(source["notes"], f"{path}.notes", errors)
    return ids


def _validate_terminology(
    records: list[Any], source_ids: set[str], errors: list[str]
) -> None:
    allowed = {"id", "canonical_term", "aliases", "definition", "category", "source_ids"}
    seen: set[str] = set()
    for index, record in enumerate(records):
        path = f"$.terminology[{index}]"
        if not _object_shape(
            record,
            {"id", "canonical_term", "definition", "category"},
            allowed,
            path,
            errors,
        ):
            continue
        _unique_record_id(record, path, seen, "terminology", errors)
        _nonempty_string(record.get("canonical_term"), f"{path}.canonical_term", errors)
        _nonempty_string(record.get("definition"), f"{path}.definition", errors)
        _nonempty_string(record.get("category"), f"{path}.category", errors)
        _string_list(record.get("aliases", []), f"{path}.aliases", errors)
        _source_references(record.get("source_ids", []), source_ids, f"{path}.source_ids", errors)


def _validate_competencies(
    records: list[Any], source_ids: set[str], errors: list[str]
) -> set[str]:
    allowed = {
        "id", "name", "description", "category", "skills", "tools", "methods",
        "responsibilities", "expectations", "source_ids",
    }
    ids: set[str] = set()
    for index, record in enumerate(records):
        path = f"$.competencies[{index}]"
        if not _object_shape(
            record, {"id", "name", "description", "category"}, allowed, path, errors
        ):
            continue
        _unique_record_id(record, path, ids, "competency", errors)
        _nonempty_string(record.get("name"), f"{path}.name", errors)
        _nonempty_string(record.get("description"), f"{path}.description", errors)
        _nonempty_string(record.get("category"), f"{path}.category", errors)
        for field in ("skills", "tools", "methods", "responsibilities"):
            _string_list(record.get(field, []), f"{path}.{field}", errors)
        for expectation_index, expectation in enumerate(
            _list(record.get("expectations", []), f"{path}.expectations", errors)
        ):
            expectation_path = f"{path}.expectations[{expectation_index}]"
            if _object_shape(
                expectation,
                {"seniority", "description"},
                {"seniority", "description"},
                expectation_path,
                errors,
            ):
                _enum(
                    expectation.get("seniority"),
                    SENIORITY_LEVELS,
                    f"{expectation_path}.seniority",
                    errors,
                )
                _nonempty_string(
                    expectation.get("description"),
                    f"{expectation_path}.description",
                    errors,
                )
        _source_references(record.get("source_ids", []), source_ids, f"{path}.source_ids", errors)
    return ids


def _validate_roles(
    records: list[Any],
    competency_ids: set[str],
    source_ids: set[str],
    errors: list[str],
) -> None:
    allowed = {
        "id", "name", "aliases", "role_family", "seniority_levels",
        "expected_competency_ids", "typical_expectations", "source_ids",
    }
    ids: set[str] = set()
    for index, record in enumerate(records):
        path = f"$.roles[{index}]"
        if not _object_shape(record, {"id", "name"}, allowed, path, errors):
            continue
        _unique_record_id(record, path, ids, "role", errors)
        _nonempty_string(record.get("name"), f"{path}.name", errors)
        if "role_family" in record:
            _nonempty_string(record["role_family"], f"{path}.role_family", errors)
        _string_list(record.get("aliases", []), f"{path}.aliases", errors)
        _string_list(
            record.get("typical_expectations", []),
            f"{path}.typical_expectations",
            errors,
        )
        for seniority_index, seniority in enumerate(
            _list(record.get("seniority_levels", []), f"{path}.seniority_levels", errors)
        ):
            _enum(
                seniority,
                SENIORITY_LEVELS,
                f"{path}.seniority_levels[{seniority_index}]",
                errors,
            )
        _competency_references(
            record.get("expected_competency_ids", []),
            competency_ids,
            f"{path}.expected_competency_ids",
            errors,
        )
        _source_references(record.get("source_ids", []), source_ids, f"{path}.source_ids", errors)


def _validate_certifications(
    records: list[Any], source_ids: set[str], errors: list[str]
) -> None:
    allowed = {
        "id", "name", "aliases", "issuer", "jurisdiction", "requirement_type",
        "notes", "source_ids",
    }
    ids: set[str] = set()
    for index, record in enumerate(records):
        path = f"$.certifications[{index}]"
        if not _object_shape(
            record, {"id", "name", "issuer", "requirement_type"}, allowed, path, errors
        ):
            continue
        _unique_record_id(record, path, ids, "certification", errors)
        _nonempty_string(record.get("name"), f"{path}.name", errors)
        _nonempty_string(record.get("issuer"), f"{path}.issuer", errors)
        _enum(
            record.get("requirement_type"),
            REQUIREMENT_TYPES,
            f"{path}.requirement_type",
            errors,
        )
        _string_list(record.get("aliases", []), f"{path}.aliases", errors)
        if "jurisdiction" in record:
            _nonempty_string(record["jurisdiction"], f"{path}.jurisdiction", errors)
        if "notes" in record:
            _nonempty_string(record["notes"], f"{path}.notes", errors)
        references = record.get("source_ids", [])
        _source_references(references, source_ids, f"{path}.source_ids", errors)
        if record.get("requirement_type") == "legally-required" and not references:
            errors.append(
                f"{path}.source_ids: legally-required qualifications need provenance"
            )


def _validate_transferable_mappings(
    records: list[Any],
    competency_ids: set[str],
    source_ids: set[str],
    errors: list[str],
) -> None:
    allowed = {
        "id", "source", "target", "rationale", "transfer_strength", "conditions",
        "limitations", "evidence_requirements", "source_ids",
    }
    ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for index, record in enumerate(records):
        path = f"$.transferable_mappings[{index}]"
        if not _object_shape(
            record,
            {"id", "source", "target", "rationale", "transfer_strength"},
            allowed,
            path,
            errors,
        ):
            continue
        _unique_record_id(record, path, ids, "transferable mapping", errors)
        source_key = _validate_mapping_endpoint(
            record.get("source"), competency_ids, f"{path}.source", errors
        )
        target_key = _validate_mapping_endpoint(
            record.get("target"), competency_ids, f"{path}.target", errors
        )
        if source_key and target_key:
            pair = (source_key, target_key)
            if pair in pairs:
                errors.append(f"{path}: duplicate transferable mapping {source_key!r} -> {target_key!r}")
            pairs.add(pair)
            if source_key == target_key:
                errors.append(f"{path}: source and target must be different")
        _nonempty_string(record.get("rationale"), f"{path}.rationale", errors)
        _enum(
            record.get("transfer_strength"),
            TRANSFER_STRENGTHS,
            f"{path}.transfer_strength",
            errors,
        )
        for field in ("conditions", "limitations", "evidence_requirements"):
            _string_list(record.get(field, []), f"{path}.{field}", errors)
        _source_references(record.get("source_ids", []), source_ids, f"{path}.source_ids", errors)


def _validate_mapping_endpoint(
    value: Any, competency_ids: set[str], path: str, errors: list[str]
) -> str | None:
    if not _object_shape(value, set(), {"competency_id", "concept"}, path, errors):
        return None
    keys = [key for key in ("competency_id", "concept") if key in value]
    if len(keys) != 1:
        errors.append(f"{path}: provide exactly one of competency_id or concept")
        return None
    key = keys[0]
    item = value[key]
    if key == "competency_id":
        _id(item, f"{path}.competency_id", errors)
        if isinstance(item, str) and item not in competency_ids:
            errors.append(f"{path}.competency_id: unknown competency id {item!r}")
    else:
        _nonempty_string(item, f"{path}.concept", errors)
    return f"{key}:{item}" if isinstance(item, str) else None


def _validate_disallowed_mappings(
    records: list[Any], source_ids: set[str], errors: list[str]
) -> None:
    allowed = {"id", "source_concept", "prohibited_inference", "rationale", "source_ids"}
    ids: set[str] = set()
    for index, record in enumerate(records):
        path = f"$.disallowed_mappings[{index}]"
        if not _object_shape(
            record,
            {"id", "source_concept", "prohibited_inference", "rationale"},
            allowed,
            path,
            errors,
        ):
            continue
        _unique_record_id(record, path, ids, "disallowed mapping", errors)
        _nonempty_string(record.get("source_concept"), f"{path}.source_concept", errors)
        _enum(
            record.get("prohibited_inference"),
            PROHIBITED_INFERENCES,
            f"{path}.prohibited_inference",
            errors,
        )
        _nonempty_string(record.get("rationale"), f"{path}.rationale", errors)
        _source_references(record.get("source_ids", []), source_ids, f"{path}.source_ids", errors)


def _validate_interview_knowledge(
    records: list[Any], source_ids: set[str], errors: list[str]
) -> None:
    allowed = {"id", "topic", "why_it_matters", "question_themes", "concepts", "source_ids"}
    ids: set[str] = set()
    for index, record in enumerate(records):
        path = f"$.interview_knowledge[{index}]"
        if not _object_shape(
            record, {"id", "topic", "why_it_matters"}, allowed, path, errors
        ):
            continue
        _unique_record_id(record, path, ids, "interview knowledge", errors)
        _nonempty_string(record.get("topic"), f"{path}.topic", errors)
        _nonempty_string(record.get("why_it_matters"), f"{path}.why_it_matters", errors)
        _string_list(record.get("question_themes", []), f"{path}.question_themes", errors)
        _string_list(record.get("concepts", []), f"{path}.concepts", errors)
        _source_references(record.get("source_ids", []), source_ids, f"{path}.source_ids", errors)


def _reject_boundary_fields(value: Any, path: str, errors: list[str]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).casefold())
            item_path = f"{path}.{key}"
            if normalized in PRIVATE_FIELD_NAMES:
                errors.append(
                    f"{item_path}: candidate-private fields are prohibited in extensions"
                )
            if normalized in EXECUTABLE_FIELD_NAMES:
                errors.append(
                    f"{item_path}: executable behavior fields are prohibited in passive extensions"
                )
            _reject_boundary_fields(item, item_path, errors)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _reject_boundary_fields(item, f"{path}[{index}]", errors)


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
    missing = required - value.keys()
    unknown = value.keys() - allowed
    for key in sorted(missing):
        errors.append(f"{path}.{key}: required field is missing")
    for key in sorted(unknown):
        errors.append(f"{path}.{key}: unsupported field")
    return not missing


def _list(value: Any, path: str, errors: list[str]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(f"{path}: must be an array")
        return []
    return value


def _nonempty_string(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: must be a non-empty string")


def _url(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not re.fullmatch(r"https?://\S+", value):
        errors.append(f"{path}: must be an http(s) URL")


def _id(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        errors.append(f"{path}: must be a lowercase kebab-case identifier")


def _enum(value: Any, allowed: set[str], path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or value not in allowed:
        errors.append(f"{path}: must be one of {', '.join(sorted(allowed))}")


def _date(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not DATE_RE.fullmatch(value):
        errors.append(f"{path}: must be a YYYY-MM-DD date")
        return
    try:
        date.fromisoformat(value)
    except ValueError:
        errors.append(f"{path}: must be a real calendar date")


def _string_list(value: Any, path: str, errors: list[str]) -> list[str]:
    items = _list(value, path, errors)
    seen: set[str] = set()
    for index, item in enumerate(items):
        _nonempty_string(item, f"{path}[{index}]", errors)
        if isinstance(item, str):
            normalized = item.casefold().strip()
            if normalized in seen:
                errors.append(f"{path}[{index}]: duplicate value {item!r}")
            seen.add(normalized)
    return [item for item in items if isinstance(item, str)]


def _unique_record_id(
    record: dict[str, Any],
    path: str,
    seen: set[str],
    label: str,
    errors: list[str],
) -> None:
    record_id = record.get("id")
    _id(record_id, f"{path}.id", errors)
    if isinstance(record_id, str):
        if record_id in seen:
            errors.append(f"{path}.id: duplicate {label} id {record_id!r}")
        seen.add(record_id)


def _source_references(
    value: Any, known: set[str], path: str, errors: list[str]
) -> None:
    for index, source_id in enumerate(_string_list(value, path, errors)):
        if source_id not in known:
            errors.append(f"{path}[{index}]: unknown source id {source_id!r}")


def _competency_references(
    value: Any, known: set[str], path: str, errors: list[str]
) -> None:
    for index, competency_id in enumerate(_string_list(value, path, errors)):
        if competency_id not in known:
            errors.append(f"{path}[{index}]: unknown competency id {competency_id!r}")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect passive Extension Package v0 data")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_parser = subparsers.add_parser("validate", help="validate one or more packages")
    validate_parser.add_argument("paths", nargs="+", type=Path)
    show_parser = subparsers.add_parser("show", help="show one normalized package")
    show_parser.add_argument("path", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.command == "validate":
            extensions = load_extensions(args.paths)
            output = {
                "valid": True,
                "extensions": [
                    {
                        "id": extension["id"],
                        "version": extension["version"],
                        "content_id": extension_content_id(extension),
                    }
                    for extension in extensions
                ],
            }
            print(json.dumps(output, ensure_ascii=False, sort_keys=True))
        else:
            extension = load_extension(args.path)
            print(json.dumps(normalized_extension(extension), ensure_ascii=False, indent=2))
    except (ExtensionValidationError, FileNotFoundError, OSError, UnicodeError) as exc:
        errors = exc.errors if isinstance(exc, ExtensionValidationError) else [str(exc)]
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
