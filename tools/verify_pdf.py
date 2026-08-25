#!/usr/bin/env python3
"""Verify that a generated PDF has the expected pages and extractable text."""

import argparse
import subprocess
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.extract_pdf_text import ExtractionError, extract_pdf_text


class VerificationError(Exception):
    """Raised when a generated PDF does not satisfy its checks."""


def run_tool(command):
    """Run a Poppler command. Kept for callers and tests that probe missing binaries."""
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except FileNotFoundError as exc:
        raise VerificationError(
            f"required command '{command[0]}' was not found. "
            "Install poppler-utils (macOS: brew install poppler, "
            "Debian/Ubuntu: apt install poppler-utils, Windows: choco install poppler). "
            "Or skip Poppler entirely: pip install pymupdf"
        ) from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip() or (exc.stdout or "").strip()
        detail = detail or "command failed"
        raise VerificationError(f"{command[0]} could not read the PDF: {detail}") from exc


def parse_page_count(pdfinfo_output):
    import re

    match = re.search(r"^Pages:\s+(\d+)\s*$", pdfinfo_output, re.MULTILINE)
    if not match:
        raise VerificationError("pdfinfo output did not contain a page count")
    return int(match.group(1))


def normalize_text(text):
    return " ".join(text.split())


def verify_pdf(
    pdf_path,
    expected_pages=None,
    min_chars=1,
    required_text=(),
    prefer=None,
    use_cache=True,
):
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file():
        raise VerificationError(f"PDF does not exist: {pdf_path}")

    try:
        extraction = extract_pdf_text(
            pdf_path, prefer=prefer, use_cache=use_cache
        )
    except ExtractionError as exc:
        raise VerificationError(str(exc)) from exc

    if expected_pages is not None and extraction.pages != expected_pages:
        raise VerificationError(
            f"expected {expected_pages} page(s), found {extraction.pages} "
            f"(extractor: {extraction.extractor})"
        )

    extracted_text = normalize_text(extraction.text)
    if len(extracted_text) < min_chars:
        raise VerificationError(
            f"text layer has {len(extracted_text)} character(s); expected at least {min_chars} "
            f"(extractor: {extraction.extractor})"
        )

    for required in required_text:
        if normalize_text(required) not in extracted_text:
            raise VerificationError(
                f"text layer is missing required text: {required!r} "
                f"(extractor: {extraction.extractor})"
            )

    return extraction


def build_parser():
    parser = argparse.ArgumentParser(
        description="Verify a PDF's page count and ATS-readable text layer."
    )
    parser.add_argument("pdf", type=Path, help="PDF file to verify")
    parser.add_argument("--pages", type=int, help="required exact page count")
    parser.add_argument(
        "--min-chars",
        type=int,
        default=1,
        help="minimum non-whitespace text-layer characters (default: 1)",
    )
    parser.add_argument(
        "--contains",
        action="append",
        default=[],
        help="text that must appear after whitespace normalization; repeatable",
    )
    parser.add_argument(
        "--extractor",
        default="auto",
        help="auto (pymupdf, pypdf, pdftotext), or a specific extractor name",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="do not use the on-disk extraction cache",
    )
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        extraction = verify_pdf(
            args.pdf,
            args.pages,
            args.min_chars,
            args.contains,
            prefer=args.extractor,
            use_cache=not args.no_cache,
        )
    except VerificationError as exc:
        print(f"Error: {args.pdf}: {exc}", file=sys.stderr)
        return 1
    print(
        f"Verified {args.pdf} (extractor: {extraction.extractor}, "
        f"pages: {extraction.pages}, cached: {str(extraction.cached).lower()})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
