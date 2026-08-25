#!/usr/bin/env python3
"""Verify that a generated PDF has the expected pages and extractable text."""

import argparse
import re
import subprocess
import sys
from pathlib import Path


class VerificationError(Exception):
    """Raised when a generated PDF does not satisfy its checks."""


def run_tool(command):
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
            "Debian/Ubuntu: apt install poppler-utils, Windows: choco install poppler)"
        ) from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip() or (exc.stdout or "").strip()
        detail = detail or "command failed"
        raise VerificationError(f"{command[0]} could not read the PDF: {detail}") from exc


def parse_page_count(pdfinfo_output):
    match = re.search(r"^Pages:\s+(\d+)\s*$", pdfinfo_output, re.MULTILINE)
    if not match:
        raise VerificationError("pdfinfo output did not contain a page count")
    return int(match.group(1))


def normalize_text(text):
    return " ".join(text.split())


def verify_pdf(pdf_path, expected_pages=None, min_chars=1, required_text=()):
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file():
        raise VerificationError(f"PDF does not exist: {pdf_path}")

    if expected_pages is not None:
        actual_pages = parse_page_count(run_tool(["pdfinfo", str(pdf_path)]))
        if actual_pages != expected_pages:
            raise VerificationError(
                f"expected {expected_pages} page(s), found {actual_pages}"
            )

    extracted_text = normalize_text(
        run_tool(["pdftotext", "-layout", str(pdf_path), "-"])
    )
    if len(extracted_text) < min_chars:
        raise VerificationError(
            f"text layer has {len(extracted_text)} character(s); expected at least {min_chars}"
        )

    for required in required_text:
        if normalize_text(required) not in extracted_text:
            raise VerificationError(f"text layer is missing required text: {required!r}")


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
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        verify_pdf(args.pdf, args.pages, args.min_chars, args.contains)
    except VerificationError as exc:
        print(f"Error: {args.pdf}: {exc}", file=sys.stderr)
        return 1
    print(f"Verified {args.pdf}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
