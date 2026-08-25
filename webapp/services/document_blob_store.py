"""No-clobber, content-addressed storage for authoritative DOCX bytes."""
from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path
from typing import Any


class DocumentBlobError(RuntimeError):
    """Raised when authoritative document bytes cannot be safely stored/read."""


class DocumentBlobStore:
    def __init__(self, documents_root: Path):
        self.root = Path(documents_root).resolve() / "document_blobs" / "sha256"

    @staticmethod
    def storage_key(digest: str) -> str:
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            raise DocumentBlobError("invalid document digest")
        return f"sha256/{digest[:2]}/{digest}.docx"

    def _path(self, storage_key: str) -> Path:
        parts = storage_key.split("/")
        if len(parts) != 3 or parts[0] != "sha256":
            raise DocumentBlobError("invalid document storage key")
        digest = parts[2].removesuffix(".docx")
        if storage_key != self.storage_key(digest):
            raise DocumentBlobError("invalid document storage key")
        root = os.path.abspath(str(self.root))
        path = os.path.abspath(str(self.root / digest[:2] / f"{digest}.docx"))
        if os.path.normcase(os.path.commonpath((root, path))) != os.path.normcase(root):
            raise DocumentBlobError("document path escaped storage root")
        return Path(path)

    @staticmethod
    def _verify(path: Path, *, expected_length: int, expected_sha256: str) -> bytes:
        try:
            content = path.read_bytes()
        except OSError as exc:
            raise DocumentBlobError("document bytes are unavailable") from exc
        if len(content) != expected_length or hashlib.sha256(content).hexdigest() != expected_sha256:
            raise DocumentBlobError("stored document failed integrity verification")
        return content

    def publish(self, content: bytes) -> dict[str, Any]:
        if not isinstance(content, bytes) or not content:
            raise DocumentBlobError("document content must be non-empty bytes")
        digest = hashlib.sha256(content).hexdigest()
        key = self.storage_key(digest)
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary_name = tempfile.mkstemp(prefix=".publish-", suffix=".tmp", dir=target.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(handle, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, target)
            except FileExistsError:
                self._verify(target, expected_length=len(content), expected_sha256=digest)
            except OSError as exc:
                raise DocumentBlobError("document bytes could not be published") from exc
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
        return {"storage_key": key, "byte_length": len(content), "sha256": digest}

    def read(self, document: dict[str, Any]) -> bytes:
        return self._verify(
            self._path(document["storage_key"]),
            expected_length=document["byte_length"],
            expected_sha256=document["sha256"],
        )
