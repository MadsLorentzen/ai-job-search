"""Tracker CSV portable et import du tableur existant."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import shutil
from typing import Any, Iterable, Mapping

from .models import Opportunity, STATUSES, stable_id, utc_now
from .opportunities import normalize_opportunity, save_opportunities
from .storage import read_csv_rows, read_xlsx_rows, write_csv_atomic, write_json_atomic, write_text_atomic, write_xlsx_atomic


TRACKER_COLUMNS = [
    "opportunity_id", "company", "role", "source_url", "location", "contract_type",
    "status", "priority", "discovered_at", "applied_at", "next_action_at", "channel",
    "note", "source", "last_event_at", "followup_count", "archive_dir",
]

LEGACY_MAP = {
    "priorité": "priority", "priorite": "priority", "ville/zone": "location", "ville / zone": "location",
    "entreprise": "company", "type": "contract_type", "pertinence": "relevance", "site web": "company_website",
    "téléphone": "phone", "telephone": "phone", "courriel": "email", "contact email": "email", "point d'entrée": "contact_point",
    "point d’entree": "contact_point", "point d’entrée": "contact_point", "annonces/liens": "links", "annonce(s) / lien(s)": "links",
    "statut de l'annonce": "ad_status", "statut annonce": "ad_status", "date de vérification": "verified_at",
    "vérifié le": "verified_at", "adéquation/action recommandée": "recommendation", "adéquation / action recommandée": "recommendation",
    "sources": "sources", "indicateur d'annonce repérée": "listing_found", "annonce repérée": "listing_found",
}


def _canonical_key(key: Any) -> str:
    key = str(key or "").strip().casefold()
    key = re.sub(r"\s+", " ", key)
    return LEGACY_MAP.get(key, key.replace(" ", "_").replace("/", "_"))


def normalize_legacy_row(row: Mapping[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in row.items():
        canonical = _canonical_key(key)
        normalized[canonical] = "" if value is None else str(value).strip()
    return normalized


def split_links(value: Any) -> list[str]:
    if not value:
        return []
    return list(dict.fromkeys(re.findall(r"https?://[^\s,;]+", str(value))))


def read_tracker_source(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() in {".xlsx", ".xlsm"}:
        return [normalize_legacy_row(row) for row in read_xlsx_rows(path, sheet_name="Entreprises")]
    return [normalize_legacy_row(row) for row in read_csv_rows(path)]


def export_tracker_xlsx(tracker_path: Path, output_path: Path) -> None:
    rows = read_csv_rows(tracker_path) if tracker_path.exists() else []
    write_xlsx_atomic(output_path, rows, TRACKER_COLUMNS)


def import_existing_tracker(path: Path, data_dir: Path, *, dry_run: bool = False) -> dict[str, Any]:
    rows = read_tracker_source(path)
    companies: list[dict[str, Any]] = []
    opportunities: list[Opportunity] = []
    mapping: list[dict[str, Any]] = []
    for index, row in enumerate(rows, 1):
        company_name = row.get("company") or f"Entreprise sans nom — ligne {index}"
        company_id = stable_id("company", company_name, row.get("company_website"))
        company = {
            "id": company_id, "name": company_name, "website": row.get("company_website") or None,
            "location": row.get("location") or None, "phone": row.get("phone") or None,
            "email": row.get("email") or None, "contact_point": row.get("contact_point") or None,
            "priority": row.get("priority") or None, "sources": split_links(row.get("sources")),
            "legacy_row": index,
        }
        companies.append(company)
        links = split_links(row.get("links"))
        linked_ids = []
        for link_index, link in enumerate(links, 1):
            opportunity = normalize_opportunity({
                "source": "legacy_tracker", "source_id": f"{company_id}-{link_index}", "source_url": link,
                "canonical_url": link, "company": company_name, "company_website": company.get("website"),
                "location": company.get("location"), "contract_type": row.get("contract_type") or None,
                "title": row.get("ad_status") or None, "verified_at": row.get("verified_at") or None,
                "status": "active" if (row.get("listing_found") or "").casefold().startswith("oui") else "à_vérifier",
                "sources": [{"url": link, "source": "legacy_tracker", "legacy_row": index}],
            }, source="legacy_tracker")
            opportunities.append(opportunity)
            linked_ids.append(opportunity.id)
        mapping.append({"legacy_row": index, "company_id": company_id, "opportunity_ids": linked_ids, "fields": sorted(row)})
    result = {"rows": len(rows), "companies": companies, "opportunities": [item.to_dict() for item in opportunities], "mapping": mapping, "dry_run": dry_run}
    if not dry_run:
        data_dir.mkdir(parents=True, exist_ok=True)
        write_json_atomic(data_dir / "companies.json", {"schema_version": 1, "companies": companies, "updated_at": utc_now()})
        save_opportunities(data_dir / "opportunities.json", opportunities)
        write_json_atomic(data_dir / "tracker-import-map.json", result)
    return result


@dataclass
class ApplicationTracker:
    path: Path

    def _rows(self) -> list[dict[str, Any]]:
        return read_csv_rows(self.path) if self.path.exists() else []

    def _save(self, rows: Iterable[Mapping[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_csv_atomic(self.path, rows, TRACKER_COLUMNS)

    def upsert(self, row: Mapping[str, Any]) -> dict[str, Any]:
        data = {key: "" if row.get(key) is None else str(row.get(key)) for key in TRACKER_COLUMNS}
        data["opportunity_id"] = data.get("opportunity_id") or stable_id(data.get("company"), data.get("role"), data.get("source_url"))
        data["status"] = data.get("status") or "repérée"
        if data["status"] not in STATUSES:
            raise ValueError(f"statut tracker invalide: {data['status']}")
        data["last_event_at"] = data.get("last_event_at") or utc_now()
        rows = self._rows()
        replaced = False
        for index, existing in enumerate(rows):
            if existing.get("opportunity_id") == data["opportunity_id"]:
                merged = {**existing, **{key: value for key, value in data.items() if value != ""}}
                rows[index] = merged
                data = merged
                replaced = True
                break
        if not replaced:
            rows.append(data)
        self._save(rows)
        return data

    def record_event(self, opportunity_id: str, status: str, *, channel: str | None = None, note: str | None = None, source: str | None = None, event_date: str | None = None) -> dict[str, Any]:
        if status not in STATUSES:
            raise ValueError(f"statut tracker invalide: {status}")
        rows = self._rows()
        for row in rows:
            if row.get("opportunity_id") == opportunity_id:
                row["status"] = status
                row["channel"] = channel or row.get("channel", "")
                row["note"] = note or row.get("note", "")
                row["source"] = source or row.get("source", "")
                row["last_event_at"] = event_date or utc_now()
                self._save(rows)
                return row
        raise KeyError(f"opportunité absente du tracker: {opportunity_id}")

    def followups_due(self, *, today_value: date | None = None, delay_days: int = 10, max_followups: int = 2) -> list[dict[str, Any]]:
        today_value = today_value or date.today()
        due: list[dict[str, Any]] = []
        for row in self._rows():
            if row.get("status") not in {"candidature_envoyée", "sans_réponse", "relance_due"}:
                continue
            try:
                anchor = datetime.fromisoformat((row.get("applied_at") or row.get("last_event_at") or "").replace("Z", "+00:00")).date()
            except ValueError:
                continue
            if int(row.get("followup_count") or 0) >= max_followups:
                continue
            if today_value >= anchor + timedelta(days=delay_days * (int(row.get("followup_count") or 0) + 1)):
                due.append(row)
        return due

    def draft_followup(self, row: Mapping[str, Any]) -> str:
        return (f"Objet : Suivi de ma candidature — {row.get('role') or 'poste'}\n\n"
                f"Bonjour,\n\nJe me permets de revenir vers vous au sujet de ma candidature pour le poste de {row.get('role') or 'poste'} chez {row.get('company') or 'votre entreprise'}. "
                "Je reste disponible pour préciser mon parcours et mes disponibilités.\n\nBien cordialement,\n[À compléter]")


def archive_application(application_dir: Path, *, posting: str, cv_path: Path | None = None, message: str | None = None, metadata: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Archive les versions exactes soumises avant de modifier le tracker."""
    application_dir.mkdir(parents=True, exist_ok=True)
    posting_path = application_dir / "posting.txt"
    write_text_atomic(posting_path, posting)
    files = {"posting": str(posting_path)}
    if cv_path and cv_path.exists():
        target = application_dir / cv_path.name
        shutil.copy2(cv_path, target)
        files["cv"] = str(target)
    if message is not None:
        message_path = application_dir / "message.txt"
        write_text_atomic(message_path, message)
        files["message"] = str(message_path)
    metadata_path = application_dir / "metadata.json"
    write_json_atomic(metadata_path, {"schema_version": 1, "archived_at": utc_now(), **dict(metadata or {}), "files": files})
    files["metadata"] = str(metadata_path)
    return files
