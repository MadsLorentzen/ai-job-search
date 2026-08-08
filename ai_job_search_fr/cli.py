"""CLI portable pour Codex, Claude Code et un terminal classique."""

from __future__ import annotations

import argparse
from pathlib import Path
import json
import sys

from .applications import build_application
from .connectors.france_travail import FranceTravailClient, FranceTravailConfig, load_fixture
from .gaps import analyze_skill_gaps
from .interview import write_interview_pack
from .models import validate_candidate_profile
from .opportunities import deduplicate, fetch_opportunity_url, import_opportunity_file, load_opportunities, make_spontaneous_opportunity, parse_opportunity_text, refresh_freshness, save_opportunities
from .profile import write_profile_from_documents
from .ranking import DEFAULT_WEIGHTS, rank_batch
from .report import render_html_report
from .storage import import_documents, load_yaml, read_json, write_json_atomic, write_yaml_atomic
from .tracker import ApplicationTracker, archive_application, export_tracker_xlsx, import_existing_tracker


PROFILE_TEMPLATE = {
    "schema_version": 1,
    "identity": {"name": None, "contact": {"email": None, "phone": None, "location": None}, "status": "à_confirmer", "provenance": []},
    "education": [], "experiences": [], "projects": [], "skills": [], "languages": [],
    "links": {"portfolio": None, "github": None, "linkedin": None},
    "search": {"mode": "premier_emploi", "target_titles": [], "target_families": [], "sectors": [], "company_types": [], "accepted_experience_levels": [], "accepted_contracts": [], "refused_contracts": [], "available_from": None, "locations": [], "mobility": None, "remote_preference": None, "max_commute_minutes": None, "missions_wanted": [], "missions_refused": [], "elimination_criteria": [], "preferences": [], "alternance": None, "first_job": {"transferable_skills_allowed": True}},
    "writing_style": {"tone": "clair, professionnel et concret", "examples_star": []},
    "generation_policy": {"allowed_statuses": ["vérifiée", "déclarée"], "forbidden_statuses": ["interdite", "à_confirmer"], "language": "français", "template_path": "templates/cv/francais_one_page.tex"},
}
SEARCH_TEMPLATE = {"mode": "premier_emploi", "target_titles": [], "target_families": [], "sectors": [], "company_types": [], "accepted_experience_levels": [], "accepted_contracts": [], "refused_contracts": [], "available_from": None, "locations": [], "mobility": None, "remote_preference": None, "max_commute_minutes": None, "missions_wanted": [], "missions_refused": [], "elimination_criteria": [], "preferences": [], "alternance": None, "first_job": {"transferable_skills_allowed": True}}


def _path(value: str) -> Path:
    return Path(value).expanduser()


def cmd_init(args: argparse.Namespace) -> int:
    root = _path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    profile_path = root / "candidate-profile.yaml"
    search_path = root / "search-profile.yaml"
    if args.force or not profile_path.exists():
        write_yaml_atomic(profile_path, PROFILE_TEMPLATE)
    if args.force or not search_path.exists():
        write_yaml_atomic(search_path, SEARCH_TEMPLATE)
    scoring_path = root / "scoring.json"
    if args.force or not scoring_path.exists():
        write_json_atomic(scoring_path, {"schema_version": 1, "weights": DEFAULT_WEIGHTS})
    for folder in ("data/opportunities", "data/companies", "data/applications", "documents"):
        (root / folder).mkdir(parents=True, exist_ok=True)
    print(json.dumps({"profile": str(profile_path), "search": str(search_path), "root": str(root)}, ensure_ascii=False, indent=2))
    return 0


def cmd_validate_profile(args: argparse.Namespace) -> int:
    profile = load_yaml(_path(args.profile))
    errors = validate_candidate_profile(profile)
    print(json.dumps({"valid": not errors, "errors": errors}, ensure_ascii=False, indent=2))
    return 0 if not errors else 2


