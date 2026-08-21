"""Safe first-run creation/import of the canonical candidate profile source."""
from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

from product.profile_snapshot import SOURCE_PATHS, build_snapshot
from webapp.services.pipeline import PipelineError, refresh_profile


CANDIDATE_PROFILE_PATH = Path(
    ".claude/skills/job-application-assistant/01-candidate-profile.md"
)
MAX_PROFILE_BYTES = 200_000
SETUP_MARKERS = (
    "<!-- SETUP: This file is populated by running /setup -->",
    "[YOUR_NAME]",
)


def profile_snapshot_is_ready(profile_artifact: dict[str, Any] | None) -> bool:
    """A usable profile must contain an explicit, non-conflicted candidate name."""

    if profile_artifact is None:
        return False
    payload = profile_artifact.get("payload", {})
    conflicted_concepts = {
        item.get("concept_id") for item in payload.get("conflicts", [])
    }
    return any(
        claim.get("category") == "identity"
        and claim.get("field") == "name"
        and not claim.get("placeholder", False)
        and claim.get("concept_id") not in conflicted_concepts
        for claim in payload.get("claims", [])
    )


def profile_source_is_unconfigured(root: str | Path) -> bool:
    target = Path(root).resolve() / CANDIDATE_PROFILE_PATH
    if not target.is_file():
        return True
    text = target.read_text(encoding="utf-8")
    return any(marker in text for marker in SETUP_MARKERS)


def profile_setup_state(
    root: str | Path, profile_artifact: dict[str, Any] | None
) -> dict[str, bool]:
    source_unconfigured = profile_source_is_unconfigured(root)
    return {
        "profile_ready": profile_snapshot_is_ready(profile_artifact),
        "setup_required": source_unconfigured,
        "refresh_available": not source_unconfigured,
    }


def render_basic_profile(data: dict[str, Any]) -> str:
    name = _one_line(data.get("name"), required=True)
    location = _one_line(data.get("location"))
    status = _one_line(data.get("status"))
    constraints = _one_line(data.get("constraints"))
    education = _lines(data.get("education", []))
    experience = _lines(data.get("experience", []))
    skills = _lines(data.get("skills", []))
    certifications = _lines(data.get("certifications", []))

    output = [
        "---",
        "framework_version: 1.1.1",
        "---",
        "",
        "# Candidate Profile",
        "",
        "## Identity",
        "",
        f"- **Name:** {name}",
    ]
    for label, value in (
        ("Location", location), ("Status", status), ("Constraints", constraints)
    ):
        if value:
            output.append(f"- **{label}:** {value}")
    _append_list_section(output, "Education", education)
    _append_list_section(output, "Professional Experience", experience)
    if skills:
        output.extend(["", "## Technical Skills", "", "### Skills"])
        output.extend(f"- {item}" for item in skills)
    _append_list_section(output, "Certifications", certifications)
    return "\n".join(output).rstrip() + "\n"


def setup_basic_profile(
    conn: sqlite3.Connection, *, root: str | Path, data: dict[str, Any]
) -> dict[str, Any]:
    return import_profile_markdown(conn, root=root, markdown=render_basic_profile(data))


def import_profile_markdown(
    conn: sqlite3.Connection, *, root: str | Path, markdown: str
) -> dict[str, Any]:
    root_path = Path(root).resolve()
    if not profile_source_is_unconfigured(root_path):
        raise PipelineError(
            "profile setup is only available while the canonical candidate profile is unconfigured"
        )
    _validate_markdown(markdown)
    _validate_prospective_snapshot(root_path, markdown)

    target = root_path / CANDIDATE_PROFILE_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    previous = target.read_bytes() if target.exists() else None
    _atomic_write(target, markdown)
    try:
        artifact = refresh_profile(conn, root=str(root_path))
    except Exception:
        if previous is None:
            target.unlink(missing_ok=True)
        else:
            _atomic_write_bytes(target, previous)
        raise
    if not profile_snapshot_is_ready(artifact):
        if previous is None:
            target.unlink(missing_ok=True)
        else:
            _atomic_write_bytes(target, previous)
        raise PipelineError("profile setup did not create a usable evidence snapshot")
    return artifact


def _validate_markdown(markdown: str) -> None:
    if not isinstance(markdown, str) or not markdown.strip():
        raise PipelineError("candidate profile Markdown is required")
    if "\x00" in markdown:
        raise PipelineError("candidate profile Markdown contains an invalid null character")
    if len(markdown.encode("utf-8")) > MAX_PROFILE_BYTES:
        raise PipelineError("candidate profile Markdown is too large")
    if "# Candidate Profile" not in markdown:
        raise PipelineError("candidate profile Markdown must contain a '# Candidate Profile' heading")


def _validate_prospective_snapshot(root: Path, markdown: str) -> None:
    with tempfile.TemporaryDirectory(prefix="profile-setup-") as temp_dir:
        validation_root = Path(temp_dir)
        for relative in SOURCE_PATHS:
            destination = validation_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if Path(relative) == CANDIDATE_PROFILE_PATH:
                destination.write_text(markdown, encoding="utf-8")
            else:
                source = root / relative
                if not source.is_file():
                    raise PipelineError(f"required candidate source not found: {relative}")
                shutil.copyfile(source, destination)
        try:
            snapshot = build_snapshot(validation_root)
        except Exception as exc:
            raise PipelineError(f"candidate profile import is invalid: {exc}") from exc
        candidate_claims = [
            claim for claim in snapshot["claims"]
            if claim["source"]["file"] == CANDIDATE_PROFILE_PATH.as_posix()
        ]
        if not any(
            claim["category"] == "identity"
            and claim["field"] == "name"
            and not claim["placeholder"]
            for claim in candidate_claims
        ):
            raise PipelineError("candidate profile must contain an explicit non-placeholder name")


def _atomic_write(target: Path, text: str) -> None:
    _atomic_write_bytes(target, text.encode("utf-8"))


def _atomic_write_bytes(target: Path, content: bytes) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, target)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _one_line(value: Any, *, required: bool = False) -> str:
    result = " ".join(str(value or "").split()).strip()
    if required and not result:
        raise PipelineError("name is required")
    return result


def _lines(values: Any) -> list[str]:
    if not isinstance(values, list):
        raise PipelineError("profile list fields must be arrays")
    return [line for value in values if (line := _one_line(value))]


def _append_list_section(output: list[str], title: str, values: list[str]) -> None:
    if values:
        output.extend(["", f"## {title}", ""])
        output.extend(f"- {item}" for item in values)
