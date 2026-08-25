import io
import zipfile

import pytest

from product.application_document_contract import DOCX_MEDIA_TYPE
from product.docx_package import DocxPackageError, validate_docx_package


TYPES = b'''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'''
RELS = b'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>'''


def _docx(extra=None, *, types=TYPES, rels=RELS):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("word/document.xml", b"<document/>")
        for name, value in extra or []:
            archive.writestr(name, value)
    return output.getvalue()


def test_accepts_inert_docx_with_http_hyperlink():
    result = validate_docx_package(_docx(), original_filename="CV.docx")
    assert result.byte_length > 0 and len(result.sha256) == 64


@pytest.mark.parametrize("name", ["../x", "..\\x", "/x", "\\\\server\\x", "C:\\x", "WORD\\DOCUMENT.XML", "word/embeddings/x.bin", "word/activeX/x.xml", "word/vbaProject.bin"])
def test_rejects_unsafe_active_or_duplicate_members(name):
    with pytest.raises(DocxPackageError):
        validate_docx_package(_docx([(name, b"x")]), original_filename="CV.docx")


def test_rejects_macro_enabled_content_type_without_vba_binary():
    types = TYPES.replace(b"wordprocessingml.document.main+xml", b"ms-word.document.macroEnabled.main+xml")
    with pytest.raises(DocxPackageError, match="macro-enabled"):
        validate_docx_package(_docx(types=types), original_filename="CV.docx")


@pytest.mark.parametrize("marker", ["vbaProject", "activeXControl", "oleObject", "package"])
def test_rejects_active_relationships_without_payload(marker):
    rels = RELS.replace(b"relationships/hyperlink", f"relationships/{marker}".encode())
    with pytest.raises(DocxPackageError):
        validate_docx_package(_docx(rels=rels), original_filename="CV.docx")


@pytest.mark.parametrize("filename,media", [("x.docm", DOCX_MEDIA_TYPE), ("x.docx", "application/pdf")])
def test_rejects_wrong_extension_or_media(filename, media):
    with pytest.raises((DocxPackageError, ValueError)):
        validate_docx_package(_docx(), original_filename=filename, declared_media_type=media)


@pytest.mark.parametrize("content", [b"%PDF", b"PK\x03\x04broken"])
def test_rejects_non_docx_or_truncated_archive(content):
    with pytest.raises(DocxPackageError):
        validate_docx_package(content, original_filename="x.docx")


def test_rejects_missing_required_member():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", TYPES)
        archive.writestr("word/document.xml", b"<document/>")
    with pytest.raises(DocxPackageError, match="missing required"):
        validate_docx_package(output.getvalue(), original_filename="x.docx")


def test_rejects_encrypted_flag_before_attempting_to_read_member():
    content = bytearray(_docx())
    local = content.find(b"PK\x03\x04")
    central = content.find(b"PK\x01\x02")
    content[local + 6:local + 8] = (1).to_bytes(2, "little")
    content[central + 8:central + 10] = (1).to_bytes(2, "little")
    with pytest.raises(DocxPackageError, match="encrypted"):
        validate_docx_package(bytes(content), original_filename="x.docx")


def test_rejects_zip_bomb_expansion_ratio():
    with pytest.raises(DocxPackageError, match="expansion ratio"):
        validate_docx_package(
            _docx([("word/large.xml", b"0" * 1_000_000)]),
            original_filename="x.docx",
        )


def test_rejects_more_than_entry_limit():
    extras = [(f"custom/item-{index}.xml", b"x") for index in range(2046)]
    with pytest.raises(DocxPackageError, match="too many"):
        validate_docx_package(_docx(extras), original_filename="x.docx")
