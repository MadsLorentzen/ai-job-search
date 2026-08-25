#!/usr/bin/env python3
"""Extract a PDF's ATS-readable text layer without requiring Poppler.

Default chain (pure Python first, so Windows works without extra binaries):

  1. pymupdf (fitz)  — preferred; good Unicode and layout
  2. pypdf           — stdlib-friendly wheel, weaker layout
  3. pdftotext       — Poppler, optional fast path if installed
  4. fail            — caller degrades to a visual keyword review

Set ATS_EXTRACTOR=pdftotext to try Poppler first. Cache key is the SHA-256 of
the PDF bytes; repeated checks on an unchanged file are free.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

CACHE_DIRNAME = ".pdf_extract_cache"


class ExtractionError(Exception):
    """Raised when no extractor could read the PDF."""


@dataclass
class Extraction:
    text: str
    pages: int
    extractor: str
    cached: bool = False

    def normalized(self) -> str:
        return " ".join(self.text.split())


def _cache_dir_for(pdf_path: Path) -> Path:
    return pdf_path.parent / CACHE_DIRNAME


def _cache_path(pdf_path: Path, digest: str) -> Path:
    return _cache_dir_for(pdf_path) / f"{digest}.json"


def _sha256(pdf_path: Path) -> str:
    hasher = hashlib.sha256()
    with pdf_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _load_cache(pdf_path: Path, digest: str) -> Extraction | None:
    path = _cache_path(pdf_path, digest)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    text = payload.get("text")
    pages = payload.get("pages")
    extractor = payload.get("extractor")
    if not isinstance(text, str) or not isinstance(pages, int) or not extractor:
        return None
    return Extraction(text=text, pages=pages, extractor=str(extractor), cached=True)


def _store_cache(pdf_path: Path, digest: str, result: Extraction) -> None:
    directory = _cache_dir_for(pdf_path)
    try:
        directory.mkdir(parents=True, exist_ok=True)
        payload = {
            "sha256": digest,
            "text": result.text,
            "pages": result.pages,
            "extractor": result.extractor,
        }
        _cache_path(pdf_path, digest).write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
    except OSError:
        return


def _extract_pymupdf(pdf_path: Path) -> Extraction | None:
    try:
        import fitz  # type: ignore
    except ImportError:
        return None
    try:
        document = fitz.open(pdf_path)
    except Exception as exc:  # noqa: BLE001 - library-specific errors
        raise ExtractionError(f"pymupdf could not open {pdf_path}: {exc}") from exc
    try:
        pages = document.page_count
        parts = [page.get_text("text") for page in document]
    finally:
        document.close()
    return Extraction(text="\n".join(parts), pages=pages, extractor="pymupdf")


def _extract_pypdf(pdf_path: Path) -> Extraction | None:
    try:
        from pypdf import PdfReader  # type: ignore
    except ImportError:
        return None
    try:
        reader = PdfReader(str(pdf_path))
        pages = len(reader.pages)
        parts = [(page.extract_text() or "") for page in reader.pages]
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError(f"pypdf could not read {pdf_path}: {exc}") from exc
    return Extraction(text="\n".join(parts), pages=pages, extractor="pypdf")


def _run_poppler(command: list[str]) -> str:
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        raise FileNotFoundError(command[0]) from None
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip() or (exc.stdout or "").strip() or "command failed"
        raise ExtractionError(f"{command[0]} could not read the PDF: {detail}") from exc
    return completed.stdout


def _extract_pdftotext(pdf_path: Path) -> Extraction | None:
    try:
        text = _run_poppler(
            ["pdftotext", "-layout", "-enc", "UTF-8", str(pdf_path), "-"]
        )
    except FileNotFoundError:
        return None
    pages = text.count("\f") + (1 if text.strip() else 0)
    if pages == 0:
        pages = 1
    return Extraction(text=text.replace("\f", "\n"), pages=pages, extractor="pdftotext")


EXTRACTORS = {
    "pymupdf": _extract_pymupdf,
    "pypdf": _extract_pypdf,
    "pdftotext": _extract_pdftotext,
}

DEFAULT_CHAIN = ("pymupdf", "pypdf", "pdftotext")
POPPLER_FIRST_CHAIN = ("pdftotext", "pymupdf", "pypdf")


def resolve_chain(prefer: str | None = None) -> tuple[str, ...]:
    """Return the extractor names to try, in order."""
    requested = (prefer or os.environ.get("ATS_EXTRACTOR") or "auto").strip().lower()
    if requested in ("poppler", "pdftotext"):
        return POPPLER_FIRST_CHAIN
    if requested in EXTRACTORS:
        return (requested, *(name for name in DEFAULT_CHAIN if name != requested))
    return DEFAULT_CHAIN


def extract_pdf_text(
    pdf_path,
    *,
    prefer: str | None = None,
    use_cache: bool = True,
    extractors=None,
) -> Extraction:
    """Extract text and page count from a PDF.

    `extractors` is an optional mapping of name -> callable(Path) -> Extraction | None,
    used by tests to inject fakes. A callable that returns None means "not available".
    """
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file():
        raise ExtractionError(f"PDF does not exist: {pdf_path}")

    digest = _sha256(pdf_path)
    if use_cache:
        cached = _load_cache(pdf_path, digest)
        if cached is not None:
            return cached

    chain = resolve_chain(prefer)
    registry = EXTRACTORS if extractors is None else extractors
    errors: list[str] = []
    tried = 0

    for name in chain:
        func = registry.get(name)
        if func is None:
            continue
        tried += 1
        try:
            result = func(pdf_path)
        except ExtractionError as exc:
            errors.append(str(exc))
            continue
        if result is None:
            continue
        if use_cache:
            _store_cache(pdf_path, digest, result)
        return result

    available = ", ".join(chain)
    detail = f" ({'; '.join(errors)})" if errors else ""
    hint = (
        "Install a Python extractor with `pip install pymupdf` "
        "(recommended on Windows) or Poppler (`choco install poppler` / "
        "`winget install oschwartz10612.Poppler`)."
    )
    if tried == 0:
        raise ExtractionError(f"no ATS extractors configured from [{available}]. {hint}")
    raise ExtractionError(f"no ATS extractor could read {pdf_path}{detail}. {hint}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract a PDF text layer for ATS checks (pymupdf / pypdf / pdftotext)."
    )
    parser.add_argument("pdf", type=Path, help="PDF file to extract")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="write extracted text here (default: stdout)",
    )
    parser.add_argument(
        "--extractor",
        default="auto",
        help="auto (default: pymupdf, pypdf, pdftotext), pdftotext, pymupdf, or pypdf",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="do not read or write the on-disk extraction cache",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="print {text, pages, extractor, cached} as JSON instead of plain text",
    )
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = extract_pdf_text(
            args.pdf, prefer=args.extractor, use_cache=not args.no_cache
        )
    except ExtractionError as exc:
        print(f"Error: {args.pdf}: {exc}", file=sys.stderr)
        return 2

    header = (
        f"extractor: {result.extractor}  pages: {result.pages}  "
        f"cached: {str(result.cached).lower()}"
    )
    print(header, file=sys.stderr)

    if args.json:
        payload = asdict(result)
        text_out = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        text_out = result.text
        if not text_out.endswith("\n"):
            text_out += "\n"

    if args.output:
        args.output.write_text(text_out, encoding="utf-8")
    else:
        sys.stdout.write(text_out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
