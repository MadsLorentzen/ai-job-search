from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ai_job_search_fr.applications import build_application, keyword_coverage
from ai_job_search_fr.connectors.france_travail import FranceTravailClient, load_fixture
from ai_job_search_fr.gaps import analyze_skill_gaps
from ai_job_search_fr.interview import prepare_interview_pack
from ai_job_search_fr.models import Opportunity, validate_candidate_profile
from ai_job_search_fr.opportunities import deduplicate, make_spontaneous_opportunity, parse_opportunity_text
from ai_job_search_fr.profile import build_profile_from_documents
from ai_job_search_fr.ranking import rank_opportunity
from ai_job_search_fr.storage import import_documents, read_xlsx_rows
from ai_job_search_fr.storage import load_yaml
from ai_job_search_fr.report import render_html_report
from ai_job_search_fr.tracker import ApplicationTracker, archive_application, export_tracker_xlsx, import_existing_tracker


def profile():
    return {
        "identity": {"name": "Ada Exemple", "contact": {"email": "ada@example.test"}},
        "education": [{"name": "Master Management", "status": "vérifiée", "provenance": ["cv.pdf"]}],
        "experiences": [{"title": "Projet automatisation", "description": "Python et analyse de données", "results": "Prototype livré", "status": "vérifiée", "provenance": ["cv.pdf"]}],
        "projects": [],
        "skills": [{"name": "Python", "status": "vérifiée", "provenance": ["cv.pdf"]}, {"name": "Gestion de projet", "status": "déclarée", "provenance": ["entretien"]}],
        "search": {"mode": "alternance", "target_titles": ["chef de projet digital"], "missions_wanted": ["projet digital"], "locations": ["Poitiers"], "accepted_contracts": ["apprentissage"], "alternance": {"alternance_type": "apprentissage", "school": "Master Management"}},
    }


def test_profile_requires_provenance_and_status():
    errors = validate_candidate_profile(profile())
    assert errors == []
    bad = {**profile(), "skills": [{"name": "X"}]}
    assert any("statut" in error for error in validate_candidate_profile(bad))


def test_text_import_and_dedup_keep_provenance():
    first = parse_opportunity_text("""Chef de projet digital\nEntreprise: Exemple\nLieu: Poitiers\nContrat: apprentissage\nCompétences: Python, gestion de projet""", source_url="https://example.test/job?id=1&utm_source=x")
    second = parse_opportunity_text("""Chef de projet digital\nEntreprise: Exemple\nLieu: Poitiers\nContrat: apprentissage\nCompétences: Python, gestion de projet""", source_url="https://example.test/job?id=1")
    unique, merges = deduplicate([first, second])
    assert len(unique) == 1
    assert len(merges) == 1
    assert len(unique[0].sources) >= 1


def test_ranking_exposes_dimensions_and_action():
    opportunity = Opportunity.from_mapping({"source": "fixture", "source_id": "1", "source_url": "https://example.test/job", "title": "Chef de projet digital en alternance", "company": "Exemple", "location": "Poitiers", "contract_type": "Contrat d'apprentissage", "job_search_mode": "alternance", "alternance_type": "apprentissage", "required_skills": ["Python", "Gestion de projet"], "description_raw": "Projet digital", "verified_at": datetime.now(timezone.utc).isoformat()})
    evaluation = rank_opportunity(opportunity, profile())
    assert set(evaluation.scores) == {"missions", "skills", "compatibility", "location", "trajectory", "information_quality"}
    assert evaluation.recommendation in {"candidater", "approfondir", "surveiller", "contacter", "ignorer"}
    assert evaluation.weights


def test_france_travail_fixture_normalizes():
    opportunities = load_fixture("fixtures/france_travail_offers.json")
    assert len(opportunities) == 1
    item = opportunities[0]
    assert item.source == "france_travail"
    assert item.source_id == "FT-FIXTURE-001"
    assert item.alternance_type == "apprentissage"
    assert item.source_url


def test_tracker_import_preserves_multiple_urls(tmp_path: Path):
    source = tmp_path / "legacy.csv"
    source.write_text("Priorité;Ville / zone;Entreprise;Type;Site web;Annonces/liens;Sources\n1;Poitiers;Exemple;alternance;https://example.test;https://example.test/a https://example.test/b;https://example.test/source\n", encoding="utf-8")
    result = import_existing_tracker(source, tmp_path / "data")
    assert len(result["companies"]) == 1
    assert len(result["opportunities"]) == 2
    assert (tmp_path / "data" / "tracker-import-map.json").exists()


def test_document_import_is_idempotent(tmp_path: Path):
    source = tmp_path / "cv.txt"
    source.write_text("Expérience vérifiée", encoding="utf-8")
    first = import_documents([source], tmp_path / "documents")
    second = import_documents([source], tmp_path / "documents")
    assert len(first["added"]) == 1
    assert len(second["ignored"]) == 1


