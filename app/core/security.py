"""Filesystem boundary checks for local workflow artifacts."""

import re
from pathlib import Path


class SecurityError(Exception):
    """Raised when a path crosses an application boundary."""


def sanitize_slug(value: str) -> str:
    """Convert user or job text into a conservative filesystem slug."""
    slug = re.sub(r"[^a-z0-9_-]+", "_", value.lower())
    slug = re.sub(r"_+", "_", slug).strip("_-")
    return slug or "unnamed"


def validate_path_boundary(target_path: Path, base_dir: Path) -> Path:
    """Return a resolved path only when it is inside ``base_dir``."""
    resolved_base = base_dir.resolve()
    resolved_target = target_path.resolve()
    try:
        resolved_target.relative_to(resolved_base)
    except ValueError as exc:
        raise SecurityError(
            f"Path traversal blocked: {target_path} is outside {base_dir}"
        ) from exc
    return resolved_target