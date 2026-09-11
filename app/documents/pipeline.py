"""Safe wrappers for LaTeX compilation, PDF inspection, and ATS extraction."""

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence


@dataclass
class PDFValidation:
    pages: int
    text: str
    errors: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.errors


def compile_latex(source: Path, engine: str, *, timeout: int = 120) -> Path:
    if engine not in {"lualatex", "xelatex"}:
        raise ValueError("Only lualatex and xelatex are supported")
    source = source.resolve()
    result = subprocess.run(
        [engine, "-interaction=nonstopmode", "-halt-on-error", source.name],
        cwd=source.parent,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout)[-4000:]
        raise RuntimeError(f"{engine} failed for {source.name}:\n{detail}")
    pdf = source.with_suffix(".pdf")
    if not pdf.is_file():
        raise RuntimeError(f"{engine} completed without producing {pdf.name}")
    return pdf


def validate_pdf(
    pdf: Path,
    *,
    expected_pages: int,
    required_text: Sequence[str] = (),
    min_characters: int = 1,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> PDFValidation:
    pdf = pdf.resolve()
    info = runner(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True)
    match = re.search(r"^Pages:\s+(\d+)\s*$", info.stdout, re.MULTILINE)
    if not match:
        return PDFValidation(0, "", ["pdfinfo did not return a page count"])
    pages = int(match.group(1))
    extracted = runner(
        ["pdftotext", "-layout", str(pdf), "-"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    text = " ".join(extracted.split())
    errors = []
    if pages != expected_pages:
        errors.append(f"expected {expected_pages} page(s), found {pages}")
    if len(text) < min_characters:
        errors.append(f"text layer has {len(text)} characters, expected at least {min_characters}")
    for required in required_text:
        if " ".join(required.split()) not in text:
            errors.append(f"text layer is missing required text: {required}")
    if "(cid:" in text or "�" in text:
        errors.append("text layer contains garbled glyph markers")
    return PDFValidation(pages, text, errors)