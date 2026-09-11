from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
EXTENSION_ROOT = ROOT / "extension"
BUILD_ROOT = EXTENSION_ROOT / "dist" / "extension"


@pytest.fixture(scope="module", autouse=True)
def production_extension_build():
    npm = shutil.which("npm")
    assert npm is not None, "npm is required to build the production extension"
    subprocess.run([npm, "run", "build"], cwd=EXTENSION_ROOT, check=True)


def _manifest_paths(manifest: dict) -> set[str]:
    paths: set[str] = set()
    background = manifest.get("background", {})
    if background.get("service_worker"):
        paths.add(background["service_worker"])
    action = manifest.get("action", {})
    if action.get("default_popup"):
        paths.add(action["default_popup"])
    for script in manifest.get("content_scripts", []):
        paths.update(script.get("js", []))
        paths.update(script.get("css", []))
    paths.update(manifest.get("icons", {}).values())
    return paths


def test_production_build_contains_every_manifest_referenced_file():
    manifest_path = BUILD_ROOT / "manifest.json"
    assert manifest_path.is_file()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    referenced = _manifest_paths(manifest)
    assert "background/index.js" in referenced
    assert referenced
    missing = sorted(path for path in referenced if not (BUILD_ROOT / path).is_file())
    assert missing == [], f"manifest references missing production files: {missing}"


def test_production_build_contains_injectable_content_runtime():
    content_runtime = BUILD_ROOT / "content" / "index.js"
    assert content_runtime.is_file()
    assert content_runtime.stat().st_size > 0
