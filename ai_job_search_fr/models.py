"""Modèles et règles de validation indépendants de l'agent utilisé."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Mapping
import hashlib
import re
import unicodedata


STATUSES = {
    "repérée",
    "à_qualifier",
    "prioritaire",
    "à_candidater",
    "candidature_envoyée",
    "relance_due",
    "entretien",
    "test",
    "offre_reçue",
    "refus",
    "retirée",
    "sans_réponse",
    "embauche",
}
OPPORTUNITY_FRESHNESS = {"active", "probablement_active", "à_vérifier", "expirée", "inaccessible"}
EVIDENCE_STATUSES = {"vérifiée", "déclarée", "à_confirmer", "interdite"}
ACTION_RECOMMENDATIONS = {"candidater", "contacter", "surveiller", "approfondir", "ignorer"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def today() -> str:
    return date.today().isoformat()


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).replace("\x00", "").strip()
    return text or None


def normalize_text(value: Any) -> str:
    """Normalise un texte pour comparaison sans modifier le texte affiché."""
    text = clean_text(value) or ""
    text = unicodedata.normalize("NFKC", text).casefold()
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def canonical_url(url: Any) -> str | None:
    """Retire les variations inoffensives d'une URL, sans suivre le lien."""
    value = clean_text(url)
    if not value:
        return None
    value = value.split("#", 1)[0]
    value = re.sub(r"[?&](utm_[^=]+|source|ref|tracking)=[^&]*", "", value, flags=re.I)
    value = re.sub(r"[?&]$", "", value)
    return value.rstrip("/")


def stable_id(*parts: Any) -> str:
    payload = "|".join(normalize_text(p) for p in parts if clean_text(p))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


@dataclass
class Opportunity:
    """Schéma commun d'une offre ou d'une candidature spontanée.

    Les valeurs inconnues restent ``None``. Les clés supplémentaires provenant
    d'un connecteur sont conservées dans ``extra`` afin de ne pas perdre de
    provenance lors d'une normalisation.
    """

    id: str
    source: str | None = None
    source_id: str | None = None
    source_url: str | None = None
    canonical_url: str | None = None
    title: str | None = None
    company: str | None = None
    company_website: str | None = None
    location: str | None = None
    remote_policy: str | None = None
    contract_type: str | None = None
    job_search_mode: str | None = None
    alternance_type: str | None = None
    experience_level: str | None = None
    education_level: str | None = None
    start_date: str | None = None
    duration: str | None = None
    work_study_schedule: str | None = None
    published_at: str | None = None
    expires_at: str | None = None
    verified_at: str | None = None
    description_raw: str | None = None
    description_normalized: str | None = None
    required_skills: list[str] = field(default_factory=list)
    preferred_skills: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    salary: str | None = None
    contact: dict[str, Any] | None = None
    application_channel: str | None = None
    spontaneous: bool = False
    status: str = "à_vérifier"
    sources: list[dict[str, Any]] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any], *, source: str | None = None) -> "Opportunity":
        data = dict(raw)
        source_id = clean_text(data.get("source_id"))
        source_url = canonical_url(data.get("source_url") or data.get("url"))
        company = clean_text(data.get("company") or data.get("entreprise"))
        title = clean_text(data.get("title") or data.get("titre"))
        location = clean_text(data.get("location") or data.get("lieu") or data.get("ville"))
        canonical = canonical_url(data.get("canonical_url") or source_url)
        ident = clean_text(data.get("id")) or stable_id(source or data.get("source"), source_id, canonical, company, title, location)
        known = {f.name for f in cls.__dataclass_fields__.values()}
        values: dict[str, Any] = {}
        for key in known:
            if key == "extra":
                continue
            if key in data:
                values[key] = data[key]
        values.update({"id": ident, "source": clean_text(data.get("source")) or source,
                       "source_id": source_id, "source_url": source_url,
                       "canonical_url": canonical, "title": title, "company": company,
                       "location": location})
        for key in ("required_skills", "preferred_skills", "languages"):
            value = values.get(key)
            if value is None:
                values[key] = []
            elif isinstance(value, str):
                values[key] = [x.strip() for x in re.split(r"[,;\n]", value) if x.strip()]
            else:
                values[key] = [clean_text(x) for x in value if clean_text(x)]
        values["sources"] = list(values.get("sources") or [])
        if source_url and not any(isinstance(s, dict) and s.get("url") == source_url for s in values["sources"]):
            values["sources"].append({"url": source_url, "source": source or values.get("source"), "verified_at": values.get("verified_at")})
        values["status"] = values.get("status") or "à_vérifier"
        extras = data.get("extra") if isinstance(data.get("extra"), Mapping) else {}
        values["extra"] = {**extras, **{k: v for k, v in data.items() if k not in known}}
        return cls(**{k: v for k, v in values.items() if k in known})

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def search_text(self) -> str:
        return normalize_text(" ".join([
            self.title or "", self.company or "", self.location or "",
            self.description_normalized or self.description_raw or "",
            " ".join(self.required_skills), " ".join(self.preferred_skills),
        ]))


