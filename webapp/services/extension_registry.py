# webapp/services/extension_registry.py
"""Server-resolved active-extension selection.

The HTTP client selects extensions by the `id` it saw from
list_installed_extensions — never a filesystem path. This keeps the product
boundary correct even though Ticket 9 is a local-only, single-user app: the
web layer never accepts a client-supplied path and hands it to a filesystem
read.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from product.extensions import ExtensionValidationError, load_extension, load_extensions


class ExtensionRegistryError(RuntimeError):
    pass


def list_installed_extensions(extensions_dir: Path) -> list[dict[str, Any]]:
    extensions_dir = Path(extensions_dir)
    if not extensions_dir.is_dir():
        return []
    results: list[dict[str, Any]] = []
    for candidate in sorted(extensions_dir.iterdir()):
        manifest_path = candidate / "extension.json"
        if not manifest_path.is_file():
            continue
        try:
            extension = load_extension(manifest_path)
        except ExtensionValidationError:
            continue
        results.append({
            "id": extension["id"], "version": extension["version"],
            "name": extension["name"], "path": str(manifest_path),
        })
    return results


def resolve_active_extensions(extensions_dir: Path, extension_ids: list[str]) -> list[dict[str, Any]]:
    installed = {ext["id"]: ext["path"] for ext in list_installed_extensions(extensions_dir)}
    missing = [ext_id for ext_id in extension_ids if ext_id not in installed]
    if missing:
        raise ExtensionRegistryError(f"extensions not_installed: {missing}")
    paths = [installed[ext_id] for ext_id in extension_ids]
    return load_extensions(paths)
