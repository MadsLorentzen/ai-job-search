#!/usr/bin/env python3
"""Read the current candidate sources into a versioned evidence snapshot.

This is a read-only compatibility adapter over the repository's current
candidate factual sources. It does not decide which source wins when values
disagree and it does not write back to the profile or workflow files.

Usage from the repository root:

    python -m product.profile_snapshot
    python -m product.profile_snapshot --root /path/to/ai-job-search --compact
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "candidate-profile-evidence-snapshot.v0"
ID_SEMANTICS = "deterministic content-derived identifiers; not durable persistent identifiers"
SOURCE_PATHS = (
    "CLAUDE.md",
    ".claude/skills/job-application-assistant/01-candidate-profile.md",
    "cv/main_example.tex",
)

PLACEHOLDER_TOKEN_RE = re.compile(r"\[([^\]\n]+)\]")
PLACEHOLDER_NAMES = {
    "AUTHOR_LIST", "AWARD", "AWARD_NAME", "CERTIFICATION_NAME", "COMPANY",
    "DATE", "DEALBREAKER", "DEGREE", "DEGREE_LEVEL", "DESCRIPTION",
    "DOI_LINK", "DOI_URL", "DOMAIN", "EMAIL", "END", "END_DATE", "EVENT",
    "EXAMPLE_COMPANIES", "FIELD", "FRAMEWORKS_AND_LIBRARIES", "HOURS",
    "INSTITUTION", "JOB_TITLE", "JOURNAL", "KEY_ACHIEVEMENT",
    "KEY_RESPONSIBILITY", "KEY_TOPICS", "LANGUAGE", "LEVEL", "LOCATION",
    "NAME", "OTHER_SKILLS", "PASSION", "PHONE", "PLACEHOLDER", "PROFICIENCY",
    "PROJECT_NAME", "RESPONSIBILITY_OR_ACHIEVEMENT", "SECTOR", "START",
    "START_DATE", "THESIS_TITLE", "TITLE", "TOOL_LIST", "TOPICS", "TRAIT",
    "YEAR", "YEAR_END", "YEAR_START", "YEARS",
}
MIXED_CASE_PLACEHOLDER_RE = re.compile(
    r"^(?:Achievement or responsibility \d+|Award Name|Company|Degree|Field|First|"
    r"Institution|Job Title|Language \d+|Last|Skill Category \d+|Thesis Title|Title|"
    r"Year|YYYY-(?:Present|YYYY))$"
)
MARKDOWN_FIELD_RE = re.compile(r"^\s*-\s+\*\*(.+?):\*\*\s*(.*?)\s*$")
MARKDOWN_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
MARKDOWN_TABLE_SEPARATOR_RE = re.compile(r"^:?-{3,}:?$")


class SnapshotValidationError(ValueError):
    """Raised when the generated snapshot violates the v0 contract."""


@dataclass(frozen=True)
class SourceLocation:
    file: str
    section: str | None
    line_start: int
    line_end: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "file": self.file,
            "section": self.section,
            "line_start": self.line_start,
            "line_end": self.line_end,
        }


class SnapshotBuilder:
    """Accumulate deterministic claims before grouping corroborations/conflicts."""

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.claims: list[dict[str, Any]] = []
        self.sources: list[dict[str, Any]] = []
        self.employment_records: list[dict[str, Any]] = []

    def add_source(self, relative_path: str, text: str) -> None:
        self.sources.append(
            {
                "file": relative_path,
                "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "line_count": len(text.splitlines()),
            }
        )

    def add_claim(
        self,
        *,
        category: str,
        field: str,
        value: Any,
        record_key: str,
        source: SourceLocation,
        confidence: str = "high",
        extraction_status: str = "explicit",
        placeholder: bool | None = None,
        concept_discriminator: str | None = None,
    ) -> None:
        value = _clean_value(value)
        if value in (None, "", [], {}):
            return

        record_id = _stable_id("rec", record_key)
        concept_key = f"{record_key}|{field}"
        if concept_discriminator:
            concept_key = f"{concept_key}|item:{concept_discriminator}"
        concept_id = _stable_id("cpt", concept_key)
        claim_key = "|".join(
            (
                concept_key,
                source.file,
                source.section or "",
                _normalized_json(value),
            )
        )
        self.claims.append(
            {
                "id": _stable_id("clm", claim_key),
                "record_id": record_id,
                "concept_id": concept_id,
                "category": category,
                "field": field,
                "value": value,
                "source": source.as_dict(),
                "placeholder": (
                    _contains_placeholder(value) if placeholder is None else placeholder
                ),
                "confidence": confidence,
                "extraction_status": extraction_status,
            }
        )

    def add_employment_record(
        self, fields: dict[str, Any], source: SourceLocation
    ) -> dict[str, Any]:
        """Store a source-local episode for conservative linking at finish time."""

        record = {
            "fields": {key: _clean_value(value) for key, value in fields.items()},
            "field_sources": {key: source for key in fields},
            "details": [],
            "source_file": source.file,
            "local_index": sum(
                1 for item in self.employment_records
                if item["source_file"] == source.file
            ),
        }
        self.employment_records.append(record)
        return record

    def add_employment_detail(
        self, record: dict[str, Any], value: str, source: SourceLocation
    ) -> None:
        record["details"].append((_clean_value(value), source))

    def finish(self) -> dict[str, Any]:
        _materialize_employment_claims(self)
        claims = _deduplicate_claims(self.claims)
        corroborations, conflicts = _group_claims(claims)
        snapshot = {
            "schema_version": SCHEMA_VERSION,
            "id_semantics": ID_SEMANTICS,
            "sources": sorted(self.sources, key=lambda item: item["file"]),
            "claims": sorted(
                claims,
                key=lambda item: (
                    item["category"],
                    item["field"],
                    item["record_id"],
                    item["source"]["file"],
                    item["source"]["line_start"],
                ),
            ),
            "corroborations": corroborations,
            "conflicts": conflicts,
            "summary": {
                "source_count": len(self.sources),
                "claim_count": len(claims),
                "placeholder_claim_count": sum(
                    1 for claim in claims if claim["placeholder"]
                ),
                "corroboration_count": len(corroborations),
                "conflict_count": len(conflicts),
            },
        }
        validate_snapshot(snapshot)
        return snapshot


def build_snapshot(root: str | Path = ".") -> dict[str, Any]:
    """Build and validate a snapshot without modifying any source file."""

    root_path = Path(root).resolve()
    builder = SnapshotBuilder(root_path)

    for relative_path in SOURCE_PATHS:
        path = root_path / relative_path
        if not path.is_file():
            raise FileNotFoundError(f"required candidate source not found: {relative_path}")
        text = path.read_text(encoding="utf-8")
        builder.add_source(relative_path, text)
        if relative_path.endswith(".tex"):
            _parse_latex_source(relative_path, text, builder)
        else:
            _parse_markdown_source(relative_path, text, builder)

    return builder.finish()


def validate_snapshot(snapshot: dict[str, Any]) -> None:
    """Validate the in-memory v0 shape using only the Python standard library."""

    if not isinstance(snapshot, dict):
        raise SnapshotValidationError("snapshot must be an object")
    if snapshot.get("schema_version") != SCHEMA_VERSION:
        raise SnapshotValidationError(
            f"schema_version must be {SCHEMA_VERSION!r}"
        )
    if snapshot.get("id_semantics") != ID_SEMANTICS:
        raise SnapshotValidationError(f"id_semantics must be {ID_SEMANTICS!r}")

    for key in ("sources", "claims", "corroborations", "conflicts"):
        if not isinstance(snapshot.get(key), list):
            raise SnapshotValidationError(f"{key} must be an array")
    if not isinstance(snapshot.get("summary"), dict):
        raise SnapshotValidationError("summary must be an object")

    source_files = set()
    for source in snapshot["sources"]:
        _require_keys(source, {"file", "sha256", "line_count"}, "source")
        if not isinstance(source["file"], str) or not source["file"]:
            raise SnapshotValidationError("source.file must be a non-empty string")
        if not re.fullmatch(r"[0-9a-f]{64}", source["sha256"]):
            raise SnapshotValidationError("source.sha256 must be a SHA-256 hex digest")
        if not isinstance(source["line_count"], int) or source["line_count"] < 0:
            raise SnapshotValidationError("source.line_count must be non-negative")
        if source["file"] in source_files:
            raise SnapshotValidationError(f"duplicate source file: {source['file']}")
        source_files.add(source["file"])

    claim_ids: set[str] = set()
    concept_ids: set[str] = set()
    claims_by_id: dict[str, dict[str, Any]] = {}
    concepts: dict[str, tuple[str, str]] = {}
    for claim in snapshot["claims"]:
        _require_keys(
            claim,
            {
                "id",
                "record_id",
                "concept_id",
                "category",
                "field",
                "value",
                "source",
                "placeholder",
                "confidence",
                "extraction_status",
            },
            "claim",
        )
        if claim["id"] in claim_ids:
            raise SnapshotValidationError(f"duplicate claim id: {claim['id']}")
        claim_ids.add(claim["id"])
        claims_by_id[claim["id"]] = claim
        concept_ids.add(claim["concept_id"])
        if not re.fullmatch(r"clm_[0-9a-f]{16}", claim["id"]):
            raise SnapshotValidationError(f"invalid claim id: {claim['id']}")
        if not re.fullmatch(r"rec_[0-9a-f]{16}", claim["record_id"]):
            raise SnapshotValidationError(f"invalid record id: {claim['record_id']}")
        if not re.fullmatch(r"cpt_[0-9a-f]{16}", claim["concept_id"]):
            raise SnapshotValidationError(f"invalid concept id: {claim['concept_id']}")
        if not isinstance(claim["category"], str) or not claim["category"]:
            raise SnapshotValidationError("claim.category must be a non-empty string")
        if not isinstance(claim["field"], str) or not claim["field"]:
            raise SnapshotValidationError("claim.field must be a non-empty string")
        if not isinstance(claim["placeholder"], bool):
            raise SnapshotValidationError("claim.placeholder must be boolean")
        if claim["confidence"] not in {"high", "medium", "low"}:
            raise SnapshotValidationError("claim.confidence has an unsupported value")
        if claim["extraction_status"] not in {"explicit", "derived"}:
            raise SnapshotValidationError(
                "claim.extraction_status has an unsupported value"
            )
        _validate_source_location(claim["source"], source_files)
        concept_shape = (claim["category"], claim["field"])
        if claim["concept_id"] in concepts and concepts[claim["concept_id"]] != concept_shape:
            raise SnapshotValidationError(
                "claims sharing a concept_id must share category and field"
            )
        concepts[claim["concept_id"]] = concept_shape

    for group_name in ("corroborations", "conflicts"):
        prefix = "cor" if group_name == "corroborations" else "con"
        for group in snapshot[group_name]:
            _require_keys(
                group,
                {"id", "concept_id", "category", "field", "variants"},
                group_name[:-1],
            )
            if not re.fullmatch(rf"{prefix}_[0-9a-f]{{16}}", group["id"]):
                raise SnapshotValidationError(f"invalid {group_name} id: {group['id']}")
            if group["concept_id"] not in concept_ids:
                raise SnapshotValidationError(
                    f"{group_name} references unknown concept id"
                )
            if not isinstance(group["variants"], list) or not group["variants"]:
                raise SnapshotValidationError(f"{group_name}.variants must be non-empty")
            if group_name == "corroborations" and len(group["variants"]) != 1:
                raise SnapshotValidationError(
                    "corroboration must contain exactly one normalized value variant"
                )
            if group_name == "conflicts" and len(group["variants"]) < 2:
                raise SnapshotValidationError(
                    "conflict must contain at least two normalized value variants"
                )
            normalized_values: set[str] = set()
            for variant in group["variants"]:
                _require_keys(
                    variant,
                    {"value", "claim_ids", "provenance"},
                    f"{group_name}.variant",
                )
                if not isinstance(variant["claim_ids"], list) or not variant["claim_ids"] or any(
                    claim_id not in claim_ids for claim_id in variant["claim_ids"]
                ):
                    raise SnapshotValidationError(
                        f"{group_name} variant references unknown claims"
                    )
                if len(set(variant["claim_ids"])) != len(variant["claim_ids"]):
                    raise SnapshotValidationError(
                        f"{group_name} variant contains duplicate claim ids"
                    )
                normalized_value = _normalized_json(variant["value"])
                if normalized_value in normalized_values:
                    raise SnapshotValidationError(
                        f"{group_name} must contain distinct normalized variants"
                    )
                normalized_values.add(normalized_value)
                if not isinstance(variant["provenance"], list) or not variant["provenance"]:
                    raise SnapshotValidationError(
                        f"{group_name} variant provenance must be non-empty"
                    )
                for claim_id in variant["claim_ids"]:
                    claim = claims_by_id[claim_id]
                    if claim["concept_id"] != group["concept_id"]:
                        raise SnapshotValidationError(
                            f"{group_name} claim concept_id disagrees with group"
                        )
                    if (claim["category"], claim["field"]) != (
                        group["category"], group["field"]
                    ):
                        raise SnapshotValidationError(
                            f"{group_name} category or field disagrees with claim"
                        )
                    if _normalized_json(claim["value"]) != normalized_value:
                        raise SnapshotValidationError(
                            f"{group_name} variant value disagrees with claim"
                        )
                for provenance in variant["provenance"]:
                    _validate_source_location(provenance, source_files)

    expected_summary = {
        "source_count": len(snapshot["sources"]),
        "claim_count": len(snapshot["claims"]),
        "placeholder_claim_count": sum(
            1 for claim in snapshot["claims"] if claim["placeholder"]
        ),
        "corroboration_count": len(snapshot["corroborations"]),
        "conflict_count": len(snapshot["conflicts"]),
    }
    for key, expected in expected_summary.items():
        if snapshot["summary"].get(key) != expected:
            raise SnapshotValidationError(
                f"summary.{key} must equal {expected}"
            )


def _require_keys(value: Any, keys: set[str], label: str) -> None:
    if not isinstance(value, dict):
        raise SnapshotValidationError(f"{label} must be an object")
    missing = keys - value.keys()
    if missing:
        raise SnapshotValidationError(
            f"{label} is missing required keys: {', '.join(sorted(missing))}"
        )


def _validate_source_location(value: Any, source_files: set[str]) -> None:
    _require_keys(
        value,
        {"file", "section", "line_start", "line_end"},
        "source location",
    )
    if value["file"] not in source_files:
        raise SnapshotValidationError("source location references unknown file")
    if value["section"] is not None and not isinstance(value["section"], str):
        raise SnapshotValidationError("source section must be a string or null")
    if not isinstance(value["line_start"], int) or value["line_start"] < 1:
        raise SnapshotValidationError("source line_start must be a positive integer")
    if not isinstance(value["line_end"], int) or value["line_end"] < value["line_start"]:
        raise SnapshotValidationError("source line_end must be >= line_start")


def _parse_markdown_source(
    relative_path: str, text: str, builder: SnapshotBuilder
) -> None:
    lines = text.splitlines()
    sections = _markdown_sections(lines)
    if relative_path == "CLAUDE.md":
        _parse_claude_markdown(relative_path, lines, sections, builder)
    else:
        _parse_candidate_markdown(relative_path, lines, sections, builder)


def _parse_claude_markdown(
    relative_path: str,
    lines: list[str],
    sections: dict[int, tuple[str, ...]],
    builder: SnapshotBuilder,
) -> None:
    education_counts: defaultdict[str, int] = defaultdict(int)

    for index, line in enumerate(lines, start=1):
        path = sections.get(index, ())
        if not path or "Candidate Profile" not in path:
            continue
        section = path[-1]
        location = SourceLocation(relative_path, " > ".join(path), index, index)

        if section == "Identity":
            match = MARKDOWN_FIELD_RE.match(line)
            if match:
                label, value = match.groups()
                _add_identity_field(builder, label, _strip_inline_comment(value), location)
            elif _is_table_data_row(line):
                cells = _table_cells(line)
                if len(cells) >= 2:
                    _add_language_claim(
                        builder,
                        cells[0],
                        cells[1],
                        cells[2] if len(cells) > 2 else "",
                        location,
                    )
            continue

        if section == "Education":
            match = re.match(
                r"^\s*-\s+\*\*(.+?)\*\*\s*\((.+?)\)\s*-\s*(.+?)\s*$",
                line,
            )
            if match:
                degree, dates, institution = match.groups()
                key_base = _record_base("education", institution)
                occurrence = education_counts[key_base]
                education_counts[key_base] += 1
                record_key = f"{key_base}:{occurrence}"
                _add_record_fields(
                    builder,
                    "education",
                    record_key,
                    {
                        "qualification": degree,
                        "date_range": dates,
                        "institution": institution,
                    },
                    location,
                )
            continue

        if section == "Professional Experience":
            match = re.match(
                r"^\s*-\s+\*\*(.+?)\*\*\s*\((.+?)\)\s*-\s+\*\*(.+?)\*\*\s*\((.+?)\)\s*$",
                line,
            )
            if match:
                title, dates, company, work_location = match.groups()
                builder.add_employment_record(
                    {
                        "job_title": title,
                        "date_range": dates,
                        "employer": company,
                        "location": work_location,
                    },
                    location,
                )
            continue

        if section == "Technical Skills":
            match = MARKDOWN_FIELD_RE.match(line)
            if match:
                label, value = match.groups()
                field = _skill_field(label)
                _add_list_claims(builder, field, value, location)
            continue

        if section == "Publications" and line.lstrip().startswith("-"):
            _add_publication_claim(builder, line, location)
            continue

        if section == "Awards" and line.lstrip().startswith("-"):
            _add_award_claim(builder, line, location)
            continue

        if section == "Deal-breakers" and line.lstrip().startswith("-"):
            value = line.split("-", 1)[1].strip()
            builder.add_claim(
                category="constraints",
                field="constraint",
                value=value,
                record_key=f"constraint:{_semantic_token(value)}",
                source=location,
            )


def _parse_candidate_markdown(
    relative_path: str,
    lines: list[str],
    sections: dict[int, tuple[str, ...]],
    builder: SnapshotBuilder,
) -> None:
    education_counts: defaultdict[str, int] = defaultdict(int)
    current_employment: dict[str, Any] | None = None

    for index, line in enumerate(lines, start=1):
        path = sections.get(index, ())
        if not path:
            continue
        section = path[-1]
        location = SourceLocation(relative_path, " > ".join(path), index, index)

        if section == "Identity":
            match = MARKDOWN_FIELD_RE.match(line)
            if match:
                label, value = match.groups()
                _add_identity_field(builder, label, value, location)
            continue

        if section == "Languages" and _is_table_data_row(line):
            cells = _table_cells(line)
            if len(cells) >= 2:
                _add_language_claim(builder, cells[0], cells[1], cells[2] if len(cells) > 2 else "", location)
            continue

        if section == "Education" and _is_table_data_row(line):
            cells = _table_cells(line)
            if len(cells) >= 3:
                key_base = _record_base("education", cells[2])
                occurrence = education_counts[key_base]
                education_counts[key_base] += 1
                record_key = f"{key_base}:{occurrence}"
                fields = {
                    "qualification": cells[0],
                    "date_range": cells[1],
                    "institution": cells[2],
                }
                if len(cells) > 3:
                    fields["key_topics"] = cells[3]
                _add_record_fields(builder, "education", record_key, fields, location)
            continue

        if len(path) >= 2 and path[-2] == "Professional Experience":
            heading = MARKDOWN_HEADING_RE.match(line)
            if heading and len(heading.group(1)) == 3:
                parsed = re.match(r"(.+?)\s+-\s+(.+?)\s+\((.+?)\)$", heading.group(2))
                if parsed:
                    title, company, dates = parsed.groups()
                    current_employment = builder.add_employment_record(
                        {"job_title": title, "employer": company, "date_range": dates},
                        location,
                    )
                continue
            if line.strip().startswith("<!--"):
                continue
            if current_employment and line.strip() and not line.lstrip().startswith("-"):
                current_employment["fields"]["location"] = _clean_value(line)
                current_employment["field_sources"]["location"] = location
            elif current_employment and line.lstrip().startswith("-"):
                value = line.split("-", 1)[1].strip()
                builder.add_employment_detail(current_employment, value, location)
            continue

        if section == "Independent Projects" and line.lstrip().startswith("-"):
            match = re.match(r"^\s*-\s+\*\*(.+?)\*\*\s*:?\s*(.+)$", line)
            if match:
                name, description = match.groups()
                name = name.rstrip(":").strip()
                record_key = _record_base("project", name)
                _add_record_fields(
                    builder,
                    "projects",
                    record_key,
                    {"name": name, "description": description},
                    location,
                )
            continue

        if "Technical Skills" in path and line.lstrip().startswith("-"):
            field = _skill_field(section)
            match = MARKDOWN_FIELD_RE.match(line)
            value = match.group(2) if match else line.split("-", 1)[1].strip()
            label = match.group(1) if match else ""
            if label and field == "technical_skill":
                value = f"{label}: {value}"
            _add_list_claims(builder, field, value, location)
            continue

        if section == "Publications" and re.match(r"^\s*\d+\.\s+", line):
            _add_publication_claim(builder, line, location)
            continue

        if section == "Awards" and line.lstrip().startswith("-"):
            _add_award_claim(builder, line, location)
            continue


def _parse_latex_source(
    relative_path: str, text: str, builder: SnapshotBuilder
) -> None:
    sections = _latex_sections(text)

    for command, field, category, record_key in (
        ("name", "name", "identity", "identity"),
        ("address", "location", "location", "location"),
        ("phone", "phone", "contact", "contact:phone"),
        ("email", "email", "contact", "contact:email"),
    ):
        for occurrence in _extract_latex_commands(text, command):
            args = occurrence["args"]
            if not args:
                continue
            if command == "name":
                value = " ".join(args[:2])
            else:
                value = args[0]
            location = _latex_location(relative_path, occurrence, sections, text)
            builder.add_claim(
                category=category,
                field=field,
                value=_latex_to_text(value),
                record_key=record_key,
                source=location,
            )

    for occurrence in _extract_latex_commands(text, "extrainfo"):
        body = occurrence["args"][0] if occurrence["args"] else ""
        location = _latex_location(relative_path, occurrence, sections, text)
        for url, label in re.findall(r"\\href\{([^{}]+)\}\{([^{}]+)\}", body):
            field = label.strip().casefold()
            if field in {"linkedin", "github"}:
                builder.add_claim(
                    category="contact",
                    field=field,
                    value=_latex_to_text(url),
                    record_key=f"contact:{field}",
                    source=location,
                )

    education_counts: defaultdict[str, int] = defaultdict(int)
    for occurrence in _extract_latex_commands(text, "cventry"):
        args = occurrence["args"]
        if len(args) < 4:
            continue
        section = _section_for_offset(sections, occurrence["start"])
        location = _latex_location(relative_path, occurrence, sections, text)
        dates, title, organization, item_location = map(_latex_to_text, args[:4])
        body = _latex_to_text(args[5]) if len(args) > 5 else ""
        if section == "Professional Experience":
            employment_record = builder.add_employment_record(
                {
                    "job_title": title,
                    "date_range": dates,
                    "employer": organization,
                    "location": item_location,
                },
                location,
            )
            for detail in _latex_item_values(args[5] if len(args) > 5 else ""):
                builder.add_employment_detail(employment_record, detail, location)
        elif section == "Education":
            key_base = _record_base("education", organization)
            occurrence_index = education_counts[key_base]
            education_counts[key_base] += 1
            record_key = f"{key_base}:{occurrence_index}"
            fields = {
                "qualification": title,
                "date_range": dates,
                "institution": organization,
                "location": item_location,
            }
            if body:
                fields["details"] = body
            _add_record_fields(builder, "education", record_key, fields, location)

    for section_name, category, field in (
        ("Core Competencies", "skills", "technical_skill"),
        ("Languages", "languages", "language"),
        ("Publications", "publications", "publication"),
        ("Honors and Awards", "awards", "award"),
    ):
        for item in _latex_section_items(text, sections, section_name):
            location = SourceLocation(
                relative_path,
                section_name,
                item["line_start"],
                item["line_end"],
            )
            value = _latex_to_text(item["value"])
            if not value:
                continue
            if category == "languages":
                for language in _split_list(value.rstrip(".")):
                    match = re.match(r"(.+?)\s*\((.+?)\)$", language)
                    if match:
                        _add_language_claim(builder, match.group(1), match.group(2), "", location)
                    else:
                        _add_language_claim(builder, language, "", "", location)
            elif category == "skills":
                _add_list_claims(builder, field, value, location)
            else:
                record_key = f"{category}:{_semantic_token(value)}"
                builder.add_claim(
                    category=category,
                    field=field,
                    value=value,
                    record_key=record_key,
                    source=location,
                )


def _add_identity_field(
    builder: SnapshotBuilder, label: str, value: str, source: SourceLocation
) -> None:
    normalized_label = _semantic_token(label)
    mapping = {
        "name": ("identity", "name", "identity"),
        "location": ("location", "location", "location"),
        "phone": ("contact", "phone", "contact:phone"),
        "email": ("contact", "email", "contact:email"),
        "linkedin": ("contact", "linkedin", "contact:linkedin"),
        "github": ("contact", "github", "contact:github"),
        "status": ("identity", "employment_status", "identity"),
        "constraints": ("constraints", "constraint", "constraints:general"),
    }
    mapped = mapping.get(normalized_label)
    if mapped:
        category, field, record_key = mapped
        builder.add_claim(
            category=category,
            field=field,
            value=value,
            record_key=record_key,
            source=source,
        )


def _add_record_fields(
    builder: SnapshotBuilder,
    category: str,
    record_key: str,
    fields: dict[str, Any],
    source: SourceLocation,
) -> None:
    for field, value in fields.items():
        builder.add_claim(
            category=category,
            field=field,
            value=value,
            record_key=record_key,
            source=source,
        )


def _add_list_claims(
    builder: SnapshotBuilder,
    field: str,
    value: str,
    source: SourceLocation,
) -> None:
    items = [value.strip()] if _contains_placeholder(value) else _split_list(value)
    for item in items:
        builder.add_claim(
            category="skills",
            field=field,
            value=item,
            record_key=f"skills:{field}:{_semantic_token(item)}",
            source=source,
        )


def _add_language_claim(
    builder: SnapshotBuilder,
    name: str,
    level: str,
    notes: str,
    source: SourceLocation,
) -> None:
    record_key = f"language:{_semantic_token(name)}"
    record_placeholder = _contains_placeholder(name)
    builder.add_claim(
        category="languages",
        field="language",
        value=name,
        record_key=record_key,
        source=source,
        placeholder=record_placeholder,
    )
    if _clean_value(level):
        builder.add_claim(
            category="languages",
            field="proficiency",
            value=level,
            record_key=record_key,
            source=source,
            placeholder=record_placeholder or _contains_placeholder(level),
        )
    if _clean_value(notes):
        builder.add_claim(
            category="languages",
            field="notes",
            value=notes,
            record_key=record_key,
            source=source,
            placeholder=record_placeholder or _contains_placeholder(notes),
        )


def _add_publication_claim(
    builder: SnapshotBuilder, line: str, source: SourceLocation
) -> None:
    value = re.sub(r"^\s*(?:-|\d+\.)\s*", "", line).strip()
    builder.add_claim(
        category="publications",
        field="publication",
        value=value,
        record_key=f"publication:{_semantic_token(value)}",
        source=source,
    )


def _add_award_claim(
    builder: SnapshotBuilder, line: str, source: SourceLocation
) -> None:
    value = re.sub(r"^\s*-\s*", "", line).strip()
    value = re.sub(r"\*\*", "", value)
    builder.add_claim(
        category="awards",
        field="award",
        value=value,
        record_key=f"award:{_semantic_token(value)}",
        source=source,
    )


def _materialize_employment_claims(builder: SnapshotBuilder) -> None:
    """Link source-local employment episodes without relying on source ordering."""

    records = builder.employment_records
    if not records:
        return

    parents = list(range(len(records)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def component_sources(index: int) -> set[str]:
        root = find(index)
        return {
            record["source_file"]
            for position, record in enumerate(records)
            if find(position) == root
        }

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    by_source: defaultdict[str, list[int]] = defaultdict(list)
    for index, record in enumerate(records):
        by_source[record["source_file"]].append(index)

    edges: list[tuple[int, int, int]] = []
    source_names = sorted(by_source)
    for source_position, left_source in enumerate(source_names):
        for right_source in source_names[source_position + 1 :]:
            left_indexes = by_source[left_source]
            right_indexes = by_source[right_source]
            scores: dict[tuple[int, int], int] = {}
            for left in left_indexes:
                for right in right_indexes:
                    score = _employment_match_score(records[left], records[right])
                    if score:
                        scores[(left, right)] = score

            for (left, right), score in scores.items():
                left_scores = [
                    value for (candidate_left, _), value in scores.items()
                    if candidate_left == left
                ]
                right_scores = [
                    value for (_, candidate_right), value in scores.items()
                    if candidate_right == right
                ]
                left_best = max(left_scores, default=0)
                right_best = max(right_scores, default=0)
                if (
                    score == left_best == right_best
                    and left_scores.count(score) == 1
                    and right_scores.count(score) == 1
                ):
                    edges.append((score, left, right))

    for _, left, right in sorted(edges, key=lambda item: (-item[0], item[1], item[2])):
        if find(left) == find(right):
            continue
        if component_sources(left) & component_sources(right):
            continue
        union(left, right)

    components: defaultdict[int, list[int]] = defaultdict(list)
    for index in range(len(records)):
        components[find(index)].append(index)

    for indexes in components.values():
        component_records = [records[index] for index in indexes]
        record_key = _employment_record_key(component_records)
        for record in component_records:
            for field, value in record["fields"].items():
                builder.add_claim(
                    category="employment",
                    field=field,
                    value=value,
                    record_key=record_key,
                    source=record["field_sources"][field],
                )
            for value, source in record["details"]:
                builder.add_claim(
                    category="employment",
                    field="responsibility_or_achievement",
                    value=value,
                    record_key=record_key,
                    source=source,
                    concept_discriminator=_semantic_token(value),
                )


def _employment_match_score(left: dict[str, Any], right: dict[str, Any]) -> int:
    left_fields, right_fields = left["fields"], right["fields"]
    employer_matches = _same_semantic_value(
        left_fields.get("employer"), right_fields.get("employer")
    )
    if not employer_matches:
        return 0
    title_matches = _same_semantic_value(
        left_fields.get("job_title"), right_fields.get("job_title")
    )
    date_matches = _same_semantic_value(
        left_fields.get("date_range"), right_fields.get("date_range")
    )
    return int(title_matches) + int(date_matches)


def _same_semantic_value(left: Any, right: Any) -> bool:
    return bool(left and right) and _normalized_json(left) == _normalized_json(right)


def _employment_record_key(records: list[dict[str, Any]]) -> str:
    employer = _semantic_token(records[0]["fields"].get("employer", "unknown"))
    if len(records) == 1:
        record = records[0]
        signature = (
            f"{record['source_file']}:{employer}:"
            f"{_semantic_token(record['fields'].get('job_title', ''))}:"
            f"{_semantic_token(record['fields'].get('date_range', ''))}:"
            f"{record['local_index']}"
        )
        return f"employment:{employer}:unlinked:{_stable_id('episode', signature)}"
    title_sets = [
        {_semantic_token(record["fields"].get("job_title", ""))}
        for record in records
    ]
    date_sets = [
        {_semantic_token(record["fields"].get("date_range", ""))}
        for record in records
    ]
    common_titles = set.intersection(*title_sets) - {""}
    common_dates = set.intersection(*date_sets) - {""}
    if common_titles and common_dates:
        return f"employment:{employer}:title:{min(common_titles)}:dates:{min(common_dates)}"
    if common_dates:
        return f"employment:{employer}:dates:{min(common_dates)}"
    if common_titles:
        return f"employment:{employer}:title:{min(common_titles)}"

    signature = "|".join(
        sorted(
            f"{record['source_file']}:{_semantic_token(record['fields'].get('job_title', ''))}:"
            f"{_semantic_token(record['fields'].get('date_range', ''))}:"
            f"{record['local_index']}"
            for record in records
        )
    )
    return f"employment:{employer}:unlinked:{_stable_id('episode', signature)}"


def _group_claims(
    claims: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_concept: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for claim in claims:
        if not claim["placeholder"]:
            by_concept[claim["concept_id"]].append(claim)

    corroborations: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    for concept_id, concept_claims in by_concept.items():
        if len({claim["source"]["file"] for claim in concept_claims}) < 2:
            continue
        variants_by_value: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
        for claim in concept_claims:
            variants_by_value[_normalized_json(claim["value"])].append(claim)
        variants = [
            {
                "value": group[0]["value"],
                "claim_ids": sorted(claim["id"] for claim in group),
                "provenance": sorted(
                    (claim["source"] for claim in group),
                    key=lambda item: (item["file"], item["line_start"]),
                ),
            }
            for _, group in sorted(variants_by_value.items())
        ]
        sample = concept_claims[0]
        common = {
            "concept_id": concept_id,
            "category": sample["category"],
            "field": sample["field"],
            "variants": variants,
        }
        if len(variants) == 1:
            common["id"] = _stable_id("cor", concept_id)
            corroborations.append(common)
        else:
            common["id"] = _stable_id("con", concept_id)
            conflicts.append(common)

    sort_key = lambda item: (item["category"], item["field"], item["concept_id"])
    return sorted(corroborations, key=sort_key), sorted(conflicts, key=sort_key)


def _deduplicate_claims(claims: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for claim in claims:
        existing = by_id.get(claim["id"])
        if existing is None or claim["source"]["line_start"] < existing["source"]["line_start"]:
            by_id[claim["id"]] = claim
    return list(by_id.values())


def _markdown_sections(lines: list[str]) -> dict[int, tuple[str, ...]]:
    stack: list[tuple[int, str]] = []
    result: dict[int, tuple[str, ...]] = {}
    for index, line in enumerate(lines, start=1):
        match = MARKDOWN_HEADING_RE.match(line)
        if match:
            level = len(match.group(1))
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, match.group(2).strip()))
        result[index] = tuple(title for _, title in stack)
    return result


def _is_table_data_row(line: str) -> bool:
    cells = _table_cells(line)
    return bool(cells) and not all(
        MARKDOWN_TABLE_SEPARATOR_RE.fullmatch(cell.replace(" ", "")) for cell in cells
    ) and not any(cell.casefold() in {"language", "degree"} for cell in cells[:1])


def _table_cells(line: str) -> list[str]:
    stripped = line.strip()
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return []
    return [cell.strip() for cell in stripped[1:-1].split("|")]


def _latex_sections(text: str) -> list[tuple[int, str]]:
    return [
        (match.start(), _latex_to_text(match.group(1)))
        for match in re.finditer(r"\\section\{([^{}]+)\}", text)
    ]


def _section_for_offset(sections: list[tuple[int, str]], offset: int) -> str | None:
    current = None
    for section_offset, name in sections:
        if section_offset > offset:
            break
        current = name
    return current


def _extract_latex_commands(text: str, command: str) -> list[dict[str, Any]]:
    pattern = re.compile(rf"\\{re.escape(command)}(?:\[[^\]]*\])?")
    occurrences: list[dict[str, Any]] = []
    for match in pattern.finditer(text):
        position = match.end()
        occurrence_end = match.end()
        args: list[str] = []
        while True:
            while position < len(text) and text[position].isspace():
                position += 1
            if position >= len(text) or text[position] != "{":
                break
            value, position = _read_balanced(text, position)
            args.append(value)
            occurrence_end = position
        occurrences.append(
            {"start": match.start(), "end": occurrence_end, "args": args}
        )
    return occurrences


def _read_balanced(text: str, start: int) -> tuple[str, int]:
    depth = 0
    escaped = False
    for position in range(start, len(text)):
        char = text[position]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1 : position], position + 1
    return text[start + 1 :], len(text)


def _latex_location(
    relative_path: str,
    occurrence: dict[str, Any],
    sections: list[tuple[int, str]],
    text: str,
) -> SourceLocation:
    line_start = text[: occurrence["start"]].count("\n") + 1
    line_end = text[: occurrence["end"]].count("\n") + 1
    return SourceLocation(
        relative_path,
        _section_for_offset(sections, occurrence["start"]),
        line_start,
        line_end,
    )

def _latex_section_items(
    text: str,
    sections: list[tuple[int, str]],
    section_name: str,
) -> list[dict[str, Any]]:
    start = next((offset for offset, name in sections if name == section_name), None)
    if start is None:
        return []
    end = next((offset for offset, _ in sections if offset > start), len(text))
    block = text[start:end]
    items = []
    for match in re.finditer(r"(?m)^\s*\\item(?:\{)?\s*(.+?)(?:\})?\s*$", block):
        value = match.group(1).strip()
        absolute_start = start + match.start()
        absolute_end = start + match.end()
        items.append(
            {
                "value": value,
                "line_start": text[:absolute_start].count("\n") + 1,
                "line_end": text[:absolute_end].count("\n") + 1,
            }
        )
    return items


def _latex_item_values(body: str) -> list[str]:
    values = []
    for line in body.splitlines():
        match = re.match(r"\s*\\item\s+(.+?)\s*$", line)
        if match:
            value = _latex_to_text(match.group(1))
            if value:
                values.append(value)
    return values


def _latex_to_text(value: str) -> str:
    value = re.sub(r"%.*", "", value)
    value = re.sub(r"\\href\{([^{}]*)\}\{([^{}]*)\}", r"\2", value)
    value = re.sub(r"\\(?:textbf|textit|emph|small)\{([^{}]*)\}", r"\1", value)
    value = re.sub(r"\\(?:vspace|needspace|fontsize)\{[^{}]*\}", " ", value)
    value = re.sub(r"\\(?:begin|end)\{[^{}]*\}", " ", value)
    value = re.sub(r"\\[A-Za-z@]+(?:\[[^\]]*\])?", " ", value)
    value = value.replace("``", '"').replace("''", '"')
    value = value.replace("~", " ").replace("\\&", "&").replace("\\_", "_")
    value = value.replace("{", "").replace("}", "")
    return _clean_value(value)


def _split_list(value: str) -> list[str]:
    return [part.strip() for part in re.split(r"[,;]", value) if part.strip()]


def _skill_field(label: str) -> str:
    token = _semantic_token(label)
    if token in {"domain", "domain_expertise"}:
        return "domain_skill"
    if token in {"software", "software_tools", "tools", "software_and_tools"}:
        return "software_or_tool"
    return "technical_skill"


def _record_base(category: str, anchor: str) -> str:
    return f"{category}:{_semantic_token(anchor) or 'unknown'}"


def _semantic_token(value: Any) -> str:
    text = unicodedata.normalize("NFC", str(value)).casefold()
    text = re.sub(r"\[|\]", "", text)
    text = re.sub(r"[^\w]+", "_", text, flags=re.UNICODE)
    return text.strip("_")


def _stable_id(prefix: str, value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest}"


def _contains_placeholder(value: Any) -> bool:
    if isinstance(value, dict):
        return any(_contains_placeholder(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_placeholder(item) for item in value)
    text = str(value)
    if re.search(r"\b(?:YOUR|PLACEHOLDER)_[A-Z0-9_]+\b", text):
        return True
    return any(
        _is_placeholder_token(match.group(1))
        for match in PLACEHOLDER_TOKEN_RE.finditer(text)
    )


def _is_placeholder_token(token: str) -> bool:
    if MIXED_CASE_PLACEHOLDER_RE.fullmatch(token):
        return True
    if token.startswith("YOUR_"):
        return bool(re.fullmatch(r"YOUR_[A-Z0-9_]+", token))
    base = re.sub(r"_\d+$", "", token)
    return base in PLACEHOLDER_NAMES


def _clean_value(value: Any) -> Any:
    if isinstance(value, str):
        return re.sub(r"\s+", " ", value).strip()
    if isinstance(value, dict):
        return {key: _clean_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clean_value(item) for item in value]
    return value


def _strip_inline_comment(value: str) -> str:
    return re.sub(r"\s*<!--.*?-->\s*$", "", value).strip()


def _normalized_json(value: Any) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, str):
            text = unicodedata.normalize("NFC", item)
            text = text.replace("–", "-").replace("—", "-")
            return re.sub(r"\s+", " ", text).strip().casefold()
        if isinstance(item, dict):
            return {key: normalize(item[key]) for key in sorted(item)}
        if isinstance(item, list):
            return [normalize(part) for part in item]
        return item

    return json.dumps(normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a read-only Candidate Profile & Evidence Snapshot v0"
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="repository root (default: current directory)",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="emit compact JSON instead of indented JSON",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        snapshot = build_snapshot(args.root)
    except (FileNotFoundError, OSError, UnicodeError, SnapshotValidationError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    indent = None if args.compact else 2
    print(json.dumps(snapshot, ensure_ascii=False, indent=indent, sort_keys=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
