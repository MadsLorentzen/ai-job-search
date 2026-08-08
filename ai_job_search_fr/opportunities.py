"""Import, normalisation, déduplication et fraîcheur des opportunités."""

from __future__ import annotations

from difflib import SequenceMatcher
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Any, Iterable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import Opportunity, canonical_url, clean_text, normalize_text, stable_id, utc_now
from .storage import extract_pdf_text, read_csv_rows, read_json, read_text, read_xlsx_rows, write_json_atomic


URL_RE = re.compile(r"https?://[^\s<>\]\[)]+", re.I)
FIELD_LABELS = {
    "entreprise": "company", "société": "company", "company": "company",
    "poste": "title", "intitulé": "title", "intitule": "title", "title": "title",
    "lieu": "location", "localisation": "location", "ville": "location", "location": "location",
    "contrat": "contract_type", "type de contrat": "contract_type", "contract": "contract_type",
    "télétravail": "remote_policy", "teletravail": "remote_policy", "remote": "remote_policy",
    "début": "start_date", "date de début": "start_date", "start date": "start_date",
    "durée": "duration", "duree": "duration", "duration": "duration",
    "rythme": "work_study_schedule", "schedule": "work_study_schedule",
    "salaire": "salary", "rémunération": "salary", "remuneration": "salary",
    "niveau": "education_level", "formation": "education_level",
}


def _label_value(line: str) -> tuple[str, str] | None:
    if ":" not in line:
        return None
    key, value = line.split(":", 1)
    normalized = normalize_text(key).rstrip()
    if normalized in FIELD_LABELS:
        return FIELD_LABELS[normalized], value.strip()
    return None


def normalize_opportunity(raw: Mapping[str, Any] | Opportunity, *, source: str | None = None) -> Opportunity:
    if isinstance(raw, Opportunity):
        result = raw
    else:
        result = Opportunity.from_mapping(raw, source=source)
    if not result.description_normalized and result.description_raw:
        result.description_normalized = re.sub(r"\s+", " ", result.description_raw).strip()
    if not result.verified_at:
        result.verified_at = utc_now()
    if not result.status:
        result.status = "à_vérifier"
    if result.source_url:
        result.source_url = canonical_url(result.source_url)
    result.canonical_url = canonical_url(result.canonical_url or result.source_url)
    if result.canonical_url and not result.sources:
        result.sources = [{"url": result.canonical_url, "source": result.source, "verified_at": result.verified_at}]
    return result


