"""Strict, extraction-free validation of WordprocessingML DOCX packages."""
from __future__ import annotations

import hashlib
import io
import re
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from xml.etree import ElementTree

from product.application_document_contract import DOCX_MEDIA_TYPE, validate_display_filename


MAX_COMPRESSED_BYTES = 10 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_ENTRIES = 2048
MAX_EXPANSION_RATIO = 100
_WORD_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
_FORBIDDEN_CONTENT_MARKERS = ("macroenabled", "vba", "activex", "oleobject")
_FORBIDDEN_REL_MARKERS = ("vbaproject", "activex", "oleobject", "package")


class DocxPackageError(ValueError):
    """Raised when bytes are not an allowed, inert DOCX package."""


@dataclass(frozen=True)
class DocxPackageMetadata:
    byte_length: int
    sha256: str
    media_type: str = DOCX_MEDIA_TYPE


def _normal_name(name: str) -> str:
    if not name or any(ord(ch) < 32 for ch in name):
        raise DocxPackageError("DOCX contains an invalid member name")
    slash = name.replace("\\", "/")
    if slash.startswith("/") or name.startswith("\\") or re.match(r"^[A-Za-z]:", slash):
        raise DocxPackageError("DOCX contains an absolute member name")
    parts = slash.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise DocxPackageError("DOCX contains an unsafe member name")
    return str(PurePosixPath(*parts)).casefold()


def _xml(data: bytes, label: str) -> ElementTree.Element:
    try:
        return ElementTree.fromstring(data)
    except (ElementTree.ParseError, ValueError) as exc:
        raise DocxPackageError(f"DOCX has malformed {label}") from exc


def validate_docx_package(
    content: bytes,
    *,
    original_filename: str,
    declared_media_type: str = DOCX_MEDIA_TYPE,
) -> DocxPackageMetadata:
    validate_display_filename(original_filename)
    if declared_media_type != DOCX_MEDIA_TYPE:
        raise DocxPackageError("DOCX media type is invalid")
    if not isinstance(content, bytes) or not content.startswith(b"PK\x03\x04"):
        raise DocxPackageError("file is not a DOCX ZIP package")
    if len(content) > MAX_COMPRESSED_BYTES:
        raise DocxPackageError("DOCX exceeds the compressed-size limit")
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        infos = archive.infolist()
    except (zipfile.BadZipFile, OSError, ValueError) as exc:
        raise DocxPackageError("DOCX ZIP package is malformed") from exc
    with archive:
        if len(infos) > MAX_ENTRIES:
            raise DocxPackageError("DOCX contains too many members")
        seen: set[str] = set()
        uncompressed = 0
        for info in infos:
            normalized = _normal_name(info.filename)
            if normalized in seen:
                raise DocxPackageError("DOCX contains duplicate normalized member names")
            seen.add(normalized)
            if info.flag_bits & 1:
                raise DocxPackageError("encrypted DOCX members are not allowed")
            uncompressed += info.file_size
            if info.file_size and info.compress_size == 0:
                raise DocxPackageError("DOCX expansion ratio is invalid")
            if info.compress_size and info.file_size / info.compress_size > MAX_EXPANSION_RATIO:
                raise DocxPackageError("DOCX expansion ratio exceeds the limit")
            if normalized == "word/vbaproject.bin" or normalized.startswith("word/embeddings/") or normalized.startswith("word/activex/"):
                raise DocxPackageError("active or embedded DOCX content is not allowed")
        if uncompressed > MAX_UNCOMPRESSED_BYTES:
            raise DocxPackageError("DOCX exceeds the uncompressed-size limit")
        required = {"[content_types].xml", "_rels/.rels", "word/document.xml"}
        if not required.issubset(seen):
            raise DocxPackageError("DOCX is missing required package members")
        types = _xml(archive.read("[Content_Types].xml"), "content types")
        document_types = []
        for node in types.iter():
            content_type = node.attrib.get("ContentType", "")
            part_name = node.attrib.get("PartName", "").replace("\\", "/").casefold()
            lowered = content_type.casefold()
            if any(marker in lowered for marker in _FORBIDDEN_CONTENT_MARKERS):
                raise DocxPackageError("macro-enabled or active DOCX content is not allowed")
            if part_name == "/word/document.xml":
                document_types.append(content_type)
        if document_types != [_WORD_MAIN]:
            raise DocxPackageError("DOCX main document content type is invalid")
        for info in infos:
            if not info.filename.replace("\\", "/").casefold().endswith(".rels"):
                continue
            rels = _xml(archive.read(info), "relationships")
            for node in rels.iter():
                rel_type = node.attrib.get("Type", "").casefold()
                if any(marker in rel_type for marker in _FORBIDDEN_REL_MARKERS):
                    raise DocxPackageError("active or embedded DOCX relationship is not allowed")
    return DocxPackageMetadata(len(content), hashlib.sha256(content).hexdigest())