@dataclass
class SearchProfile:
    """Préférences déclarées par le candidat pour une recherche."""

    mode: str = "premier_emploi"
    target_titles: list[str] = field(default_factory=list)
    target_families: list[str] = field(default_factory=list)
    sectors: list[str] = field(default_factory=list)
    company_types: list[str] = field(default_factory=list)
    accepted_experience_levels: list[str] = field(default_factory=list)
    accepted_contracts: list[str] = field(default_factory=list)
    refused_contracts: list[str] = field(default_factory=list)
    available_from: str | None = None
    locations: list[str] = field(default_factory=list)
    mobility: str | None = None
    remote_preference: str | None = None
    max_commute_minutes: int | None = None
    missions_wanted: list[str] = field(default_factory=list)
    missions_refused: list[str] = field(default_factory=list)
    elimination_criteria: list[str] = field(default_factory=list)
    preferences: list[str] = field(default_factory=list)
    alternance: dict[str, Any] | None = None
    first_job: dict[str, Any] | None = None

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any] | None) -> "SearchProfile":
        data = dict(raw or {})
        known = {f.name for f in cls.__dataclass_fields__.values()}
        data = {k: v for k, v in data.items() if k in known}
        for key in ("target_titles", "target_families", "sectors", "company_types", "accepted_experience_levels", "accepted_contracts", "refused_contracts", "locations", "missions_wanted", "missions_refused", "elimination_criteria", "preferences"):
            if isinstance(data.get(key), str):
                data[key] = [x.strip() for x in re.split(r"[,;\n]", data[key]) if x.strip()]
        return cls(**data)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_candidate_profile(profile: Mapping[str, Any]) -> list[str]:
    """Retourne des erreurs explicites sans rejeter les champs d'extension."""
    errors: list[str] = []
    for key in ("identity", "education", "experiences", "projects", "skills", "search"):
        if key not in profile:
            errors.append(f"champ requis absent: {key}")
    if "experiences" in profile and not isinstance(profile["experiences"], list):
        errors.append("experiences doit être une liste")
    if "projects" in profile and not isinstance(profile["projects"], list):
        errors.append("projects doit être une liste")
    evidence_items = []
    for section in ("experiences", "projects", "skills", "education"):
        value = profile.get(section, [])
        if isinstance(value, list):
            evidence_items.extend(value)
    for idx, item in enumerate(evidence_items):
        if not isinstance(item, Mapping):
            errors.append(f"élément de parcours #{idx + 1} doit être un objet")
            continue
        if item.get("status") not in EVIDENCE_STATUSES:
            errors.append(f"statut de preuve invalide pour {item.get('name') or item.get('title') or idx + 1}: attendu {sorted(EVIDENCE_STATUSES)}")
        if not item.get("provenance"):
            errors.append(f"provenance absente pour {item.get('name') or item.get('title') or idx + 1}")
    search = profile.get("search")
    if search is not None and not isinstance(search, Mapping):
        errors.append("search doit être un objet")
    if isinstance(search, Mapping):
        mode = search.get("mode")
        if mode == "alternance" and not isinstance(search.get("alternance"), Mapping):
            errors.append("search.alternance requis quand le mode alternance est actif")
    return errors