def parse_opportunity_text(text: str, *, source_url: str | None = None, source: str = "manual") -> Opportunity:
    """Parseur dégradé déterministe: tout champ incertain reste absent."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    fields: dict[str, Any] = {"description_raw": text, "source": source, "source_url": source_url}
    unlabeled: list[str] = []
    for line in lines:
        pair = _label_value(line)
        if pair:
            key, value = pair
            if value:
                fields[key] = value
        else:
            unlabeled.append(line)
    fields.setdefault("title", unlabeled[0] if unlabeled else None)
    fields.setdefault("company", _infer_company(text))
    fields.setdefault("location", _infer_location(text))
    fields["required_skills"] = _extract_skills(text, required=True)
    fields["preferred_skills"] = _extract_skills(text, required=False)
    fields["languages"] = _extract_languages(text)
    fields["contract_type"] = fields.get("contract_type") or _infer_contract(text)
    fields["job_search_mode"] = _infer_mode(text)
    if source_url:
        fields["canonical_url"] = canonical_url(source_url)
    return normalize_opportunity(fields, source=source)


def _infer_company(text: str) -> str | None:
    for pattern in (r"(?im)^(?:entreprise|société|company)\s*:\s*(.+)$", r"(?i)chez\s+([A-ZÀ-ÖØ-Þ][\wÀ-ÿ& .'-]{2,60})"):
        match = re.search(pattern, text)
        if match:
            return clean_text(match.group(1))
    return None


def _infer_location(text: str) -> str | None:
    match = re.search(r"(?im)^(?:lieu|localisation|ville)\s*:\s*(.+)$", text)
    return clean_text(match.group(1)) if match else None


def _infer_contract(text: str) -> str | None:
    lowered = normalize_text(text)
    for candidate in ("alternance", "apprentissage", "professionnalisation", "stage", "cdi", "cdd", "freelance", "vie"):
        if candidate in lowered:
            return candidate
    return None


def _infer_mode(text: str) -> str | None:
    lowered = normalize_text(text)
    if "alternance" in lowered or "apprentissage" in lowered:
        return "alternance"
    if "stage" in lowered:
        return "stage"
    if "cdi" in lowered or "cdd" in lowered:
        return "premier_emploi"
    return None


def _extract_skills(text: str, *, required: bool) -> list[str]:
    patterns = [r"(?im)^(?:compétences|competences|skills)(?: requises?| obligatoires?)?\s*:\s*(.+)$"] if required else [r"(?im)^(?:compétences|competences|skills)(?: appréciées?| souhaitées?| préférées?)\s*:\s*(.+)$"]
    values: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            values.extend(x.strip() for x in re.split(r"[,;|/]", match.group(1)) if x.strip())
    return list(dict.fromkeys(values))


def _extract_languages(text: str) -> list[str]:
    match = re.search(r"(?im)^(?:langues?|languages?)\s*:\s*(.+)$", text)
    return list(dict.fromkeys(x.strip() for x in re.split(r"[,;/]", match.group(1)) if x.strip())) if match else []


def import_opportunity_file(path: Path, *, source: str = "manual") -> list[Opportunity]:
    suffix = path.suffix.lower()
    if suffix in {".json"}:
        data = read_json(path)
        items = data if isinstance(data, list) else data.get("opportunities", [data])
        return [normalize_opportunity(item, source=source) for item in items]
    if suffix in {".csv"}:
        return [normalize_opportunity(row, source=source) for row in read_csv_rows(path)]
    if suffix in {".xlsx", ".xlsm"}:
        return [normalize_opportunity(row, source=source) for row in read_xlsx_rows(path)]
    if suffix == ".pdf":
        text, warning = extract_pdf_text(path)
        if not text:
            raise ValueError(warning or "PDF sans couche texte; collez son contenu manuellement")
        opportunity = parse_opportunity_text(text, source=source)
        if warning:
            opportunity.extra["import_warning"] = warning
        return [opportunity]
    text, warning = read_text(path)
    opportunity = parse_opportunity_text(text, source=source)
    if warning:
        opportunity.extra["import_warning"] = warning
    return [opportunity]


def fetch_opportunity_url(url: str, *, timeout: int = 15) -> Opportunity:
    """Récupère une page unique; en cas d'échec l'opportunité reste traçable."""
    url = canonical_url(url) or url
    request = Request(url, headers={"User-Agent": "ai-job-search-fr/0.1 (+import-manuel)"})
    try:
        with urlopen(request, timeout=timeout) as response:  # nosec B310 - URL explicitement fournie par l'utilisateur
            content_type = response.headers.get_content_type()
            payload = response.read()
            charset = response.headers.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
        # La normalisation conserve le HTML dans description_raw mais réduit les balises.
        plain = re.sub(r"<script.*?</script>|<style.*?</style>", " ", text, flags=re.I | re.S)
        plain = re.sub(r"<[^>]+>", " ", plain)
        plain = re.sub(r"\s+", " ", plain).strip()
        result = parse_opportunity_text(plain, source_url=url, source="url")
        result.extra["content_type"] = content_type
        return result
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return normalize_opportunity({"source": "url", "source_url": url, "status": "inaccessible", "title": None, "extra": {"error": str(exc)}}, source="url")


def make_spontaneous_opportunity(company: Mapping[str, Any]) -> Opportunity:
    """Crée une cible sans inventer d'annonce."""
    data = dict(company)
    data.update({"spontaneous": True, "status": "à_vérifier", "job_search_mode": data.get("job_search_mode") or "spontaneous"})
    if not data.get("title"):
        data["title"] = f"Candidature spontanée — {data.get('company') or data.get('entreprise') or 'entreprise'}"
    data.setdefault("description_raw", data.get("mission_hypothesis"))
    data.setdefault("verified_at", utc_now())
    result = normalize_opportunity(data, source=data.get("source") or "company_public_info")
    from datetime import date, timedelta
    result.extra.setdefault("mission_hypothesis", data.get("mission_hypothesis"))
    result.extra.setdefault("next_verification_at", (date.today() + timedelta(days=30)).isoformat())
    result.extra.setdefault("public_contact", data.get("contact"))
    return result