def cmd_import_documents(args: argparse.Namespace) -> int:
    result = import_documents((_path(item) for item in args.files), _path(args.destination))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_build_profile(args: argparse.Namespace) -> int:
    result = write_profile_from_documents([_path(item) for item in args.files], _path(args.output))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_import_opportunity(args: argparse.Namespace) -> int:
    if args.text is not None:
        opportunities = [parse_opportunity_text(args.text, source_url=args.url, source="manual")]
    elif args.input and args.input.lower().startswith(("http://", "https://")):
        opportunities = [fetch_opportunity_url(args.input)]
    elif args.input:
        opportunities = import_opportunity_file(_path(args.input))
    else:
        raise SystemExit("fournissez --text ou --input")
    output = _path(args.output)
    save_opportunities(output, opportunities)
    print(json.dumps({"count": len(opportunities), "output": str(output), "opportunities": [item.to_dict() for item in opportunities]}, ensure_ascii=False, indent=2))
    return 0


def cmd_create_spontaneous(args: argparse.Namespace) -> int:
    opportunity = make_spontaneous_opportunity({"company": args.company, "company_website": args.website, "location": args.location, "mission_hypothesis": args.mission, "contact": {"email": args.email} if args.email else None, "source_url": args.source_url})
    save_opportunities(_path(args.output), [opportunity])
    print(json.dumps(opportunity.to_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_deduplicate(args: argparse.Namespace) -> int:
    opportunities = load_opportunities(_path(args.input))
    unique, merges = deduplicate(opportunities, threshold=args.threshold)
    unique = refresh_freshness(unique, max_age_days=args.max_age_days)
    save_opportunities(_path(args.output), unique, merges)
    print(json.dumps({"input": len(opportunities), "output": len(unique), "merged": len(merges), "merges": merges}, ensure_ascii=False, indent=2))
    return 0


def cmd_rank(args: argparse.Namespace) -> int:
    opportunities = load_opportunities(_path(args.opportunities))
    profile = load_yaml(_path(args.profile))
    weights = None
    if args.scoring and _path(args.scoring).exists():
        weights = read_json(_path(args.scoring)).get("weights")
    evaluations = rank_batch(opportunities, profile, weights=weights)
    payload = {"schema_version": 1, "weights": weights or DEFAULT_WEIGHTS, "evaluations": [item.to_dict() for item in evaluations]}
    write_json_atomic(_path(args.output), payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_france_travail(args: argparse.Namespace) -> int:
    if args.fixture:
        opportunities = load_fixture(args.fixture)
    else:
        client = FranceTravailClient(FranceTravailConfig.from_env())
        opportunities = client.search(keywords=args.keywords, location=args.location, distance_km=args.distance, contract_type=args.contract, page=args.page, max_pages=args.pages)
    output = _path(args.output)
    save_opportunities(output, opportunities)
    print(json.dumps({"count": len(opportunities), "output": str(output), "opportunities": [item.to_dict() for item in opportunities]}, ensure_ascii=False, indent=2))
    return 0


def cmd_import_tracker(args: argparse.Namespace) -> int:
    result = import_existing_tracker(_path(args.input), _path(args.destination), dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_export_tracker(args: argparse.Namespace) -> int:
    export_tracker_xlsx(_path(args.input), _path(args.output))
    print(json.dumps({"input": args.input, "output": args.output}, ensure_ascii=False, indent=2))
    return 0


def cmd_application(args: argparse.Namespace) -> int:
    profile = load_yaml(_path(args.profile))
    opportunities = load_opportunities(_path(args.opportunities))
    opportunity = next((item for item in opportunities if item.id == args.opportunity_id), None)
    if opportunity is None:
        raise SystemExit(f"opportunité absente: {args.opportunity_id}")
    result = build_application(profile, opportunity, _path(args.output), channel=args.channel, compile_pdf=args.compile_pdf)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["review"]["pass"] else 3


def cmd_archive_application(args: argparse.Namespace) -> int:
    posting_path = _path(args.posting)
    message = _path(args.message).read_text(encoding="utf-8") if args.message else None
    metadata = {"opportunity_id": args.opportunity_id, "company": args.company, "role": args.role, "source_url": args.source_url}
    files = archive_application(_path(args.output), posting=posting_path.read_text(encoding="utf-8"), cv_path=_path(args.cv) if args.cv else None, message=message, metadata=metadata)
    print(json.dumps(files, ensure_ascii=False, indent=2))
    return 0


def cmd_followups(args: argparse.Namespace) -> int:
    tracker = ApplicationTracker(_path(args.tracker))
    rows = tracker.followups_due(delay_days=args.delay, max_followups=args.max_followups)
    payload = [{**row, "draft": tracker.draft_followup(row)} for row in rows]
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_interview(args: argparse.Namespace) -> int:
    profile = load_yaml(_path(args.profile))
    opportunity = next((item for item in load_opportunities(_path(args.opportunities)) if item.id == args.opportunity_id), None)
    if opportunity is None:
        raise SystemExit(f"opportunité absente: {args.opportunity_id}")
    pack = write_interview_pack(profile, opportunity, _path(args.output), submitted_cv=args.cv, submitted_message=args.message)
    print(json.dumps({"output": args.output, "characters": len(pack)}, ensure_ascii=False, indent=2))
    return 0


def cmd_gaps(args: argparse.Namespace) -> int:
    profile = load_yaml(_path(args.profile))
    opportunities = load_opportunities(_path(args.opportunities))
    result = analyze_skill_gaps(opportunities, profile)
    write_json_atomic(_path(args.output), result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    html = render_html_report(_path(args.tracker), _path(args.opportunities) if args.opportunities else None, _path(args.output))
    print(json.dumps({"output": args.output, "characters": len(html)}, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ai-job-search-fr", description="Copilote local-first de recherche d'emploi en France")
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="créer les fichiers canoniques")
    init.add_argument("--root", default=".")
    init.add_argument("--force", action="store_true")
    init.set_defaults(func=cmd_init)
    validate = sub.add_parser("validate-profile", help="valider candidate-profile.yaml")
    validate.add_argument("--profile", default="candidate-profile.yaml")
    validate.set_defaults(func=cmd_validate_profile)
    docs = sub.add_parser("import-documents", help="conserver les documents sources")
    docs.add_argument("files", nargs="+")
    docs.add_argument("--destination", default="documents/imported")
    docs.set_defaults(func=cmd_import_documents)
    build_profile = sub.add_parser("build-profile", help="extraire un profil maître prudent depuis des documents")
    build_profile.add_argument("files", nargs="+")
    build_profile.add_argument("--output", default="candidate-profile.yaml")
    build_profile.set_defaults(func=cmd_build_profile)
    imp = sub.add_parser("import-opportunity", help="importer une offre texte/URL/fichier")
    imp.add_argument("--input")
    imp.add_argument("--text")
    imp.add_argument("--url")
    imp.add_argument("--output", default="data/opportunities/import.json")
    imp.set_defaults(func=cmd_import_opportunity)
    spontaneous = sub.add_parser("create-spontaneous", help="suivre une entreprise sans annonce")
    spontaneous.add_argument("--company", required=True)
    spontaneous.add_argument("--website")
    spontaneous.add_argument("--location")
    spontaneous.add_argument("--mission", required=True, help="hypothèse de mission à vérifier")
    spontaneous.add_argument("--email")
    spontaneous.add_argument("--source-url")
    spontaneous.add_argument("--output", default="data/opportunities/spontaneous.json")
    spontaneous.set_defaults(func=cmd_create_spontaneous)
    dedup = sub.add_parser("deduplicate", help="fusionner les doublons et actualiser la fraîcheur")
    dedup.add_argument("--input", default="data/opportunities/import.json")
    dedup.add_argument("--output", default="data/opportunities/deduplicated.json")
    dedup.add_argument("--threshold", type=float, default=.84)
    dedup.add_argument("--max-age-days", type=int, default=30)
    dedup.set_defaults(func=cmd_deduplicate)
    rank = sub.add_parser("rank", help="classer avec scores et justification")
    rank.add_argument("--profile", default="candidate-profile.yaml")
    rank.add_argument("--opportunities", default="data/opportunities/deduplicated.json")
    rank.add_argument("--scoring", default="scoring.json")
    rank.add_argument("--output", default="data/opportunities/rankings.json")
    rank.set_defaults(func=cmd_rank)
    ft = sub.add_parser("search-france-travail", help="rechercher via l'API France Travail ou une fixture")
    ft.add_argument("--keywords", default="")
    ft.add_argument("--location")
    ft.add_argument("--distance", type=int)
    ft.add_argument("--contract")
    ft.add_argument("--page", type=int, default=0)
    ft.add_argument("--pages", type=int, default=1)
    ft.add_argument("--fixture")
    ft.add_argument("--output", default="data/opportunities/france-travail.json")
    ft.set_defaults(func=cmd_france_travail)
    tr = sub.add_parser("import-tracker", help="importer le tableur existant")
    tr.add_argument("input")
    tr.add_argument("--destination", default="data")
    tr.add_argument("--dry-run", action="store_true")
    tr.set_defaults(func=cmd_import_tracker)
    export_tracker = sub.add_parser("export-tracker", help="exporter le tracker CSV en XLSX")
    export_tracker.add_argument("--input", default="job_search_tracker.csv")
    export_tracker.add_argument("--output", default="job_search_tracker.xlsx")
    export_tracker.set_defaults(func=cmd_export_tracker)
    app = sub.add_parser("build-application", help="produire CV/message et revue")
    app.add_argument("--profile", default="candidate-profile.yaml")
    app.add_argument("--opportunities", default="data/opportunities/deduplicated.json")
    app.add_argument("--opportunity-id", required=True)
    app.add_argument("--output", default="data/applications/draft")
    app.add_argument("--channel", default="lettre", choices=["lettre", "courriel", "message", "spontanée"])
    app.add_argument("--compile-pdf", action="store_true")
    app.set_defaults(func=cmd_application)
    archive = sub.add_parser("archive-application", help="archiver les versions exactes après validation humaine")
    archive.add_argument("--posting", required=True)
    archive.add_argument("--cv")
    archive.add_argument("--message")
    archive.add_argument("--output", required=True)
    archive.add_argument("--opportunity-id")
    archive.add_argument("--company")
    archive.add_argument("--role")
    archive.add_argument("--source-url")
    archive.set_defaults(func=cmd_archive_application)
    follow = sub.add_parser("followups", help="lister les relances dues et leurs brouillons")
    follow.add_argument("--tracker", default="job_search_tracker.csv")
    follow.add_argument("--delay", type=int, default=10)
    follow.add_argument("--max-followups", type=int, default=2)
    follow.set_defaults(func=cmd_followups)
    interview = sub.add_parser("prepare-interview", help="générer un pack d'entretien depuis l'offre archivée")
    interview.add_argument("--profile", default="candidate-profile.yaml")
    interview.add_argument("--opportunities", default="data/opportunities/deduplicated.json")
    interview.add_argument("--opportunity-id", required=True)
    interview.add_argument("--cv")
    interview.add_argument("--message")
    interview.add_argument("--output", default="data/applications/interview.md")
    interview.set_defaults(func=cmd_interview)
    gaps = sub.add_parser("analyze-gaps", help="agréger les compétences manquantes récurrentes")
    gaps.add_argument("--profile", default="candidate-profile.yaml")
    gaps.add_argument("--opportunities", default="data/opportunities/deduplicated.json")
    gaps.add_argument("--output", default="data/opportunities/skill-gaps.json")
    gaps.set_defaults(func=cmd_gaps)
    report = sub.add_parser("html-report", help="produire un rapport HTML hors ligne")
    report.add_argument("--tracker", default="job_search_tracker.csv")
    report.add_argument("--opportunities")
    report.add_argument("--output", default="reports/job-search.html")
    report.set_defaults(func=cmd_report)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except (ValueError, RuntimeError, OSError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
