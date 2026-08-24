"""Browser-facing editor for the canonical candidate-profile Markdown source.

The Markdown file remains the sole writable evidence authority.  SQLite stores
only editor identity metadata and supplemental-source inclusion settings; every
successful mutation is validated by the existing snapshot builder and produces
a new immutable global profile snapshot artifact.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from product.job_fit import profile_snapshot_content_id
from product.profile_snapshot import SOURCE_PATHS, build_snapshot
from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.profile_sources import (
    CANDIDATE_SOURCE,
    included_profile_sources,
    list_profile_source_settings,
    set_supplemental_source_included,
)
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, ensure_profile_workspace
from webapp.services.profile_setup import _atomic_write_bytes, profile_snapshot_is_ready


ENTRY_ID_RE = re.compile(r"^\s*<!--\s*profile-entry-id:\s*(profile-entry-[a-f0-9]{20})\s*-->\s*$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
FIELD_RE = re.compile(r"^\s*-\s+\*\*(.+?):\*\*\s*(.*?)\s*$")
EMPLOYMENT_RE = re.compile(r"^###\s+(.+?)\s+-\s+(.+?)\s+\((.+?)\)\s*$")
MAX_FIELD_LENGTH = 5_000
_MUTATION_LOCK = threading.RLock()


class ProfileManagerError(RuntimeError):
    pass


class ProfileRevisionConflict(ProfileManagerError):
    pass


class ProfileEntryNotFound(ProfileManagerError):
    pass


@dataclass
class SourceEntry:
    entry_id: str | None
    kind: str
    section: str
    fields: dict[str, Any]
    start: int
    end: int
    fingerprint: str
    occurrence: int = 0


ENTRY_DEFINITIONS = {
    "identity": {"label": "Personal details", "section": "Identity", "fields": ("label", "value")},
    "employment": {"label": "Employment", "section": "Professional Experience", "fields": ("job_title", "employer", "date_range", "location", "details")},
    "achievement": {"label": "Experience / achievement", "section": "Professional Experience", "fields": ("value",)},
    "education": {"label": "Education", "section": "Education", "fields": ("qualification", "date_range", "institution", "key_topics")},
    "technical_skill": {"label": "Technical skill", "section": "Technical Skills", "fields": ("subsection", "value")},
    "certification": {"label": "Certification", "section": "Certifications", "fields": ("value",)},
    "project": {"label": "Project", "section": "Independent Projects", "fields": ("name", "description")},
    "publication": {"label": "Publication", "section": "Publications", "fields": ("value",)},
    "award": {"label": "Award", "section": "Awards", "fields": ("value",)},
    "language": {"label": "Language", "section": "Languages", "fields": ("language", "proficiency", "evidence")},
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _profile_path(root: str | Path) -> Path:
    return Path(root).resolve() / CANDIDATE_SOURCE


def _revision(root: str | Path, sources: list[dict[str, Any]]) -> str:
    root_path = Path(root).resolve()
    inputs = []
    for source in sources:
        path = root_path / source["source_path"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        inputs.append((source["source_path"], source["included"], digest))
    encoded = json.dumps(inputs, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return "profile-revision-" + hashlib.sha256(encoded).hexdigest()[:24]


def _headings(lines: list[str]) -> dict[int, tuple[str, ...]]:
    stack: list[tuple[int, str]] = []
    result: dict[int, tuple[str, ...]] = {}
    for index, line in enumerate(lines):
        match = HEADING_RE.match(line)
        if match:
            level, title = len(match.group(1)), match.group(2).strip()
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
        result[index] = tuple(title for _, title in stack)
    return result


def _fingerprint(kind: str, raw: str) -> str:
    normalized = "\n".join(line.rstrip() for line in raw.strip().splitlines())
    return hashlib.sha256(f"{kind}\0{normalized}".encode("utf-8")).hexdigest()


def _table_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_table_data(line: str) -> bool:
    cells = _table_cells(line)
    return (
        line.strip().startswith("|")
        and len(cells) >= 2
        and not all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)
        and not any(cell.casefold() in {"language", "degree", "qualification", "proficiency"} for cell in cells)
    )


def parse_candidate_entries(markdown: str) -> list[SourceEntry]:
    lines = markdown.splitlines()
    paths = _headings(lines)
    entries: list[SourceEntry] = []
    counts: defaultdict[tuple[str, str], int] = defaultdict(int)
    consumed: set[int] = set()

    def add(kind: str, section: str, fields: dict[str, Any], start: int, end: int) -> None:
        metadata_start = start
        embedded_id = None
        if start > 0:
            match = ENTRY_ID_RE.match(lines[start - 1])
            if match and start - 1 not in consumed:
                embedded_id = match.group(1)
                metadata_start = start - 1
                consumed.add(start - 1)
        raw = "\n".join(lines[metadata_start:end])
        fingerprint = _fingerprint(kind, raw if embedded_id is None else "\n".join(lines[start:end]))
        occurrence = counts[(kind, fingerprint)]
        counts[(kind, fingerprint)] += 1
        entries.append(SourceEntry(embedded_id, kind, section, fields, metadata_start, end, fingerprint, occurrence))
        consumed.update(range(metadata_start, end))

    index = 0
    while index < len(lines):
        if index in consumed:
            index += 1
            continue
        line = lines[index]
        path = paths.get(index, ())
        section = path[-1] if path else ""

        employment = EMPLOYMENT_RE.match(line)
        if employment and len(path) >= 2 and path[-2] == "Professional Experience":
            end = index + 1
            while end < len(lines):
                heading = HEADING_RE.match(lines[end])
                if heading and len(heading.group(1)) <= 3:
                    break
                end += 1
            body = lines[index + 1:end]
            location = ""
            details: list[str] = []
            for body_line in body:
                stripped = body_line.strip()
                if not stripped or stripped.startswith("<!--"):
                    continue
                if stripped.startswith("-"):
                    details.append(stripped[1:].strip())
                elif not location:
                    location = stripped
            title, employer, dates = employment.groups()
            add("employment", "Professional Experience", {
                "job_title": title, "employer": employer, "date_range": dates,
                "location": location, "details": details,
            }, index, end)
            index = end
            continue

        if section == "Identity":
            match = FIELD_RE.match(line)
            if match:
                add("identity", section, {"label": match.group(1), "value": match.group(2)}, index, index + 1)
        elif section == "Education" and line.lstrip().startswith("-"):
            value = line.split("-", 1)[1].strip()
            match = re.match(r"^\*\*(.+?)\*\*\s*(.*)$", value)
            remainder = match.group(2).strip() if match else ""
            key_topics = ""
            if " — Key topics: " in remainder:
                remainder, key_topics = remainder.split(" — Key topics: ", 1)
            date_range = ""
            dates = re.match(r"^\((.+?)\)\s*(.*)$", remainder)
            if dates:
                date_range, remainder = dates.groups()
            add("education", section, {
                "qualification": match.group(1) if match else value,
                "date_range": date_range,
                "institution": re.sub(r"^-\s*", "", remainder).strip(),
                "key_topics": key_topics,
            }, index, index + 1)
        elif section == "Education" and _is_table_data(line):
            cells = _table_cells(line)
            add("education", section, {
                "qualification": cells[0],
                "date_range": cells[1] if len(cells) > 2 else "",
                "institution": cells[2] if len(cells) > 2 else cells[1],
                "key_topics": cells[3] if len(cells) > 3 else "",
            }, index, index + 1)
        elif section == "Professional Experience" and line.lstrip().startswith("-"):
            add("achievement", section, {"value": line.split("-", 1)[1].strip()}, index, index + 1)
        elif "Technical Skills" in path and line.lstrip().startswith("-"):
            match = FIELD_RE.match(line)
            value = match.group(2) if match else line.split("-", 1)[1].strip()
            if match:
                value = f"{match.group(1)}: {value}"
            add("technical_skill", section, {"subsection": section if section != "Technical Skills" else "Skills", "value": value}, index, index + 1)
        elif section == "Certifications" and line.lstrip().startswith("-"):
            add("certification", section, {"value": re.sub(r"^\*\*(.+?)\*\*$", r"\1", line.split("-", 1)[1].strip())}, index, index + 1)
        elif section == "Independent Projects" and line.lstrip().startswith("-"):
            match = re.match(r"^\s*-\s+\*\*(.+?)\*\*\s*:?\s*(.+)$", line)
            if match:
                add("project", section, {"name": match.group(1).rstrip(":").strip(), "description": match.group(2)}, index, index + 1)
        elif section == "Publications" and re.match(r"^\s*\d+\.\s+", line):
            add("publication", section, {"value": re.sub(r"^\s*\d+\.\s+", "", line)}, index, index + 1)
        elif section == "Awards" and line.lstrip().startswith("-"):
            add("award", section, {"value": line.split("-", 1)[1].strip()}, index, index + 1)
        elif section == "Languages" and _is_table_data(line):
            cells = _table_cells(line)
            add("language", section, {
                "language": cells[0], "proficiency": cells[1],
                "evidence": cells[2] if len(cells) > 2 else "",
            }, index, index + 1)
        index += 1
    return entries


def _assign_entry_ids(conn: sqlite3.Connection, entries: list[SourceEntry]) -> None:
    now = _now()
    seen_ids: set[str] = set()
    for entry in entries:
        if entry.entry_id:
            if entry.entry_id in seen_ids:
                raise ProfileManagerError(f"duplicate profile entry identity {entry.entry_id}")
            seen_ids.add(entry.entry_id)
            conn.execute(
                "INSERT INTO profile_source_entries "
                "(entry_id, source_path, entry_kind, fingerprint, occurrence, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET "
                "entry_kind=excluded.entry_kind, fingerprint=excluded.fingerprint, "
                "occurrence=excluded.occurrence, updated_at=excluded.updated_at",
                (entry.entry_id, CANDIDATE_SOURCE, entry.kind, entry.fingerprint, entry.occurrence, now, now),
            )
            continue
        row = conn.execute(
            "SELECT entry_id FROM profile_source_entries WHERE source_path=? AND "
            "entry_kind=? AND fingerprint=? AND occurrence=?",
            (CANDIDATE_SOURCE, entry.kind, entry.fingerprint, entry.occurrence),
        ).fetchone()
        entry.entry_id = row["entry_id"] if row else f"profile-entry-{uuid.uuid4().hex[:20]}"
        seen_ids.add(entry.entry_id)
        if row is None:
            conn.execute(
                "INSERT INTO profile_source_entries "
                "(entry_id, source_path, entry_kind, fingerprint, occurrence, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (entry.entry_id, CANDIDATE_SOURCE, entry.kind, entry.fingerprint, entry.occurrence, now, now),
            )


def _public_entry(entry: SourceEntry) -> dict[str, Any]:
    return {
        "entry_id": entry.entry_id,
        "kind": entry.kind,
        "section": entry.section,
        "label": ENTRY_DEFINITIONS[entry.kind]["label"],
        "fields": entry.fields,
    }


def get_profile_manager(conn: sqlite3.Connection, *, root: str | Path) -> dict[str, Any]:
    with _MUTATION_LOCK:
        path = _profile_path(root)
        if not path.is_file():
            raise ProfileManagerError("canonical candidate profile source was not found")
        entries = parse_candidate_entries(path.read_text(encoding="utf-8"))
        _assign_entry_ids(conn, entries)
        conn.commit()
        sources = list_profile_source_settings(conn)
        current = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
        return {
            "revision": _revision(root, sources),
            "entries": [_public_entry(entry) for entry in entries],
            "sources": sources,
            "entry_definitions": ENTRY_DEFINITIONS,
            "current_snapshot_id": current["id"] if current else None,
            "current_content_id": current["content_id"] if current else None,
        }


def _clean_line(value: Any, field: str, *, required: bool = True) -> str:
    if not isinstance(value, str):
        raise ProfileManagerError(f"{field} must be text")
    result = " ".join(value.split())
    if required and not result:
        raise ProfileManagerError(f"{field.replace('_', ' ')} is required")
    if len(result) > MAX_FIELD_LENGTH:
        raise ProfileManagerError(f"{field.replace('_', ' ')} is too long")
    return result


def _normalize_fields(kind: str, fields: dict[str, Any]) -> dict[str, Any]:
    if kind not in ENTRY_DEFINITIONS:
        raise ProfileManagerError(f"unsupported profile entry kind {kind!r}")
    if not isinstance(fields, dict):
        raise ProfileManagerError("entry fields must be an object")
    allowed = set(ENTRY_DEFINITIONS[kind]["fields"])
    unknown = set(fields) - allowed
    if unknown:
        raise ProfileManagerError("unsupported entry fields: " + ", ".join(sorted(unknown)))
    result: dict[str, Any] = {}
    for field in allowed:
        value = fields.get(field, [] if field == "details" else "")
        optional = field in {
            "location", "details", "institution", "evidence", "date_range", "key_topics"
        }
        if field == "details":
            if not isinstance(value, list):
                raise ProfileManagerError("details must be an array")
            result[field] = [_clean_line(item, "detail") for item in value if str(item).strip()]
        else:
            result[field] = _clean_line(value, field, required=not optional)
    return result


def _render_entry(entry_id: str, kind: str, fields: dict[str, Any]) -> list[str]:
    marker = f"<!-- profile-entry-id: {entry_id} -->"
    if kind == "identity":
        body = [f"- **{fields['label']}:** {fields['value']}"]
    elif kind == "employment":
        body = [f"### {fields['job_title']} - {fields['employer']} ({fields['date_range']})"]
        if fields["location"]:
            body.extend(["", fields["location"]])
        if fields["details"]:
            body.append("")
            body.extend(f"- {detail}" for detail in fields["details"])
    elif kind == "education":
        dates = f" ({fields['date_range']})" if fields["date_range"] else ""
        institution = f" - {fields['institution']}" if fields["institution"] else ""
        topics = f" — Key topics: {fields['key_topics']}" if fields["key_topics"] else ""
        body = [f"- **{fields['qualification']}**{dates}{institution}{topics}"]
    elif kind in {"achievement", "certification", "technical_skill", "award"}:
        body = [f"- {fields['value']}"]
    elif kind == "project":
        body = [f"- **{fields['name']}:** {fields['description']}"]
    elif kind == "publication":
        body = [f"1. {fields['value']}"]
    elif kind == "language":
        body = [f"| {fields['language']} | {fields['proficiency']} | {fields['evidence']} |"]
    else:
        raise ProfileManagerError(f"unsupported profile entry kind {kind!r}")
    return [marker, *body]


def _section_bounds(lines: list[str], title: str, level: int = 2) -> tuple[int, int] | None:
    start = None
    for index, line in enumerate(lines):
        match = HEADING_RE.match(line)
        if not match:
            continue
        heading_level = len(match.group(1))
        if start is None and heading_level == level and match.group(2).strip() == title:
            start = index
            continue
        if start is not None and heading_level <= level:
            return start, index
    return (start, len(lines)) if start is not None else None


def _insert_entry(lines: list[str], kind: str, fields: dict[str, Any], rendered: list[str]) -> list[str]:
    definition = ENTRY_DEFINITIONS[kind]
    section = definition["section"]
    if kind == "technical_skill":
        main = _section_bounds(lines, "Technical Skills")
        if main is None:
            lines.extend(["", "## Technical Skills", "", f"### {fields['subsection']}", ""])
            insert_at = len(lines)
        else:
            subsection = fields["subsection"]
            start, end = main
            sub_start = None
            sub_end = end
            for index in range(start + 1, end):
                match = HEADING_RE.match(lines[index])
                if match and len(match.group(1)) == 3:
                    if sub_start is not None:
                        sub_end = index
                        break
                    if match.group(2).strip() == subsection:
                        sub_start = index
            if sub_start is None:
                lines[end:end] = ["", f"### {subsection}", "", *rendered]
                return lines
            insert_at = sub_end
    else:
        bounds = _section_bounds(lines, section)
        if bounds is None:
            lines.extend(["", f"## {section}", ""])
            insert_at = len(lines)
            if kind == "language":
                lines.extend(["| Language | Proficiency | Evidence |", "| --- | --- | --- |"])
                insert_at = len(lines)
        else:
            insert_at = bounds[1]
    prefix = [] if insert_at == 0 or (insert_at > 0 and not lines[insert_at - 1].strip()) else [""]
    lines[insert_at:insert_at] = [*prefix, *rendered, ""]
    return lines


def _build_prospective_snapshot(
    conn: sqlite3.Connection, root: str | Path, markdown: str
) -> dict[str, Any]:
    import shutil
    import tempfile

    with tempfile.TemporaryDirectory(prefix="profile-manager-") as temp_dir:
        validation_root = Path(temp_dir)
        root_path = Path(root).resolve()
        for relative in SOURCE_PATHS:
            destination = validation_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if relative == CANDIDATE_SOURCE:
                destination.write_text(markdown, encoding="utf-8")
            else:
                source = root_path / relative
                if not source.is_file():
                    raise ProfileManagerError(f"required candidate source not found: {relative}")
                shutil.copyfile(source, destination)
        snapshot = build_snapshot(
            validation_root, included_sources=included_profile_sources(conn)
        )
        candidate_has_name = any(
            claim.get("source", {}).get("file") == CANDIDATE_SOURCE
            and claim.get("category") == "identity"
            and claim.get("field") == "name"
            and not claim.get("placeholder", False)
            for claim in snapshot.get("claims", [])
        )
        if not candidate_has_name or not profile_snapshot_is_ready({"payload": snapshot}):
            raise ProfileManagerError(
                "profile mutation would leave the Evidence Profile without an explicit, "
                "non-conflicted candidate name"
            )
        return snapshot


def _persist_mutation(
    conn: sqlite3.Connection, *, root: str | Path, expected_revision: str,
    operation: Any,
) -> dict[str, Any]:
    with _MUTATION_LOCK:
        path = _profile_path(root)
        previous = path.read_bytes()
        wrote_source = False
        try:
            conn.execute("BEGIN IMMEDIATE")
            sources = list_profile_source_settings(conn)
            if _revision(root, sources) != expected_revision:
                raise ProfileRevisionConflict(
                    "Your Evidence Profile changed after this page was opened. "
                    "Reload it before saving this change."
                )
            markdown = previous.decode("utf-8")
            entries = parse_candidate_entries(markdown)
            _assign_entry_ids(conn, entries)
            prospective, source_changed = operation(markdown, entries)
            if source_changed and prospective == markdown:
                raise ProfileManagerError("profile mutation did not change the source")
            snapshot = _build_prospective_snapshot(conn, root, prospective)
            if source_changed:
                _atomic_write_bytes(path, prospective.encode("utf-8"))
                wrote_source = True
            ensure_profile_workspace(conn, commit=False)
            artifact = save_artifact(
                conn, workspace_id=PROFILE_WORKSPACE_ID,
                artifact_type="profile_snapshot", payload=snapshot,
                content_id=profile_snapshot_content_id(snapshot), commit=False,
            )
            new_entries = parse_candidate_entries(prospective)
            _assign_entry_ids(conn, new_entries)
            conn.commit()
        except Exception:
            conn.rollback()
            if wrote_source:
                _atomic_write_bytes(path, previous)
            raise
        manager = get_profile_manager(conn, root=root)
        return {"profile": artifact, "manager": manager}


def create_profile_entry(
    conn: sqlite3.Connection, *, root: str | Path, expected_revision: str,
    kind: str, fields: dict[str, Any],
) -> dict[str, Any]:
    normalized = _normalize_fields(kind, fields)
    entry_id = f"profile-entry-{uuid.uuid4().hex[:20]}"

    def operation(markdown: str, entries: list[SourceEntry]) -> tuple[str, bool]:
        lines = markdown.splitlines()
        _insert_entry(lines, kind, normalized, _render_entry(entry_id, kind, normalized))
        return "\n".join(lines).rstrip() + "\n", True

    result = _persist_mutation(
        conn, root=root, expected_revision=expected_revision, operation=operation
    )
    result["entry_id"] = entry_id
    return result


def update_profile_entry(
    conn: sqlite3.Connection, *, root: str | Path, expected_revision: str,
    entry_id: str, kind: str, fields: dict[str, Any],
) -> dict[str, Any]:
    normalized = _normalize_fields(kind, fields)

    def operation(markdown: str, entries: list[SourceEntry]) -> tuple[str, bool]:
        entry = next((item for item in entries if item.entry_id == entry_id), None)
        if entry is None:
            raise ProfileEntryNotFound(f"unknown profile entry {entry_id!r}")
        if entry.kind != kind:
            raise ProfileManagerError("profile entry kind cannot be changed")
        lines = markdown.splitlines()
        lines[entry.start:entry.end] = _render_entry(entry_id, kind, normalized)
        return "\n".join(lines).rstrip() + "\n", True

    return _persist_mutation(
        conn, root=root, expected_revision=expected_revision, operation=operation
    )


def delete_profile_entry(
    conn: sqlite3.Connection, *, root: str | Path, expected_revision: str,
    entry_id: str,
) -> dict[str, Any]:
    def operation(markdown: str, entries: list[SourceEntry]) -> tuple[str, bool]:
        entry = next((item for item in entries if item.entry_id == entry_id), None)
        if entry is None:
            raise ProfileEntryNotFound(f"unknown profile entry {entry_id!r}")
        if entry.kind == "identity" and entry.fields.get("label", "").casefold() == "name":
            raise ProfileManagerError("the required candidate name cannot be deleted")
        lines = markdown.splitlines()
        del lines[entry.start:entry.end]
        conn.execute("DELETE FROM profile_source_entries WHERE entry_id=?", (entry_id,))
        return "\n".join(lines).rstrip() + "\n", True

    return _persist_mutation(
        conn, root=root, expected_revision=expected_revision, operation=operation
    )


def update_profile_source(
    conn: sqlite3.Connection, *, root: str | Path, expected_revision: str,
    source_path: str, included: bool,
) -> dict[str, Any]:
    def operation(markdown: str, entries: list[SourceEntry]) -> tuple[str, bool]:
        set_supplemental_source_included(conn, source_path, included)
        return markdown, False

    return _persist_mutation(
        conn, root=root, expected_revision=expected_revision, operation=operation
    )