def _token_set(text: str) -> set[str]:
    return {token for token in re.findall(r"[\wÀ-ÿ]{3,}", normalize_text(text)) if token not in {"avec", "pour", "dans", "une", "des", "les"}}


def similarity(a: Opportunity, b: Opportunity) -> float:
    if a.canonical_url and b.canonical_url and a.canonical_url == b.canonical_url:
        return 1.0
    left = " ".join([a.company or "", a.title or "", a.location or "", a.description_normalized or a.description_raw or ""])
    right = " ".join([b.company or "", b.title or "", b.location or "", b.description_normalized or b.description_raw or ""])
    seq = SequenceMatcher(None, normalize_text(left), normalize_text(right)).ratio()
    tokens_a, tokens_b = _token_set(left), _token_set(right)
    jaccard = len(tokens_a & tokens_b) / len(tokens_a | tokens_b) if tokens_a | tokens_b else 0
    return max(seq, jaccard)


def deduplicate(opportunities: Iterable[Opportunity], *, threshold: float = 0.84) -> tuple[list[Opportunity], list[dict[str, Any]]]:
    unique: list[Opportunity] = []
    merges: list[dict[str, Any]] = []
    by_source_id: dict[tuple[str | None, str | None], Opportunity] = {}
    for opportunity in opportunities:
        candidate = normalize_opportunity(opportunity)
        key = (candidate.source, candidate.source_id)
        match = by_source_id.get(key) if candidate.source and candidate.source_id else None
        if match is None:
            for existing in unique:
                if candidate.canonical_url and existing.canonical_url and candidate.canonical_url == existing.canonical_url:
                    match = existing
                    break
                if normalize_text(candidate.company) == normalize_text(existing.company) and normalize_text(candidate.title) == normalize_text(existing.title) and normalize_text(candidate.location) == normalize_text(existing.location) and similarity(candidate, existing) >= threshold:
                    match = existing
                    break
        if match is None:
            unique.append(candidate)
            if candidate.source and candidate.source_id:
                by_source_id[key] = candidate
            continue
        merged_source = {"id": candidate.id, "source": candidate.source, "source_id": candidate.source_id, "url": candidate.canonical_url or candidate.source_url, "verified_at": candidate.verified_at}
        if merged_source not in match.sources:
            match.sources.append(merged_source)
        if match.status == "inaccessible" and candidate.status != "inaccessible":
            match.status = candidate.status
        merges.append({"kept": match.id, "merged": candidate.id, "similarity": round(similarity(candidate, match), 4), "source": merged_source})
    return unique, merges


def freshness(opportunity: Opportunity, *, now: datetime | None = None, max_age_days: int = 30) -> str:
    if opportunity.status == "inaccessible":
        return "inaccessible"
    current = now or datetime.now(timezone.utc)
    if opportunity.expires_at:
        try:
            expires = datetime.fromisoformat(opportunity.expires_at.replace("Z", "+00:00"))
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires < current:
                return "expirée"
        except ValueError:
            pass
    if opportunity.verified_at:
        try:
            verified = datetime.fromisoformat(opportunity.verified_at.replace("Z", "+00:00"))
            if verified.tzinfo is None:
                verified = verified.replace(tzinfo=timezone.utc)
            age = (current - verified).days
            if age <= max_age_days:
                return "active"
            if age <= max_age_days * 2:
                return "probablement_active"
            return "à_vérifier"
        except ValueError:
            pass
    return "à_vérifier"


def refresh_freshness(opportunities: Iterable[Opportunity], *, now: datetime | None = None, max_age_days: int = 30) -> list[Opportunity]:
    result = []
    for opportunity in opportunities:
        opportunity.status = freshness(opportunity, now=now, max_age_days=max_age_days)
        result.append(opportunity)
    return result


def save_opportunities(path: Path, opportunities: Iterable[Opportunity], merges: list[dict[str, Any]] | None = None) -> None:
    write_json_atomic(path, {"schema_version": 1, "updated_at": utc_now(), "opportunities": [o.to_dict() for o in opportunities], "merges": merges or []})


def load_opportunities(path: Path) -> list[Opportunity]:
    data = read_json(path)
    items = data.get("opportunities", data) if isinstance(data, Mapping) else data
    return [Opportunity.from_mapping(item) for item in items]