def test_application_does_not_use_unconfirmed_items(tmp_path: Path):
    opportunity = Opportunity.from_mapping({"title": "Chef de projet", "company": "Exemple", "description_raw": "Python", "required_skills": ["Python"]})
    local_profile = {**profile(), "projects": [{"name": "Projet secret", "description": "non confirmé", "status": "à_confirmer", "provenance": ["note"]}]}
    result = build_application(local_profile, opportunity, tmp_path / "application")
    assert result["cv_text"]
    assert "Projet secret" not in Path(result["cv_text"]).read_text(encoding="utf-8")
    assert (tmp_path / "application" / "review.json").exists()


def test_tracker_followup_is_draft_only(tmp_path: Path):
    tracker = ApplicationTracker(tmp_path / "tracker.csv")
    row = tracker.upsert({"company": "Exemple", "role": "Projet", "status": "candidature_envoyée", "applied_at": (datetime.now(timezone.utc) - timedelta(days=11)).date().isoformat()})
    due = tracker.followups_due()
    assert due
    assert "Objet" in tracker.draft_followup(due[0])


def test_profile_extraction_marks_facts_to_confirm(tmp_path: Path):
    source = tmp_path / "cv.md"
    source.write_text("Ada Exemple\nada@example.test\n## Compétences\nPython; Gestion de projet\n## Expériences\nProjet IA — prototype livré", encoding="utf-8")
    built, report = build_profile_from_documents([source])
    assert built["skills"][0]["status"] == "à_confirmer"
    assert built["skills"][0]["provenance"]
    assert report["facts_to_confirm"] >= 1


def test_spontaneous_opportunity_has_no_fake_posting():
    opportunity = make_spontaneous_opportunity({"company": "Exemple", "mission_hypothesis": "Automatiser le reporting", "source_url": "https://example.test/about"})
    assert opportunity.spontaneous is True
    assert opportunity.source_url == "https://example.test/about"
    assert opportunity.status == "à_vérifier"


def test_archive_contains_exact_materials(tmp_path: Path):
    posting = tmp_path / "posting.txt"
    cv = tmp_path / "cv.pdf"
    message = tmp_path / "message.txt"
    posting.write_text("offre archivée", encoding="utf-8")
    cv.write_bytes(b"pdf placeholder")
    message.write_text("message soumis", encoding="utf-8")
    files = archive_application(tmp_path / "archive", posting=posting.read_text(encoding="utf-8"), cv_path=cv, message=message.read_text(encoding="utf-8"), metadata={"opportunity_id": "x"})
    assert Path(files["posting"]).read_text(encoding="utf-8") == "offre archivée"
    assert Path(files["cv"]).read_bytes() == b"pdf placeholder"
    assert json.loads(Path(files["metadata"]).read_text(encoding="utf-8"))["opportunity_id"] == "x"


def test_anonymized_yaml_example_is_readable_without_optional_dependencies():
    loaded = load_yaml(Path("examples/candidate-profile.yaml"))
    assert loaded["identity"]["name"] == "Alex Exemple"
    assert loaded["search"]["alternance"]["level"] == "Master"


def test_interview_pack_uses_sources_and_honest_gaps():
    opportunity = Opportunity.from_mapping({"title": "Chef de projet", "company": "Exemple", "source_url": "https://example.test/job", "description_raw": "Python", "required_skills": ["Python"], "job_search_mode": "alternance"})
    pack = prepare_interview_pack(profile(), opportunity)
    assert "Sources" in pack
    assert "Réponses honnêtes" in pack
    assert "Points administratifs" in pack


def test_gap_analysis_distinguishes_recurrence():
    opportunities = [Opportunity.from_mapping({"id": "a", "required_skills": ["Rust"]}), Opportunity.from_mapping({"id": "b", "required_skills": ["Rust", "Go"]})]
    result = analyze_skill_gaps(opportunities, profile())
    rows = {row["skill"]: row for row in result["gaps"]}
    assert rows["rust"]["signal"] == "récurrent"
    assert rows["go"]["signal"] == "signal_faible"


def test_html_report_is_offline_and_filterable(tmp_path: Path):
    tracker = tmp_path / "tracker.csv"
    tracker.write_text("company,role,location,status,next_action_at,source_url\nExemple,Projet,Poitiers,repérée,,https://example.test\n", encoding="utf-8")
    output = tmp_path / "report.html"
    html = render_html_report(tracker, None, output)
    assert "Filtrer" in html
    assert "https://example.test" in html


def test_tracker_xlsx_export_roundtrip(tmp_path: Path):
    tracker = tmp_path / "tracker.csv"
    tracker.write_text("company,role,status\nExemple,Projet,repérée\n", encoding="utf-8")
    output = tmp_path / "tracker.xlsx"
    export_tracker_xlsx(tracker, output)
    rows = read_xlsx_rows(output)
    assert rows[0]["company"] == "Exemple"
