from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROFILE_SKILL_GLOB = ".claude/skills/job-application-assistant/*.md"


@dataclass
class Template:
    metadata: dict[str, Any]
    system: str
    instruction: str


@dataclass
class EditResult:
    applied: list[dict[str, str]]
    failures: list[dict[str, str]]
    files: dict[str, str]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def load_template(path: Path) -> Template:
    text = read_text(path)
    first_line, _, rest = text.partition("\n")
    metadata: dict[str, Any] = {}
    try:
        metadata = json.loads(first_line)
    except json.JSONDecodeError:
        rest = text

    system = extract_section(rest, "SYSTEM")
    instruction = extract_section(rest, "INSTRUCTION")
    if not system and not instruction:
        instruction = rest.strip()
    return Template(metadata=metadata, system=system, instruction=instruction)


def extract_section(text: str, heading: str) -> str:
    pattern = rf"^## {re.escape(heading)}\s*$"
    match = re.search(pattern, text, flags=re.MULTILINE)
    if not match:
        return ""
    start = match.end()
    next_heading = re.search(r"^## [A-Z_ ]+\s*$", text[start:], flags=re.MULTILINE)
    end = start + next_heading.start() if next_heading else len(text)
    return text[start:end].strip()


def render_template(template: Template, values: dict[str, Any]) -> list[dict[str, str]]:
    rendered_system = replace_placeholders(template.system, values)
    rendered_instruction = replace_placeholders(template.instruction, values)
    messages: list[dict[str, str]] = []
    if rendered_system:
        messages.append({"role": "system", "content": rendered_system})
    messages.append({"role": "user", "content": rendered_instruction})
    return messages


def replace_placeholders(text: str, values: dict[str, Any]) -> str:
    rendered = text
    for key, value in values.items():
        rendered = rendered.replace("{{" + key + "}}", str(value))
    return rendered


def read_profile_bundle(profile_path: Path, root: Path, verbose: bool = False) -> str:
    pieces = [f"# Profile: {profile_path}\n\n{read_text(profile_path)}"]
    if profile_path.resolve() == (root / "CLAUDE.md").resolve() or (root / ".claude").exists():
        for skill_path in sorted(root.glob(PROFILE_SKILL_GLOB)):
            pieces.append(f"# {skill_path.as_posix()}\n\n{read_text(skill_path)}")
    bundle = "\n\n---\n\n".join(pieces)
    if verbose:
        return bundle
    return truncate_with_reference(bundle, 12000, profile_path)


def truncate_with_reference(text: str, max_chars: int, source_path: Path) -> str:
    if len(text) <= max_chars:
        return text
    return (
        text[:max_chars]
        + "\n\n[PROFILE_SNIPPET_TRUNCATED]\n"
        + f"SEE_FULL_PROFILE: file://{source_path.resolve().as_posix()}"
    )


def parse_json_object(text: str) -> dict[str, Any]:
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass
    candidate = extract_first_json(text, "{", "}")
    if candidate:
        value = json.loads(candidate)
        if isinstance(value, dict):
            return value
    raise ValueError("No JSON object found in model response.")


def parse_json_array(text: str) -> list[dict[str, Any]]:
    try:
        value = json.loads(text)
        if isinstance(value, list):
            return value
    except json.JSONDecodeError:
        pass
    candidate = extract_first_json(text, "[", "]")
    if candidate:
        value = json.loads(candidate)
        if isinstance(value, list):
            return value
    return []


def extract_first_json(text: str, opener: str, closer: str) -> str | None:
    start = text.find(opener)
    if start == -1:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def parse_reviewer_response(text: str) -> tuple[list[dict[str, Any]], str]:
    start_marker = "PART_A_JSON_START"
    end_marker = "PART_A_JSON_END"
    if start_marker in text and end_marker in text:
        part_a = text.split(start_marker, 1)[1].split(end_marker, 1)[0].strip()
        part_b = text.split(end_marker, 1)[1].strip()
        return parse_json_array(part_a), part_b

    try:
        obj = parse_json_object(text)
        if "part_a" in obj:
            part_a_value = obj.get("part_a", [])
            part_b = str(obj.get("part_b", ""))
            return list(part_a_value), part_b
    except (ValueError, TypeError):
        pass

    edits = parse_json_array(text)
    part_b = text
    if edits:
        array_text = extract_first_json(text, "[", "]") or ""
        part_b = text.replace(array_text, "", 1).strip()
    return edits, part_b


def apply_structured_edits(files: dict[str, str], edits: list[dict[str, Any]]) -> EditResult:
    updated = dict(files)
    applied: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []

    for edit in edits:
        file_name = str(edit.get("file", ""))
        old = str(edit.get("old_string", ""))
        new = str(edit.get("new_string", ""))
        if file_name not in updated:
            failures.append({"file": file_name, "reason": "file is not part of current drafts"})
            continue
        count = updated[file_name].count(old)
        if not old or count != 1:
            failures.append({"file": file_name, "reason": f"old_string occurrence count was {count}"})
            continue
        updated[file_name] = updated[file_name].replace(old, new, 1)
        applied.append({"file": file_name, "reason": str(edit.get("reason", ""))})

    if failures:
        return EditResult(applied=[], failures=failures, files=files)
    return EditResult(applied=applied, failures=failures, files=updated)


def sanitize_filename_part(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", value).strip("_")
    return cleaned or "Unknown"


def redact_pii(text: str) -> str:
    text = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "[REDACTED_EMAIL]", text)
    text = re.sub(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)", "[REDACTED_PHONE]", text)
    return text


def run_command(command: list[str], cwd: Path) -> tuple[int, str]:
    completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    return completed.returncode, (completed.stdout + completed.stderr)


def executable_exists(name: str) -> bool:
    return shutil.which(name) is not None


def cleanup_latex_artifacts(directory: Path) -> None:
    for suffix in ("*.aux", "*.log", "*.out"):
        for path in directory.glob(suffix):
            path.unlink(missing_ok=True)
