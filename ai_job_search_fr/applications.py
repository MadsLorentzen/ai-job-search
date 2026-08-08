"""Génération déterministe de documents et revue indépendante."""

from __future__ import annotations

from pathlib import Path
import re
import shutil
import subprocess
from typing import Any, Mapping

from .models import Opportunity, normalize_text, stable_id
from .ranking import rank_opportunity
from .storage import extract_pdf_text, write_json_atomic, write_text_atomic
from .tracker import archive_application


def _items(profile: Mapping[str, Any], section: str) -> list[Mapping[str, Any]]:
    value = profile.get(section, [])
    return [item for item in value if isinstance(item, Mapping) and item.get("status") != "interdite" and item.get("status") != "à_confirmer"] if isinstance(value, list) else []


def _profile_corpus(profile: Mapping[str, Any]) -> str:
    chunks: list[str] = []
    for section in ("experiences", "projects", "skills", "education", "languages"):
        for item in _items(profile, section):
            chunks.append(" ".join(str(item.get(key, "")) for key in ("name", "title", "description", "results", "skills", "technologies", "level", "degree")))
    return normalize_text(" ".join(chunks))


def keyword_coverage(opportunity: Opportunity, profile: Mapping[str, Any]) -> dict[str, Any]:
    corpus = _profile_corpus(profile)
    supported, gaps = [], []
    for keyword in opportunity.required_skills + opportunity.preferred_skills:
        (supported if normalize_text(keyword) in corpus else gaps).append(keyword)
    return {"supported": list(dict.fromkeys(supported)), "gaps": list(dict.fromkeys(gaps)), "coverage_percent": round(100 * len(supported) / max(1, len(supported) + len(gaps)), 1)}


def _relevant_items(profile: Mapping[str, Any], opportunity: Opportunity, limit: int = 4) -> list[Mapping[str, Any]]:
    target = set(re.findall(r"[\wÀ-ÿ+#.-]{3,}", opportunity.search_text()))
    scored: list[tuple[int, Mapping[str, Any]]] = []
    for section in ("experiences", "projects"):
        for item in _items(profile, section):
            text = normalize_text(" ".join(str(item.get(key, "")) for key in ("name", "title", "description", "results", "skills", "technologies")))
            tokens = set(re.findall(r"[\wÀ-ÿ+#.-]{3,}", text))
            scored.append((len(tokens & target), item))
    return [item for _, item in sorted(scored, key=lambda pair: pair[0], reverse=True)[:limit]]


def generate_cv_text(profile: Mapping[str, Any], opportunity: Opportunity, *, max_items: int = 4) -> str:
    identity = profile.get("identity") or {}
    name = identity.get("name") or "[Nom à compléter]" if isinstance(identity, Mapping) else "[Nom à compléter]"
    contact = identity.get("contact") if isinstance(identity, Mapping) else {}
    contact_line = " · ".join(str(contact.get(key)) for key in ("email", "phone", "location") if isinstance(contact, Mapping) and contact.get(key))
    lines = [str(name), opportunity.title or "Candidature", contact_line, "", "Profil", str(profile.get("summary") or "Profil professionnel à préciser.")]
    lines.extend(["", "Expériences et projets pertinents"])
    for item in _relevant_items(profile, opportunity, max_items):
        title = item.get("title") or item.get("name") or "Expérience"
        period = item.get("period") or item.get("dates") or ""
        description = item.get("results") or item.get("description") or ""
        lines.append(f"- {title} {f'({period})' if period else ''}: {description}")
    skills = [item.get("name") or item.get("title") for item in _items(profile, "skills") if item.get("name") or item.get("title")]
    if skills:
        lines.extend(["", "Compétences", " · ".join(map(str, skills))])
    education = _items(profile, "education")
    if education:
        lines.extend(["", "Formation"])
        lines.extend(f"- {item.get('degree') or item.get('name') or 'Formation'} {item.get('institution') or ''}".strip() for item in education)
    return "\n".join(line for line in lines if line is not None).strip() + "\n"


def generate_cv_latex(profile: Mapping[str, Any], opportunity: Opportunity) -> str:
    text = generate_cv_text(profile, opportunity)
    # Escape only characters that are unsafe in a plain LaTeX document.
    escaped = text.replace("\\", r"\textbackslash{}").replace("&", r"\&").replace("%", r"\%").replace("#", r"\#").replace("_", r"\_")
    policy = profile.get("generation_policy") if isinstance(profile.get("generation_policy"), Mapping) else {}
    template_path = Path(str(policy.get("template_path") or "templates/cv/francais_one_page.tex"))
    if template_path.exists():
        template = template_path.read_text(encoding="utf-8")
        identity = profile.get("identity") if isinstance(profile.get("identity"), Mapping) else {}
        contact = identity.get("contact") if isinstance(identity.get("contact"), Mapping) else {}
        name = str(identity.get("name") or "[Nom à compléter]")
        contact_line = " · ".join(str(contact.get(key)) for key in ("email", "phone", "location") if contact.get(key))
        return template.replace("{{NAME}}", name).replace("{{CONTACT}}", contact_line).replace("{{BODY}}", escaped)
    return "\\documentclass[10pt,a4paper]{article}\n\\usepackage[margin=1.5cm]{geometry}\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n\\begin{document}\n\\raggedright\n\\begin{verbatim}\n" + escaped + "\\end{verbatim}\n\\end{document}\n"


