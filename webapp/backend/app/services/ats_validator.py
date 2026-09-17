"""Ports the ATS text-layer verification from `.claude/commands/apply.md`
Step 5d: an ATS parser reads the PDF's embedded text layer, not the rendered
page, so a resume that looks fine visually can still extract as garbage.
This runs the same class of checks against the HTML/PDF pipeline that the
interactive LaTeX workflow already runs against `.tex` output.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

from app.services.text_utils import contains_phrase

GARBAGE_PATTERNS = [r"\(cid:\d+\)", r"<0x[0-9a-fA-F]+>", "�"]
EXPECTED_SECTION_ORDER = ["skills", "experience", "education"]


def pdftotext_available() -> bool:
    return shutil.which("pdftotext") is not None


def extract_text(pdf_path: Path) -> str | None:
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), "-"],
            capture_output=True, text=True, timeout=15,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    return result.stdout if result.returncode == 0 else None


def validate_resume_pdf(pdf_path: Path, email: str, phone: str, required_keywords: list[str]) -> dict:
    if not pdftotext_available():
        return {
            "available": False,
            "note": "pdftotext not installed -- parseability checks skipped (see apply.md's degraded-mode precedent).",
        }

    text = extract_text(pdf_path)
    if text is None:
        return {"available": True, "extraction_failed": True}

    clean_extraction = not any(re.search(pattern, text) for pattern in GARBAGE_PATTERNS)
    contact_ok = contains_phrase(text, email) and _phone_present(text, phone)

    lower = text.lower()
    positions = [lower.find(section) for section in EXPECTED_SECTION_ORDER]
    reading_order_ok = all(p != -1 for p in positions) and positions == sorted(positions)

    keyword_coverage = [
        {"keyword": kw, "covered": contains_phrase(text, kw)} for kw in required_keywords
    ]
    covered_count = sum(1 for k in keyword_coverage if k["covered"])

    overall_pass = clean_extraction and contact_ok and reading_order_ok

    return {
        "available": True,
        "clean_extraction": clean_extraction,
        "contact_info_present": contact_ok,
        "reading_order_ok": reading_order_ok,
        "keyword_coverage": keyword_coverage,
        "keywords_covered": covered_count,
        "keywords_total": len(required_keywords),
        "pass": overall_pass,
    }


def _phone_present(text: str, phone: str) -> bool:
    # Phone numbers carry punctuation ("+1 (470) 257-0870") that a PDF text
    # layer sometimes reflows with different spacing -- compare digits only.
    digits_only = re.sub(r"\D", "", phone)
    text_digits = re.sub(r"\D", "", text)
    return bool(digits_only) and digits_only in text_digits
