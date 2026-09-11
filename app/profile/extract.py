"""Deterministic candidate-document loading and CV fact extraction."""

import re
import subprocess
from pathlib import Path
from typing import Iterable, List

from app.core.security import validate_path_boundary
from app.profile.models import ProfileCategory, ProfileDocument, ProfileSource


SUPPORTED_TEXT = {".md", ".txt", ".tex", ".yaml", ".yml", ".json"}


def load_document(path: Path, base_dir: Path) -> ProfileDocument:
    """Read a supported document, extracting PDF text through pdftotext."""
    target = validate_path_boundary(path, base_dir)
    suffix = target.suffix.casefold()
    if suffix == ".pdf":
        result = subprocess.run(
            ["pdftotext", "-layout", str(target), "-"],
            capture_output=True,
            text=True,
            check=True,
        )
        content = result.stdout
    elif suffix in SUPPORTED_TEXT:
        content = target.read_text(encoding="utf-8")
    else:
        raise ValueError(f"Unsupported profile document type: {target.suffix}")
    source = ProfileSource.MASTER_CV if "cv" in target.parts and target.name != "CLAUDE.md" else ProfileSource.DOCUMENT
    category = ProfileCategory.HISTORICAL_FACT if source == ProfileSource.MASTER_CV else ProfileCategory.BEHAVIORAL_SIGNAL
    return ProfileDocument(str(target), content, source, category)


def discover_documents(documents_dir: Path) -> List[Path]:
    """Return deterministic, sorted profile source paths, excluding README files."""
    paths: List[Path] = []
    for path in documents_dir.rglob("*"):
        if path.is_file() and path.name.lower() != "readme.md" and path.suffix.casefold() in SUPPORTED_TEXT | {".pdf"}:
            paths.append(path)
    return sorted(paths, key=lambda path: str(path).casefold())


def extract_cv_facts(content: str) -> List[str]:
    """Extract high-signal CV lines without interpreting or inventing facts."""
    facts = []
    for line in content.splitlines():
        stripped = line.strip().lstrip("%-* ")
        if not stripped or stripped.startswith("%"):
            continue
        if re.search(r"\b(19|20)\d{2}\b", stripped) or "cventry" in stripped.lower():
            facts.append(stripped)
    return facts


def build_source_documents(repo_root: Path) -> List[ProfileDocument]:
    """Load the master CV, preference file, and documents inbox."""
    documents: List[ProfileDocument] = []
    master_cv = repo_root / "cv" / "main_example.tex"
    if master_cv.exists():
        documents.append(
            ProfileDocument(str(master_cv), master_cv.read_text(encoding="utf-8"), ProfileSource.MASTER_CV, ProfileCategory.HISTORICAL_FACT)
        )
    preferences = repo_root / "CLAUDE.md"
    if preferences.exists():
        documents.append(
            ProfileDocument(str(preferences), preferences.read_text(encoding="utf-8"), ProfileSource.PREFERENCES, ProfileCategory.APPLICATION_PREFERENCE)
        )
    inbox = repo_root / "documents"
    for path in discover_documents(inbox):
        documents.append(load_document(path, repo_root))
    return documents