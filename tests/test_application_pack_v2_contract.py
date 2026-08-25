import ast
import copy
import json
from pathlib import Path

import pytest

import product.application_pack_v2_contract as contract


def _inputs():
    basis = json.loads((Path(__file__).parent / "fixtures/application_pack/v1_valid.json").read_text(encoding="utf-8"))
    generation = {"id": "art_generation", "workspace_id": "ws_1", "artifact_type": "application_document_generation", "payload": {"account_id": "account_local", "reviewed_application_pack": basis}}
    def row(kind, origin):
        return {"id": f"docv_{kind}", "account_id": "account_local", "source_workspace_id": "ws_1", "document_kind": kind, "origin": origin, "original_filename": f"{kind}.docx", "media_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "byte_length": 10, "sha256": ("a" if kind == "cv" else "b") * 64, "storage_key": "ignored", "source_generation_artifact_id": "art_generation" if origin == "ai_generated" else None, "created_at": "now"}
    docs = {"cv": row("cv", "user_uploaded"), "cover_letter": row("cover_letter", "ai_generated")}
    return generation, docs


def test_builds_and_validates_closed_exact_manifest():
    generation, docs = _inputs()
    pack = contract.build_application_pack_v2(generation_artifact=generation, selected_documents=docs, verified_documents=copy.deepcopy(docs), workspace_id="ws_1", account_id="account_local", eligible_reusable_document_ids=set(), confirmed_at="2026-08-25T00:00:00+00:00")
    assert contract.validate_application_pack_v2(pack) == pack
    assert pack["final_documents"]["cv"]["source_generation_artifact_id"] is None


def test_construction_rejects_metadata_mismatch_or_ineligible_other_workspace():
    generation, docs = _inputs()
    verified = copy.deepcopy(docs)
    verified["cv"]["sha256"] = "c" * 64
    with pytest.raises(contract.ApplicationPackV2ContractError):
        contract.build_application_pack_v2(generation_artifact=generation, selected_documents=docs, verified_documents=verified, workspace_id="ws_1", account_id="account_local", eligible_reusable_document_ids=set(), confirmed_at="now")
    docs["cv"]["source_workspace_id"] = "ws_other"
    with pytest.raises(contract.ApplicationPackV2ContractError):
        contract.build_application_pack_v2(generation_artifact=generation, selected_documents=docs, verified_documents=docs, workspace_id="ws_1", account_id="account_local", eligible_reusable_document_ids=set(), confirmed_at="now")


def test_pure_contract_has_no_webapp_imports():
    tree = ast.parse(Path(contract.__file__).read_text(encoding="utf-8"))
    imports = [node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
    assert not any(name and name.startswith("webapp") for name in imports)
