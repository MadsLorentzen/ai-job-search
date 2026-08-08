"""Classement explicable et configurable des opportunités."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import re
from typing import Any, Mapping

from .models import Opportunity, SearchProfile, normalize_text
from .opportunities import freshness


DEFAULT_WEIGHTS = {
    "missions": 0.25,
    "skills": 0.25,
    "compatibility": 0.20,
    "location": 0.15,
    "trajectory": 0.10,
    "information_quality": 0.05,
}


@dataclass
class Evaluation:
    opportunity_id: str
    scores: dict[str, float]
    global_score: float
    confidence: float
    elimination_triggers: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    to_verify: list[str] = field(default_factory=list)
    urgency: str | None = None
    recommendation: str = "approfondir"
    weights: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    explanation: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "opportunity_id": self.opportunity_id,
            "scores": self.scores,
            "global_score": self.global_score,
            "confidence": self.confidence,
            "elimination_triggers": self.elimination_triggers,
            "strengths": self.strengths,
            "gaps": self.gaps,
            "to_verify": self.to_verify,
            "urgency": self.urgency,
            "recommendation": self.recommendation,
            "weights": self.weights,
            "explanation": self.explanation,
        }


def _tokens(value: Any) -> set[str]:
    return {token for token in re.findall(r"[\wÀ-ÿ+#.-]{2,}", normalize_text(value)) if token not in {"avec", "pour", "dans", "une", "des", "les", "sur", "aux"}}


def _profile_tokens(profile: Mapping[str, Any]) -> set[str]:
    values: list[str] = []
    for section in ("skills", "experiences", "projects", "education"):
        items = profile.get(section, [])
        if isinstance(items, list):
            for item in items:
                if isinstance(item, Mapping):
                    values.extend(str(item.get(key, "")) for key in ("name", "title", "description", "skills", "technologies", "results"))
                else:
                    values.append(str(item))
    return _tokens(" ".join(values))


def _search(profile: Mapping[str, Any] | SearchProfile) -> SearchProfile:
    return profile if isinstance(profile, SearchProfile) else SearchProfile.from_mapping(profile.get("search", profile))


def _matching_score(wanted: list[str], text: str, *, empty_value: float = 60.0) -> tuple[float, list[str]]:
    if not wanted:
        return empty_value, []
    text_tokens = _tokens(text)
    matched, missing = [], []
    for item in wanted:
        item_tokens = _tokens(item)
        if item_tokens and len(item_tokens & text_tokens) / len(item_tokens) >= 0.5:
            matched.append(item)
        else:
            missing.append(item)
    return round(100 * len(matched) / len(wanted), 1), missing


def _explicit_eliminations(opportunity: Opportunity, search: SearchProfile) -> list[str]:
    text = opportunity.search_text()
    triggers: list[str] = []
    for criterion in search.elimination_criteria:
        normalized = normalize_text(criterion)
        if normalized.startswith("contrat:"):
            refused = normalized.split(":", 1)[1].strip()
            if refused and refused in normalize_text(opportunity.contract_type):
                triggers.append(criterion)
        elif normalized.startswith("lieu:"):
            refused = normalized.split(":", 1)[1].strip()
            if refused and refused in normalize_text(opportunity.location):
                triggers.append(criterion)
        elif normalized.startswith("mission:"):
            refused = normalized.split(":", 1)[1].strip()
            if refused and refused in text:
                triggers.append(criterion)
        elif normalized and normalized in text:
            triggers.append(criterion)
    if search.refused_contracts and opportunity.contract_type:
        contract = normalize_text(opportunity.contract_type)
        if any(normalize_text(value) in contract for value in search.refused_contracts):
            triggers.append(f"contrat refusé: {opportunity.contract_type}")
    return list(dict.fromkeys(triggers))


def _compatibility(opportunity: Opportunity, search: SearchProfile, profile: Mapping[str, Any]) -> tuple[float, list[str], list[str]]:
    gaps, verify = [], []
    score = 70.0
    contract = normalize_text(opportunity.contract_type)
    if search.accepted_contracts:
        accepted = [normalize_text(v) for v in search.accepted_contracts]
        if not contract:
            verify.append("type de contrat à confirmer")
            score -= 5
        elif any(v in contract for v in accepted):
            score += 20
        else:
            score -= 35
            gaps.append("contrat hors préférences déclarées")
    if search.mode == "alternance":
        alt = search.alternance or {}
        if opportunity.alternance_type and alt.get("alternance_type"):
            if normalize_text(opportunity.alternance_type) != normalize_text(alt["alternance_type"]) and normalize_text(alt["alternance_type"]) not in {"indifférent", "indifferent"}:
                score -= 25
                gaps.append("type d'alternance différent")
        else:
            verify.append("type d'alternance")
        for label, field_name in (("niveau préparé", "education_level"), ("rythme école/entreprise", "work_study_schedule"), ("date de début", "start_date")):
            if not getattr(opportunity, field_name):
                verify.append(label)
        if not opportunity.duration:
            verify.append("durée de l'alternance")
        if alt.get("start_date") and opportunity.start_date:
            verify.append("compatibilité exacte de la rentrée")
        if alt.get("school_validation_required") and not opportunity.extra.get("school_validation"):
            verify.append("validation de la mission par l'école")
        if alt.get("school") and opportunity.education_level and normalize_text(alt["school"]) not in normalize_text(opportunity.education_level):
            verify.append("validation de la formation par l'école")
    if search.mode == "premier_emploi":
        required_experience = normalize_text(opportunity.experience_level or "")
        if required_experience and any(word in required_experience for word in ("confirmé", "senior", "5 ans", "3 ans")):
            gaps.append("expérience demandée potentiellement supérieure")
            score -= 20
        elif required_experience:
            score += 5
        preferred = opportunity.preferred_skills
        if preferred:
            transferable = _profile_tokens(profile)
            unmet_preferred = [skill for skill in preferred if not (_tokens(skill) & transferable)]
            if unmet_preferred:
                verify.append("compétences préférentielles à comparer aux expériences transférables")
                gaps.extend(f"préférence: {skill}" for skill in unmet_preferred[:2])
    return max(0, min(100, score)), gaps, verify


def rank_opportunity(opportunity: Opportunity, profile: Mapping[str, Any], *, weights: Mapping[str, float] | None = None, now: datetime | None = None) -> Evaluation:
    search = _search(profile)
    profile_tokens = _profile_tokens(profile)
    text = opportunity.search_text()
    score_missions, missing_missions = _matching_score(search.missions_wanted + search.target_families + search.target_titles, text)
    required = opportunity.required_skills
    if required:
        matches = [skill for skill in required if _tokens(skill) & profile_tokens]
        score_skills = 100 * len(matches) / len(required)
        skill_gaps = [skill for skill in required if skill not in matches]
    else:
        score_skills, skill_gaps = _matching_score(search.missions_wanted, text)
    score_compat, compatibility_gaps, verify = _compatibility(opportunity, search, profile)
    location_text = f"{opportunity.location or ''} {opportunity.remote_policy or ''}"
    score_location, location_gaps = _matching_score(search.locations, location_text, empty_value=65.0)
    if search.remote_preference and opportunity.remote_policy:
        if normalize_text(search.remote_preference) in normalize_text(opportunity.remote_policy):
            score_location = min(100, score_location + 15)
    score_trajectory, trajectory_gaps = _matching_score(search.sectors, text, empty_value=60.0)
    known_fields = sum(bool(getattr(opportunity, key)) for key in ("title", "company", "location", "contract_type", "description_raw", "source_url", "verified_at"))
    score_info = round(100 * known_fields / 7, 1)
    fresh = freshness(opportunity, now=now)
    if fresh in {"à_vérifier", "inaccessible"}:
        verify.append("fraîcheur/source à vérifier")
        score_info = max(0, score_info - 15)
    weights_final = dict(DEFAULT_WEIGHTS)
    if weights:
        for key, value in weights.items():
            if key in weights_final and float(value) >= 0:
                weights_final[key] = float(value)
    total = sum(weights_final.values()) or 1
    weights_final = {key: value / total for key, value in weights_final.items()}
    scores = {"missions": round(score_missions, 1), "skills": round(score_skills, 1), "compatibility": round(score_compat, 1), "location": round(score_location, 1), "trajectory": round(score_trajectory, 1), "information_quality": score_info}
    global_score = round(sum(scores[key] * weights_final[key] for key in scores), 1)
    triggers = _explicit_eliminations(opportunity, search)
    gaps = list(dict.fromkeys(missing_missions + skill_gaps + compatibility_gaps + location_gaps + trajectory_gaps))[:3]
    strengths: list[str] = []
    ranked = sorted(scores.items(), key=lambda pair: pair[1], reverse=True)
    labels = {"missions": "missions proches du projet", "skills": "compétences démontrées", "compatibility": "compatibilité du poste", "location": "organisation/localisation", "trajectory": "secteur et trajectoire", "information_quality": "source documentée"}
    strengths = [labels[key] for key, value in ranked if value >= 65][:3]
    confidence = round(max(0, min(100, 45 + score_info * 0.4 + (15 if not verify else 0))), 1)
    urgency = None
    if opportunity.expires_at:
        try:
            expiry = datetime.fromisoformat(opportunity.expires_at.replace("Z", "+00:00"))
            reference = now or datetime.now(timezone.utc)
            days = (expiry - reference).days
            urgency = "urgente" if days <= 3 else "proche" if days <= 10 else "normale"
        except ValueError:
            verify.append("échéance à confirmer")
    if triggers:
        recommendation = "ignorer"
    elif opportunity.spontaneous:
        recommendation = "contacter" if global_score >= 55 else "approfondir"
    elif fresh in {"à_vérifier", "inaccessible"}:
        recommendation = "surveiller" if global_score >= 55 else "approfondir"
    elif global_score >= 72 and confidence >= 60:
        recommendation = "candidater"
    elif global_score >= 52:
        recommendation = "approfondir"
    else:
        recommendation = "surveiller"
    explanation = f"Score {global_score}/100, confiance {confidence}/100. Pondérations: " + ", ".join(f"{k}={v:.0%}" for k, v in weights_final.items()) + "."
    return Evaluation(opportunity.id, scores, global_score, confidence, triggers, strengths[:3], gaps, list(dict.fromkeys(verify))[:6], urgency, recommendation, weights_final, explanation)


def rank_batch(opportunities: list[Opportunity], profile: Mapping[str, Any], *, weights: Mapping[str, float] | None = None) -> list[Evaluation]:
    evaluations = [rank_opportunity(item, profile, weights=weights) for item in opportunities]
    return sorted(evaluations, key=lambda item: (item.recommendation != "candidater", -item.global_score, -item.confidence))
