import pytest

from product.application_document_contract import (
    DOCX_MEDIA_TYPE, ApplicationDocumentContractError, validate_document_version,
)


def _row(**changes):
    value = {"id": "docv_1", "account_id": "account_local", "source_workspace_id": "ws_1", "document_kind": "cv", "origin": "user_uploaded", "original_filename": "Final CV.docx", "media_type": DOCX_MEDIA_TYPE, "byte_length": 12, "sha256": "a" * 64, "storage_key": "sha256/aa/" + "a" * 64 + ".docx", "source_generation_artifact_id": None, "created_at": "2026-08-25T00:00:00+00:00"}
    value.update(changes)
    return value


def test_validates_closed_user_upload_metadata():
    assert validate_document_version(_row())["origin"] == "user_uploaded"


def test_ai_generation_provenance_is_required_and_upload_cannot_forge_it():
    assert validate_document_version(_row(origin="ai_generated", source_generation_artifact_id="art_1"))
    with pytest.raises(ApplicationDocumentContractError):
        validate_document_version(_row(origin="ai_generated"))
    with pytest.raises(ApplicationDocumentContractError):
        validate_document_version(_row(source_generation_artifact_id="art_fake"))


@pytest.mark.parametrize("filename", ["", "../x.docx", "x\\y.docx", "x.docm", "x\r.docx"])
def test_rejects_unsafe_filename(filename):
    with pytest.raises(ApplicationDocumentContractError):
        validate_document_version(_row(original_filename=filename))
