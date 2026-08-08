"""Connecteur officiel France Travail (API Offres d'emploi v2).

Le client est désactivé tant que ``FRANCE_TRAVAIL_CLIENT_ID`` et
``FRANCE_TRAVAIL_CLIENT_SECRET`` ne sont pas fournis. Les méthodes réseau
n'écrivent jamais les jetons et relancent une seule fois après expiration.
"""

from __future__ import annotations

from dataclasses import dataclass
import base64
import json
import os
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ..models import Opportunity, canonical_url, clean_text, utc_now
from ..opportunities import normalize_opportunity


@dataclass
class FranceTravailConfig:
    client_id: str | None = None
    client_secret: str | None = None
    token_url: str = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire"
    api_base_url: str = "https://api.francetravail.io/partenaire/offresdemploi/v2"
    scope: str = "api_offresdemploiv2 o2dsoffre"
    timeout: int = 20
    page_size: int = 50

    @classmethod
    def from_env(cls) -> "FranceTravailConfig":
        return cls(
            client_id=os.getenv("FRANCE_TRAVAIL_CLIENT_ID"),
            client_secret=os.getenv("FRANCE_TRAVAIL_CLIENT_SECRET"),
            token_url=os.getenv("FRANCE_TRAVAIL_TOKEN_URL", cls.token_url),
            api_base_url=os.getenv("FRANCE_TRAVAIL_API_BASE_URL", cls.api_base_url),
            scope=os.getenv("FRANCE_TRAVAIL_SCOPE", cls.scope),
        )

    def validate(self) -> None:
        if not self.client_id or not self.client_secret:
            raise RuntimeError("Connecteur France Travail désactivé: définissez FRANCE_TRAVAIL_CLIENT_ID et FRANCE_TRAVAIL_CLIENT_SECRET")


