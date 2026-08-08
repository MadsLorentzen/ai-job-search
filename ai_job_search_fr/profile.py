"""Extraction prudente d'un profil maître depuis des documents personnels."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Iterable, Mapping

from .models import normalize_text
from .storage import extract_pdf_text, read_text, write_yaml_atomic


def empty_profile() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "identity": {"name": None, "contact": {"email": None, "phone": None, "location": None}, "status": "à_confirmer", "provenance": []},
        "education": [], "experiences": [], "projects": [], "skills": [], "languages": [],
        "links": {"portfolio": None, "github": None, "linkedin": None},
        "search": {"mode": "premier_emploi", "target_titles": [], "target_families": [], "sectors": [], "company_types": [], "accepted_experience_levels": [], "accepted_contracts": [], "refused_contracts": [], "available_from": None, "locations": [], "mobility": None, "remote_preference": None, "max_commute_minutes": None, "missions_wanted": [], "missions_refused": [], "elimination_criteria": [], "preferences": [], "alternance": None, "first_job": {"transferable_skills_allowed": True}},
        "writing_style": {"tone": "clair, professionnel et concret", "examples_star": []},
        "generation_policy": {"allowed_statuses": ["vérifiée", "déclarée"], "forbidden_statuses": ["interdite", "à_confirmer"], "language": "français", "template_path": "templates/cv/francais_one_page.tex"},
        "facts_to_confirm": [],
    }


def _text(path: Path) -> tuple[str, str | None]:
    if path.suffix.lower() == ".pdf":
        return extract_pdf_text(path)
    return read_text(path)


def _append_unique(items: list[dict[str, Any]], item: dict[str, Any], *, key: str = "name") -> None:
    value = normalize_text(item.get(key) or item.get("title") or item.get("description"))
    if value and not any(normalize_text(existing.get(key) or existing.get("title") or existing.get("description")) == value for existing in items):
        items.append(item)


def _section(line: str) -> str | None:
    value = normalize_text(line).strip(" :#-_")
    if any(value.startswith(token) for token in ("experience", "expérience", "emploi", "stage", "parcours professionnel")):
        return "experiences"
    if any(value.startswith(token) for token in ("formation", "education", "diplome", "diplôme")):
        return "education"
    if any(value.startswith(token) for token in ("competence", "compétence", "skill", "technologie")):
        return "skills"
    if any(value.startswith(token) for token in ("projet", "portfolio")):
        return "projects"
    if any(value.startswith(token) for token in ("langue", "language")):
        return "languages"
    return None


def build_profile_from_documents(paths: Iterable[Path], *, existing: Mapping[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    paths = list(paths)
    profile = empty_profile()
    if existing:
        # Une fusion additive ne remplace jamais un fait existant.
        for key, value in existing.items():
            profile[key] = value
    warnings: list[str] = []
    conflicts: list[dict[str, Any]] = []
    facts: list[dict[str, Any]] = list(profile.get("facts_to_confirm", []))
    for path in paths:
        path = Path(path)
        text, warning = _text(path)
        source = str(path)
        if warning:
            warnings.append(f"{source}: {warning}")
        if not text:
            continue
        lines = [line.strip(" \t•·#") for line in text.splitlines() if line.strip()]
        identity = profile.setdefault("identity", {})
        contact = identity.setdefault("contact", {})
        email = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)
        phone = re.search(r"(?:\+33|0)[ .-]?\d(?:[ .-]?\d){8,9}", text)
        if email and contact.get("email") and contact.get("email") != email.group(0):
            conflicts.append({"field": "identity.contact.email", "values": [contact.get("email"), email.group(0)], "sources": [source]})
        if email and not contact.get("email"):
            contact["email"] = email.group(0)
            facts.append({"field": "identity.contact.email", "value": email.group(0), "status": "à_confirmer", "provenance": [source]})
        if phone and contact.get("phone") and contact.get("phone") != phone.group(0):
            conflicts.append({"field": "identity.contact.phone", "values": [contact.get("phone"), phone.group(0)], "sources": [source]})
        if phone and not contact.get("phone"):
            contact["phone"] = phone.group(0)
            facts.append({"field": "identity.contact.phone", "value": phone.group(0), "status": "à_confirmer", "provenance": [source]})
        urls = re.findall(r"https?://[^\s)]+", text)
        for url in urls:
            if "github.com" in url.lower() and not profile["links"].get("github"):
                profile["links"]["github"] = url
            elif "linkedin.com" in url.lower() and not profile["links"].get("linkedin"):
                profile["links"]["linkedin"] = url
            elif not profile["links"].get("portfolio"):
                profile["links"]["portfolio"] = url
        current: str | None = None
        for index, line in enumerate(lines):
            detected = _section(line)
            if detected:
                current = detected
                continue
            if index == 0 and identity.get("name") and identity.get("name") != line and len(line.split()) <= 8 and "@" not in line:
                conflicts.append({"field": "identity.name", "values": [identity.get("name"), line], "sources": [source]})
            if index == 0 and not identity.get("name") and len(line.split()) <= 8 and "@" not in line:
                identity["name"] = line
                facts.append({"field": "identity.name", "value": line, "status": "à_confirmer", "provenance": [source]})
                continue
            if current == "skills":
                values = [value.strip() for value in re.split(r"[,;|/]", line) if value.strip()]
                for value in values:
                    _append_unique(profile["skills"], {"name": value, "status": "à_confirmer", "provenance": [source]})
            elif current == "languages":
                values = [value.strip() for value in re.split(r"[,;|/]", line) if value.strip()]
                for value in values:
                    _append_unique(profile["languages"], {"name": value, "status": "à_confirmer", "provenance": [source]})
            elif current in {"experiences", "projects", "education"}:
                item = {"title": line, "description": line, "status": "à_confirmer", "provenance": [source]}
                _append_unique(profile[current], item, key="title")
    profile["facts_to_confirm"] = facts
    report = {"sources": [str(Path(path)) for path in paths], "facts_to_confirm": len(facts), "conflicts": conflicts, "warnings": warnings, "note": "Les éléments extraits sont à_confirmer et ne sont pas des faits vérifiés."}
    return profile, report


def write_profile_from_documents(paths: Iterable[Path], output: Path, *, existing: Mapping[str, Any] | None = None) -> dict[str, Any]:
    paths = list(paths)
    profile, report = build_profile_from_documents(paths, existing=existing)
    write_yaml_atomic(output, profile)
    report["output"] = str(output)
    return report
