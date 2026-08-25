"""Pure closed contract for exact selected-file Application Packs."""
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from product.application_document_contract import DOCUMENT_KINDS, DOCUMENT_ORIGINS, validate_display_filename
from product.application_pack_contract import validate_application_pack_v1


APPLICATION_PACK_V2 = "application-pack.v2"
_ROOT_KEYS = {"schema_version", "generation_basis", "final_documents", "confirmed_account_id", "confirmed_at", "completion_contract_version"}
_GENERATION_KEYS = {"generation_artifact_id", "reviewed_application_pack"}
_DOCUMENT_KEYS = {"document_version_id", "document_kind", "origin", "source_generation_artifact_id", "sha256", "byte_length", "original_filename"}
_SHA = re.compile(r"[0-9a-f]{64}")


class ApplicationPackV2ContractError(ValueError):
    """Raised when a selected-file Application Pack is invalid."""


def _object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ApplicationPackV2ContractError(f"{label} has invalid keys")
    return value


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApplicationPackV2ContractError(f"{label} must be a non-empty string")
    return value


def _manifest_from_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "document_version_id": row["id"],
        "document_kind": row["document_kind"],
        "origin": row["origin"],
        "source_generation_artifact_id": row["source_generation_artifact_id"],
        "sha256": row["sha256"],
        "byte_length": row["byte_length"],
        "original_filename": row["original_filename"],
    }


def build_application_pack_v2(*, generation_artifact: dict[str, Any], selected_documents: dict[str, dict[str, Any]], verified_documents: dict[str, dict[str, Any]], workspace_id: str, account_id: str, eligible_reusable_document_ids: set[str], confirmed_at: str) -> dict[str, Any]:
    if generation_artifact.get("artifact_type") != "application_document_generation" or generation_artifact.get("workspace_id") != workspace_id:
        raise ApplicationPackV2ContractError("generation artifact does not belong to the workspace")
    generation = generation_artifact.get("payload")
    if not isinstance(generation, dict) or generation.get("account_id") != account_id:
        raise ApplicationPackV2ContractError("generation artifact does not belong to the account")
    if set(selected_documents) != DOCUMENT_KINDS or set(verified_documents) != DOCUMENT_KINDS:
        raise ApplicationPackV2ContractError("exactly one CV and cover letter are required")
    manifests: dict[str, dict[str, Any]] = {}
    ids: set[str] = set()
    for kind in ("cv", "cover_letter"):
        row = selected_documents[kind]
        if row != verified_documents[kind]:
            raise ApplicationPackV2ContractError("selected document metadata did not verify exactly")
        if row.get("account_id") != account_id or row.get("document_kind") != kind:
            raise ApplicationPackV2ContractError("selected document owner or kind is invalid")
        if row.get("source_workspace_id") != workspace_id and row.get("id") not in eligible_reusable_document_ids:
            raise ApplicationPackV2ContractError("selected document is not available to this workspace")
        if row.get("id") in ids:
            raise ApplicationPackV2ContractError("final documents must be distinct")
        ids.add(row["id"])
        manifests[kind] = _manifest_from_row(row)
    basis = generation.get("reviewed_application_pack")
    validate_application_pack_v1(basis)
    pack = {
        "schema_version": APPLICATION_PACK_V2,
        "generation_basis": {"generation_artifact_id": generation_artifact["id"], "reviewed_application_pack": deepcopy(basis)},
        "final_documents": manifests,
        "confirmed_account_id": account_id,
        "confirmed_at": confirmed_at,
        "completion_contract_version": basis.get("completion_contract_version"),
    }
    validate_application_pack_v2(pack)
    return pack


def validate_application_pack_v2(value: Any) -> dict[str, Any]:
    pack = _object(value, _ROOT_KEYS, "application-pack.v2")
    if pack["schema_version"] != APPLICATION_PACK_V2:
        raise ApplicationPackV2ContractError("unsupported application pack version")
    generation = _object(pack["generation_basis"], _GENERATION_KEYS, "generation_basis")
    _text(generation["generation_artifact_id"], "generation artifact ID")
    try:
        validate_application_pack_v1(generation["reviewed_application_pack"])
    except ValueError as exc:
        raise ApplicationPackV2ContractError("embedded reviewed basis is invalid") from exc
    if pack["completion_contract_version"] != generation["reviewed_application_pack"].get("completion_contract_version"):
        raise ApplicationPackV2ContractError("completion contract version does not match reviewed basis")
    _text(pack["confirmed_account_id"], "confirmed account ID")
    _text(pack["confirmed_at"], "confirmation timestamp")
    documents = _object(pack["final_documents"], set(DOCUMENT_KINDS), "final_documents")
    ids = set()
    for kind in ("cv", "cover_letter"):
        item = _object(documents[kind], _DOCUMENT_KEYS, f"final_documents.{kind}")
        if item["document_kind"] != kind or item["origin"] not in DOCUMENT_ORIGINS:
            raise ApplicationPackV2ContractError("final document kind or origin is invalid")
        _text(item["document_version_id"], "document version ID")
        if item["document_version_id"] in ids:
            raise ApplicationPackV2ContractError("final documents must be distinct")
        ids.add(item["document_version_id"])
        validate_display_filename(item["original_filename"])
        if not isinstance(item["sha256"], str) or _SHA.fullmatch(item["sha256"]) is None:
            raise ApplicationPackV2ContractError("final document SHA-256 is invalid")
        if not isinstance(item["byte_length"], int) or isinstance(item["byte_length"], bool) or item["byte_length"] <= 0:
            raise ApplicationPackV2ContractError("final document byte length is invalid")
        generation_id = item["source_generation_artifact_id"]
        if item["origin"] == "ai_generated" and not isinstance(generation_id, str):
            raise ApplicationPackV2ContractError("AI document generation provenance is required")
        if item["origin"] == "user_uploaded" and generation_id is not None:
            raise ApplicationPackV2ContractError("user upload cannot claim AI provenance")
    return pack


def application_pack_completion_input(payload: dict[str, Any]) -> dict[str, Any]:
    """Project the exact immutable pack payload into the legacy completion input."""
    if isinstance(payload, dict) and payload.get("schema_version") == APPLICATION_PACK_V2:
        validate_application_pack_v2(payload)
        return payload["generation_basis"]["reviewed_application_pack"]
    return payload
