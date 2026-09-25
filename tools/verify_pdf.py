#!/usr/bin/env python3
"""Verify that a generated PDF has the expected pages and extractable text.

Text-layer extraction tries pypdf (BSD, optional `pip install pypdf`) first,
then Poppler `pdftotext` if pypdf is missing, raises, or returns zero
extractable characters. Poppler remains the fallback.

`--contains` compares after `normalize_text()` has folded both sides: whitespace,
Unicode normalization form (NFC), and the typographic substitutions LaTeX makes to
the source text. The fold is comparison-time only - the `--dump-text` output stays
the raw text layer an ATS parser actually sees.

`--ascii-dates` is the one check that deliberately does NOT fold: it scans the raw
layer for a year joined to a Unicode dash - the en-dash LaTeX makes from `--`, which
a Workday import dropped along with the date (`05-cv-templates.md`, "Date fields
must be ASCII ranges") - and fails naming each hit with its code point.
"""

import argparse
import re
import subprocess
import sys
import unicodedata
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
            encoding="utf-8",
            errors="replace",
        ).stdout
    except FileNotFoundError as exc:
        raise VerificationError(
            f"required command '{command[0]}' was not found. "
            "Install pypdf (`pip install pypdf`) or poppler-utils "
            "(macOS: brew install poppler, Debian/Ubuntu: apt install poppler-utils, "
            "Windows: choco install poppler)"
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


# Typographic substitutions the moderncv/cover.cls templates produce from plain
# source text, mapped back to what a user types into --contains. LaTeX ligatures
# ' into U+2019 and -- into U+2013, so "Master's degree" and "2016-2024" are
# absent from the text layer of a CV that plainly contains them (#385). Applied
# to both sides of the comparison; the extracted dump is never rewritten.
TYPOGRAPHIC_FOLDS = str.maketrans(
    {
        "\u2018": "'",  # ` -> quoteleft
        "\u2019": "'",  # ' -> quoteright (the possessive apostrophe)
        "\u201c": '"',  # `` -> quotedblleft
        "\u201d": '"',  # '' -> quotedblright
        "\u2013": "-",  # -- -> endash (the \cventry date-range case)
        "\u2014": "-",  # --- -> emdash
        "\u00a0": " ",  # ~ -> no-break space
    }
)


def normalize_text(text):
    """Fold a string for comparison: NFC, typographic punctuation, whitespace.

    NFC covers the pdflatex text layer, which without T1 font encoding stores
    accented letters decomposed (`e` + U+0300) while a user types them
    precomposed (U+00E8); both forms fold to the same string (#384). The fold
    applies to what is compared, never to what is dumped: the date-range rule in
    `05-cv-templates.md` still needs the raw en-dash visible in `--dump-text`.
    """
    text = unicodedata.normalize("NFC", text).translate(TYPOGRAPHIC_FOLDS)
    return " ".join(text.split())


# Dash-like code points a year must never be joined to in a date range. U+2013 is
# what LaTeX makes from `--` and what the documented Workday import dropped; the
# rest are the other Unicode dashes and the minus sign, which a parser that splits
# a range only on U+002D treats the same way.
NON_ASCII_DASHES = "\u2010\u2011\u2012\u2013\u2014\u2015\u2212"
_YEAR = r"(?:19|20)\d{2}"
NON_ASCII_DATE_RANGE = re.compile(
    rf"{_YEAR}\s*[{NON_ASCII_DASHES}]|[{NON_ASCII_DASHES}]\s*{_YEAR}"
)


def find_non_ascii_date_ranges(text):
    """Return (line, dash) for every year joined to a non-ASCII dash in raw text.

    Works on the raw text layer, never on `normalize_text()` output: the fold
    maps U+2013 back to `-` so `--contains "2016-2024"` can match what the
    template renders, which is exactly why `--contains` cannot see this defect.
    A year on either side of the dash is enough ("Mar 2016 - Jul 2016",
    "2016 - Present"), so the check is locale-agnostic; a numeric range with
    no year ("EUR 600k-1M") is not a date and is left alone.
    """
    hits = []
    for match in NON_ASCII_DATE_RANGE.finditer(text):
        dash = next(c for c in match.group(0) if c in NON_ASCII_DASHES)
        line_start = text.rfind("\n", 0, match.start()) + 1
        line_end = text.find("\n", match.end())
        line = text[line_start : line_end if line_end != -1 else len(text)]
        hits.append((" ".join(line.split()), dash))
    return hits


def _extract_pypdf(pdf_path):
    """Return (text, pages) or None if pypdf is unavailable, raises, or yields no text."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    try:
        reader = PdfReader(str(pdf_path))
        pages = len(reader.pages)
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception:
        return None
    # Harden: treat empty/degraded extraction as failure so we fall back
    if len(normalize_text(text)) == 0:
        return None
    return text, pages


def _extract_pdftotext(pdf_path):
    text = run_tool(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf_path), "-"])
    # Always call pdfinfo here so the fallback path returns a page count
    # even when the caller did not request --pages (same Poppler package).
    pages = parse_page_count(run_tool(["pdfinfo", str(pdf_path)]))
    return text, pages


def extract_text_layer(pdf_path):
    """Extract ATS-readable text. Returns (text, pages, extractor_name)."""
    pypdf_result = _extract_pypdf(pdf_path)
    if pypdf_result is not None:
        text, pages = pypdf_result
        return text, pages, "pypdf"
    text, pages = _extract_pdftotext(pdf_path)
    return text, pages, "pdftotext"


def verify_pdf(
    pdf_path,
    expected_pages=None,
    min_chars=1,
    required_text=(),
    dump_text=None,
    ascii_dates=False,
):
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file():
        raise VerificationError(f"PDF does not exist: {pdf_path}")

    extracted_text, actual_pages, extractor = extract_text_layer(pdf_path)

    # Write dump *before* the checks so a failed verification still leaves a .txt
    if dump_text is not None:
        dump_path = Path(dump_text)
        try:
            dump_path.parent.mkdir(parents=True, exist_ok=True)
            dump_path.write_text(
                extracted_text if extracted_text.endswith("\n") else extracted_text + "\n",
                encoding="utf-8",
            )
        except OSError as exc:
            raise VerificationError(
                f"could not write --dump-text to {dump_path}: {exc}"
            ) from exc

    if expected_pages is not None and actual_pages != expected_pages:
        raise VerificationError(
            f"expected {expected_pages} page(s), found {actual_pages} (extractor: {extractor})"
        )

    normalized = normalize_text(extracted_text)
    if len(normalized) < min_chars:
        raise VerificationError(
            f"text layer has {len(normalized)} character(s); expected at least {min_chars} "
            f"(extractor: {extractor})"
        )

    for required in required_text:
        if normalize_text(required) not in normalized:
            raise VerificationError(
                f"text layer is missing required text: {required!r} (extractor: {extractor})"
            )

    if ascii_dates:
        hits = find_non_ascii_date_ranges(extracted_text)
        if hits:
            listed = "; ".join(f"U+{ord(dash):04X} in {line[:80]!r}" for line, dash in hits)
            raise VerificationError(
                f"{len(hits)} date range(s) joined by a non-ASCII dash - an ATS that splits "
                f"ranges on U+002D drops the date; write the date argument with a single "
                f"ASCII hyphen (05-cv-templates.md, 'Date fields must be ASCII ranges'): "
                f"{listed} (extractor: {extractor})"
            )
    return extractor, extracted_text, actual_pages


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
        help=(
            "text that must appear in the text layer; both sides are folded for "
            "whitespace, NFC, and LaTeX's typographic substitutions (curly "
            "apostrophes/quotes, en/em dashes, no-break spaces); repeatable"
        ),
    )
    parser.add_argument(
        "--dump-text",
        type=Path,
        help="write the extracted text layer to this path (UTF-8)",
    )
    parser.add_argument(
        "--ascii-dates",
        action="store_true",
        help=(
            "fail if the raw text layer has a year joined to a Unicode dash (the "
            "en-dash LaTeX makes from --), which ATS date parsers drop; this check "
            "never folds, unlike --contains"
        ),
    )
    return parser


def _force_utf8_output() -> None:
    """Write UTF-8 whatever the host's default encoding is.

    A piped stdout on Windows defaults to the ANSI code page (cp1252 on most
    Western installs), so printing a company, title or file name outside it
    raised UnicodeEncodeError before the workflow saw any output.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)  # absent on a StringIO under test
        if reconfigure:
            reconfigure(encoding="utf-8")


def main(argv=None):
    _force_utf8_output()
    args = build_parser().parse_args(argv)
    try:
        extractor, text, pages = verify_pdf(
            args.pdf,
            args.pages,
            args.min_chars,
            args.contains,
            dump_text=args.dump_text,
            ascii_dates=args.ascii_dates,
        )
    except VerificationError as exc:
        print(f"Error: {args.pdf}: {exc}", file=sys.stderr)
        return 1
    print(f"Verified {args.pdf} (extractor: {extractor}, pages: {pages})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
