"""Read-safe legacy projection of an immutable Application Pack."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    return slug.strip("_") or "unknown"


def _json_section(lines: list[str], title: str, value: Any) -> None:
    lines.extend([f"## {title}", "", "```json", json.dumps(value, ensure_ascii=False, indent=2), "```", ""])


def _render_markdown(pack: dict[str, Any], *, projection_id: str | None = None) -> str:
    job = pack.get("job", {})
    lines = []
    if projection_id is not None:
        lines.extend([f"<!-- application-pack-artifact: {projection_id} -->", ""])
    lines.extend([
        "# Application Pack", "", f"**Company:** {job.get('company', '')}  ",
        f"**Title:** {job.get('title', '')}  ", "",
    ])
    _json_section(lines, "Source Artifacts", pack.get("source_artifacts", {}))
    _json_section(lines, "Job Posting Evidence", job)
    _json_section(lines, "Fit Summary", pack.get("fit_summary", {}))
    lines.extend(["## Recommendation", "", str(pack.get("recommendation", "")), ""])
    if pack.get("recommendation_reason"):
        lines.extend([str(pack["recommendation_reason"]), ""])
    lines.extend(["## CV Content", ""])
    lines.extend(f"- {unit.get('text', '')}" for unit in pack.get("cv_content", []))
    lines.extend(["", "## Cover Letter Content", ""])
    lines.extend(f"- {unit.get('text', '')}" for unit in pack.get("cover_letter_content", []))
    lines.append("")
    _json_section(lines, "Review and Exclusion Audit", pack.get("review_record", {}))
    return "\n".join(lines)


def write_application_pack_projection(
    pack: dict[str, Any], *, company: str, title: str, documents_root: Path,
    projection_id: str | None = None,
) -> Path:
    folder = Path(documents_root) / "applications" / f"{_slug(company)}_{_slug(title)}"
    folder.mkdir(parents=True, exist_ok=True)
    marker = f"<!-- application-pack-artifact: {projection_id} -->" if projection_id else None
    if marker is not None:
        for existing in sorted(folder.glob("application_pack*.md")):
            if existing.read_text(encoding="utf-8").startswith(marker):
                return existing
    target = folder / "application_pack.md"
    if target.exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        target = folder / f"application_pack_{stamp}.md"
        counter = 1
        while target.exists():
            target = folder / f"application_pack_{stamp}_{counter}.md"
            counter += 1
    target.write_text(_render_markdown(pack, projection_id=projection_id), encoding="utf-8")
    return target
