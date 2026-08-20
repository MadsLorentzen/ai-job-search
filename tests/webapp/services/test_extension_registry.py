import json

import pytest

from webapp.services.extension_registry import (
    list_installed_extensions,
    resolve_active_extensions,
    ExtensionRegistryError,
)


def _write_extension(extensions_dir, ext_id, version="1.0.0"):
    # Directory name intentionally uses underscores to match the brief's
    # fixture shape (list_installed_extensions scans directories, not the
    # manifest id, to find candidates) while the manifest `id` field itself
    # must be valid kebab-case per product/extensions.py's ID_RE — the
    # brief's illustrative fixture used a bare id/publisher/trust/scope shape
    # (and status="active") that does not validate against the real schema
    # (verified against product/schemas/extension-package.v0.schema.json:
    # id must be kebab-case, publisher/trust/scope must be objects, and
    # status must be one of deprecated/draft/reviewed), so this fixture
    # supplies schema-valid values while preserving the test's intent.
    manifest_id = ext_id.replace("_", "-")
    ext_dir = extensions_dir / ext_id
    ext_dir.mkdir(parents=True)
    manifest = {
        "schema_version": "extension-package.v0", "id": manifest_id, "name": ext_id.replace("_", " ").title(),
        "version": version, "status": "reviewed", "description": "x",
        "publisher": {"name": "Acme", "type": "organization"},
        "trust": {"level": "unreviewed"},
        "metadata": {"created_date": "2026-01-01"},
        "scope": {},
    }
    (ext_dir / "extension.json").write_text(json.dumps(manifest), encoding="utf-8")
    return ext_dir


def test_list_installed_extensions_finds_all_valid_packages(tmp_path):
    _write_extension(tmp_path, "well_control")
    _write_extension(tmp_path, "hse_transition")
    listed = list_installed_extensions(tmp_path)
    ids = {ext["id"] for ext in listed}
    assert ids == {"well-control", "hse-transition"}


def test_list_installed_extensions_empty_dir_returns_empty_list(tmp_path):
    assert list_installed_extensions(tmp_path) == []


def test_resolve_active_extensions_by_id_not_path(tmp_path):
    _write_extension(tmp_path, "well_control")
    resolved = resolve_active_extensions(tmp_path, ["well-control"])
    assert resolved[0]["id"] == "well-control"


def test_resolve_active_extensions_rejects_unknown_id(tmp_path):
    _write_extension(tmp_path, "well_control")
    with pytest.raises(ExtensionRegistryError, match="not_installed"):
        resolve_active_extensions(tmp_path, ["not_installed"])
