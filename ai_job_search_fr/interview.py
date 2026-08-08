"""Préparation d'entretien fondée sur l'offre et les documents réellement envoyés."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from .models import Opportunity
from .ranking import rank_opportunity
from .storage import write_text_atomic


def prepare_interview_pack(profile: Mapping[str, Any], opportunity: Opportunity, *, submitted_cv: str | None = None, submitted_message: str | None = None, feedback: str | None = None) -> str:
    evaluation = rank_opportunity(opportunity, profile)
    experiences = [item for section in ("experiences", "projects") for item in (profile.get(section) or []) if isinstance(item, Mapping) and item.get("status") in {"vérifiée", "déclarée"}]
    stars = (profile.get("writing_style") or {}).get("examples_star", []) if isinstance(profile.get("writing_style"), Mapping) else []
    lines = [f"# Préparation d'entretien — {opportunity.title or 'opportunité'}", "", f"Entreprise : {opportunity.company or 'à confirmer'}", f"Sources : {opportunity.source_url or 'à confirmer'} (vérifiée le {opportunity.verified_at or 'à confirmer'})", "", "## Mission et adéquation", opportunity.description_normalized or opportunity.description_raw or "Description non disponible; demander le périmètre.", "", f"Évaluation : {evaluation.global_score}/100, confiance {evaluation.confidence}/100", f"Forces : {', '.join(evaluation.strengths) or 'à préciser'}", f"Écarts : {', '.join(evaluation.gaps) or 'aucun écart identifié'}", "", "## Réponses STAR vérifiées"]
    if stars:
        lines.extend(f"- {item}" if not isinstance(item, Mapping) else f"- Situation : {item.get('situation', '[à compléter]')} — Action : {item.get('action', '[à compléter]')} — Résultat : {item.get('result', '[à compléter]')}" for item in stars[:5])
    elif experiences:
        lines.extend(f"- {item.get('title') or item.get('name')}: {item.get('results') or item.get('description') or '[résultat à préciser]'}" for item in experiences[:5])
    else:
        lines.append("- Aucun exemple confirmé : préparer une réponse honnête à partir des projets à confirmer.")
    lines.extend(["", "## Réponses honnêtes aux lacunes", "- Nommer ce qui n'a pas encore été pratiqué et proposer un plan d'apprentissage concret.", "- Ne pas transformer une compétence demandée mais absente en expérience.", "", "## Questions à poser", "- Quel résultat concret est attendu dans les trois premiers mois ?", "- Comment l'équipe accompagne-t-elle la montée en compétence ?", "- Quels outils et interlocuteurs structurent la mission ?"])
    if opportunity.job_search_mode == "alternance":
        lines.extend(["", "## Points administratifs à confirmer (alternance)", "- Type de contrat, rythme école/entreprise, date de début et durée.", "- Validation de la mission par l'établissement et présence d'un CFA partenaire."])
    if submitted_cv or submitted_message:
        lines.extend(["", "## Documents réellement envoyés", f"- CV archivé : {'oui' if submitted_cv else 'non'}", f"- Message archivé : {'oui' if submitted_message else 'non'}"])
    if feedback:
        lines.extend(["", "## Feedback antérieur", feedback])
    return "\n".join(lines).strip() + "\n"


def write_interview_pack(profile: Mapping[str, Any], opportunity: Opportunity, output: Path, **kwargs: Any) -> str:
    pack = prepare_interview_pack(profile, opportunity, **kwargs)
    write_text_atomic(output, pack)
    return pack

