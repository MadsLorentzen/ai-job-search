"""Agrégation des lacunes observées sur les opportunités ciblées."""

from __future__ import annotations

from collections import Counter
from typing import Any, Mapping

from .models import Opportunity, normalize_text


def analyze_skill_gaps(opportunities: list[Opportunity], profile: Mapping[str, Any]) -> dict[str, Any]:
    corpus_parts: list[str] = []
    for section in ("skills", "experiences", "projects"):
        for item in profile.get(section, []) if isinstance(profile.get(section, []), list) else []:
            if isinstance(item, Mapping) and item.get("status") in {"vérifiée", "déclarée"}:
                corpus_parts.append(" ".join(str(item.get(key, "")) for key in ("name", "title", "description", "skills", "technologies")))
    corpus = normalize_text(" ".join(corpus_parts))
    counts: Counter[str] = Counter()
    examples: dict[str, list[str]] = {}
    for opportunity in opportunities:
        for skill in opportunity.required_skills:
            if normalize_text(skill) not in corpus:
                key = normalize_text(skill)
                counts[key] += 1
                examples.setdefault(key, []).append(opportunity.id)
    rows = []
    for skill, count in counts.most_common():
        rows.append({"skill": skill, "occurrences": count, "signal": "récurrent" if count >= 2 else "signal_faible", "opportunity_ids": examples[skill], "next_step": f"Trouver une preuve ou un exercice pratique en {skill}."})
    return {"schema_version": 1, "gaps": rows, "note": "Les ressources externes doivent être ajoutées avec date et source; aucune compétence n'est inscrite automatiquement au profil."}

