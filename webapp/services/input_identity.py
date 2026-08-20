"""Deterministic identities for mutable server-side pipeline inputs."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from product.evaluation_policy import load_evaluation_policy
from product.extensions import load_extensions
from product.semantic_job_fit import load_semantic_fit_policy


def content_identity(prefix: str, value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    return f"{prefix}{hashlib.sha256(encoded).hexdigest()[:20]}"


def evaluation_policy_identity() -> str:
    return content_identity("evalpolicy_", load_evaluation_policy())


def semantic_fit_policy_identity() -> str:
    return content_identity("semfitpolicy_", load_semantic_fit_policy())


def application_intelligence_policy_identity() -> str:
    path = Path(__file__).resolve().parents[2] / "product" / "application_intelligence_policy.v0.json"
    return content_identity("aiintelpolicy_", json.loads(path.read_text(encoding="utf-8")))


def semantic_proposer_policy_identity() -> str:
    # Import lazily so offline persistence/staleness imports do not initialize
    # the hosted-provider adapter unnecessarily.
    from webapp.services.openai_semantic_proposer_client import semantic_proposer_policy_material

    return content_identity("semproppolicy_", semantic_proposer_policy_material())


def semantic_proposals_identity(proposals: dict[str, Any]) -> str:
    return content_identity("semprops_", proposals)


def active_extensions_identity(extensions: list[dict[str, Any]]) -> str:
    canonical = sorted(extensions, key=lambda item: (item["id"], item["version"]))
    return content_identity("activeext_", canonical)


def current_active_extensions_identity(
    stored_extensions: list[dict[str, Any]], extensions_dir: Path,
) -> str:
    ids = [item.get("id") for item in stored_extensions]
    if any(not isinstance(item, str) or not item for item in ids) or len(ids) != len(set(ids)):
        raise ValueError("stored active-extension identities are invalid or ambiguous")
    if not ids:
        return active_extensions_identity([])

    from webapp.services.extension_registry import list_installed_extensions

    installed = {item["id"]: item["path"] for item in list_installed_extensions(extensions_dir)}
    missing = [item for item in ids if item not in installed]
    if missing:
        raise ValueError(f"active extensions are no longer installed: {missing}")
    return active_extensions_identity(load_extensions([installed[item] for item in ids]))