class FranceTravailError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class FranceTravailClient:
    def __init__(self, config: FranceTravailConfig | None = None, *, opener=urlopen):
        self.config = config or FranceTravailConfig.from_env()
        self._opener = opener
        self._access_token: str | None = None
        self._expires_at: float = 0

    def _token(self, *, force: bool = False) -> str:
        import time
        self.config.validate()
        if self._access_token and not force and time.time() < self._expires_at - 60:
            return self._access_token
        credentials = base64.b64encode(f"{self.config.client_id}:{self.config.client_secret}".encode()).decode()
        body = urlencode({"grant_type": "client_credentials", "scope": self.config.scope}).encode()
        request = Request(self.config.token_url, data=body, method="POST", headers={"Authorization": f"Basic {credentials}", "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "User-Agent": "ai-job-search-fr/0.1"})
        try:
            with self._opener(request, timeout=self.config.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            raise FranceTravailError(f"authentification France Travail échouée ({exc.code})", status=exc.code, retryable=exc.code >= 500) from exc
        except (URLError, OSError, json.JSONDecodeError) as exc:
            raise FranceTravailError(f"authentification France Travail impossible: {exc}", retryable=True) from exc
        token = payload.get("access_token")
        if not token:
            raise FranceTravailError("réponse France Travail sans access_token")
        self._access_token = token
        self._expires_at = time.time() + int(payload.get("expires_in", 1500))
        return token

    def _request_json(self, path: str, params: Mapping[str, Any] | None = None, *, range_start: int | None = None, retry_auth: bool = True) -> Any:
        query = urlencode({key: value for key, value in (params or {}).items() if value is not None and value != ""}, doseq=True)
        url = f"{self.config.api_base_url.rstrip('/')}/{path.lstrip('/')}" + (f"?{query}" if query else "")
        headers = {"Authorization": f"Bearer {self._token()}", "Accept": "application/json", "User-Agent": "ai-job-search-fr/0.1"}
        if range_start is not None:
            headers["Range"] = f"{range_start}-{range_start + max(1, self.config.page_size) - 1}"
        request = Request(url, headers=headers)
        try:
            with self._opener(request, timeout=self.config.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code == 401 and retry_auth:
                self._token(force=True)
                return self._request_json(path, params, range_start=range_start, retry_auth=False)
            if exc.code == 404:
                raise FranceTravailError(f"offre France Travail introuvable: {path}", status=404) from exc
            if exc.code == 429:
                raise FranceTravailError("quota France Travail atteint; réessayez plus tard", status=429, retryable=True) from exc
            raise FranceTravailError(f"API France Travail en erreur ({exc.code})", status=exc.code, retryable=exc.code >= 500) from exc
        except (URLError, OSError, json.JSONDecodeError) as exc:
            raise FranceTravailError(f"API France Travail inaccessible: {exc}", retryable=True) from exc

    def search(self, *, keywords: str, location: str | None = None, distance_km: int | None = None, contract_type: str | None = None, page: int = 0, max_pages: int = 1, **filters: Any) -> list[Opportunity]:
        """Recherche paginée, sans dépasser ``max_pages``."""
        opportunities: list[Opportunity] = []
        for index in range(max(1, max_pages)):
            start = (page + index) * self.config.page_size
            params = {"motsCles": keywords, "lieuRecherche": location, "distance": distance_km, "typeContrat": contract_type}
            params.update(filters)
            payload = self._request_json("offres/search", params, range_start=start)
            results = payload.get("resultats", []) if isinstance(payload, Mapping) else []
            for raw in results:
                opportunities.append(self.normalize(raw))
            if len(results) < self.config.page_size:
                break
        return opportunities

    def detail(self, source_id: str) -> Opportunity:
        return self.normalize(self._request_json(f"offres/{source_id}"))

    @staticmethod
    def normalize(raw: Mapping[str, Any]) -> Opportunity:
        company = raw.get("entreprise") or {}
        location = raw.get("lieu") or {}
        salary = raw.get("salaire") or {}
        contact = raw.get("contact") or {}
        origin = raw.get("origineOffre") or {}
        source_id = clean_text(raw.get("id"))
        source_url = canonical_url(origin.get("urlOrigine") or (f"https://candidat.francetravail.fr/offres/recherche/detail/{source_id}" if source_id else None))
        contract = clean_text(raw.get("typeContratLibelle") or raw.get("typeContrat"))
        mode = "alternance" if any(term in (contract or "").casefold() for term in ("alternance", "apprentissage", "professionnalisation")) else None
        skills = []
        for item in raw.get("competences") or []:
            if isinstance(item, Mapping):
                label = clean_text(item.get("libelle"))
                if label:
                    skills.append(label)
        data = {
            "source": "france_travail", "source_id": source_id, "source_url": source_url,
            "canonical_url": source_url, "title": raw.get("intitule"),
            "company": company.get("nom") if isinstance(company, Mapping) else company,
            "company_website": company.get("url") if isinstance(company, Mapping) else None,
            "location": location.get("libelle") if isinstance(location, Mapping) else location,
            "contract_type": contract, "job_search_mode": mode,
            "alternance_type": "apprentissage" if "apprentissage" in (contract or "").casefold() else "professionnalisation" if "professionnalisation" in (contract or "").casefold() else None,
            "experience_level": raw.get("experienceLibelle"), "education_level": raw.get("qualificationLibelle"),
            "published_at": raw.get("dateCreation"), "expires_at": raw.get("dateFin"), "verified_at": utc_now(),
            "description_raw": raw.get("description"), "description_normalized": raw.get("description"),
            "required_skills": skills, "salary": salary.get("libelle") if isinstance(salary, Mapping) else salary,
            "contact": contact if isinstance(contact, Mapping) else None,
            "application_channel": contact.get("urlPostulation") if isinstance(contact, Mapping) else None,
            "status": "active", "extra": {"france_travail_raw": {key: value for key, value in raw.items() if key not in {"description"}}},
        }
        return normalize_opportunity(data, source="france_travail")


def load_fixture(path: str | os.PathLike[str]) -> list[Opportunity]:
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    items = payload.get("resultats", []) if isinstance(payload, Mapping) else payload
    return [FranceTravailClient.normalize(item) for item in (items or [])]