def generate_message(profile: Mapping[str, Any], opportunity: Opportunity, *, channel: str = "lettre") -> str:
    identity = profile.get("identity") or {}
    name = identity.get("name") if isinstance(identity, Mapping) else "[Nom]"
    company = opportunity.company or "l'entreprise"
    role = opportunity.title or "la mission"
    relevant = _relevant_items(profile, opportunity, 2)
    evidence = "; ".join(str(item.get("results") or item.get("description") or item.get("name") or item.get("title")) for item in relevant if item.get("results") or item.get("description") or item.get("name") or item.get("title"))
    if channel in {"message", "courriel", "spontanée", "spontanee"}:
        return (f"Objet : Candidature — {role}\n\nBonjour,\n\nJe vous contacte au sujet de {role} chez {company}. "
                f"Mon expérience pertinente porte notamment sur {evidence or '[élément à préciser]'}. "
                "Je serais heureux·se d’échanger sur la contribution que je pourrais apporter.\n\nBien cordialement,\n" + str(name or "[Nom]"))
    return (f"Objet : Candidature au poste de {role}\n\nMadame, Monsieur,\n\n"
            f"Votre besoin chez {company} m’intéresse car il rejoint mon projet professionnel et mes expériences en lien avec {evidence or '[compétence à préciser]'}. "
            "Je souhaite mettre ces acquis au service d’une mission concrète et continuer à progresser au contact de votre équipe.\n\n"
            "Je serais ravi·e de pouvoir détailler cette contribution lors d’un échange.\n\nBien cordialement,\n" + str(name or "[Nom]"))


def review_documents(profile: Mapping[str, Any], opportunity: Opportunity, *, cv_text: str, message: str) -> dict[str, Any]:
    corpus = _profile_corpus(profile)
    claims = [line.lstrip("- ").strip() for line in cv_text.splitlines() if line.startswith("-")]
    unsupported = [claim for claim in claims if claim and not any(token in corpus for token in re.findall(r"[\wÀ-ÿ+#.-]{4,}", normalize_text(claim))[:2])]
    coverage = keyword_coverage(opportunity, profile)
    malicious = [line for line in opportunity.description_raw.splitlines() if re.search(r"ignorez|instructions précédentes|system prompt|mot de passe|secret", line, re.I)] if opportunity.description_raw else []
    issues: list[str] = []
    if unsupported:
        issues.append("affirmations du CV sans correspondance claire dans le profil maître")
    if coverage["gaps"]:
        issues.append("compétences demandées non démontrées: " + ", ".join(coverage["gaps"][:3]))
    if malicious:
        issues.append("instructions non fiables détectées dans l'offre; elles ont été ignorées")
    if len(message.split()) > 350:
        issues.append("message trop long")
    return {"pass": not issues, "issues": issues, "unsupported_claims": unsupported, "keyword_coverage": coverage, "untrusted_instructions": malicious, "checked_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}


def build_application(profile: Mapping[str, Any], opportunity: Opportunity, output_dir: Path, *, channel: str = "lettre", compile_pdf: bool = False) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    cv_text = generate_cv_text(profile, opportunity)
    cv_tex = generate_cv_latex(profile, opportunity)
    message = generate_message(profile, opportunity, channel=channel)
    review = review_documents(profile, opportunity, cv_text=cv_text, message=message)
    cv_text_path = output_dir / "cv.txt"
    cv_tex_path = output_dir / "cv.tex"
    message_path = output_dir / "message.txt"
    write_text_atomic(cv_text_path, cv_text)
    write_text_atomic(cv_tex_path, cv_tex)
    write_text_atomic(message_path, message)
    compilation: dict[str, Any] | None = None
    if compile_pdf:
        compiler = shutil.which("lualatex") or shutil.which("xelatex")
        if compiler:
            result = subprocess.run([compiler, "-interaction=nonstopmode", "-halt-on-error", cv_tex_path.name], cwd=output_dir, capture_output=True, text=True, check=False)
            pdf_path = output_dir / cv_tex_path.with_suffix(".pdf").name
            compilation = {"compiler": compiler, "returncode": result.returncode, "pdf": str(pdf_path) if pdf_path.exists() else None, "stderr_tail": (result.stderr or result.stdout or "")[-1000:]}
            if pdf_path.exists():
                identity = profile.get("identity") if isinstance(profile.get("identity"), Mapping) else {}
                contact = identity.get("contact") if isinstance(identity.get("contact"), Mapping) else {}
                compilation["ats"] = verify_pdf_ats(pdf_path, email=contact.get("email"), phone=contact.get("phone"))
            else:
                review.setdefault("issues", []).append("compilation PDF échouée; consulter compilation.stderr_tail")
                review["pass"] = False
        else:
            compilation = {"compiler": None, "returncode": None, "pdf": None, "error": "lualatex/xelatex introuvable"}
            review.setdefault("issues", []).append("compilation PDF demandée mais aucun moteur LaTeX n'est installé")
            review["pass"] = False
    write_json_atomic(output_dir / "review.json", review)
    if compilation:
        write_json_atomic(output_dir / "compilation.json", compilation)
    return {"cv_text": str(cv_text_path), "cv_tex": str(cv_tex_path), "message": str(message_path), "review": review, "compilation": compilation, "evaluation": rank_opportunity(opportunity, profile).to_dict()}


def verify_pdf_ats(path: Path, *, email: str | None = None, phone: str | None = None) -> dict[str, Any]:
    text, warning = extract_pdf_text(path)
    checks = {"text_extracted": bool(text.strip()), "email_found": not email or email in text, "phone_found": not phone or re.sub(r"\D", "", phone) in re.sub(r"\D", "", text), "replacement_characters": "�" in text}
    return {"path": str(path), "warning": warning, "checks": checks, "pass": bool(text.strip()) and all(checks.values()), "text_preview": text[:500]}
