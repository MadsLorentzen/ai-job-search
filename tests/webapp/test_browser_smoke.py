"""Real Chromium + Uvicorn browser journeys for the Ticket 9 product UI."""
from __future__ import annotations

import json
import socket
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
import uvicorn

from product.application_intelligence_providers import ProviderResponse as AIResponse
from product.job_understanding_providers import ProviderResponse as UnderstandingResponse
from webapp.app import create_app
from webapp.config import Settings

from tests.webapp.fixtures.acceptance.fixtures import extension


POSTING_TEXT = (
    "Python is required.\n"
    "Cloud certification is required.\n"
    "Build reliable data pipelines.\n"
    "Applicants must already have the right to work in the UK.\n"
    "German would be an advantage.\n"
    "Hybrid role: two days per week in London.\n"
)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _write_profile_root(root: Path) -> None:
    candidate = root / ".claude/skills/job-application-assistant"
    candidate.mkdir(parents=True)
    (root / "cv").mkdir(parents=True)
    (root / "CLAUDE.md").write_text(
        """# Job Application Assistant for Ada Lovelace

## Candidate Profile

### Identity
- **Name:** Ada Lovelace
- **Location:** London hybrid
- **Languages:**

| Language | Level |
|----------|-------|
| German | Professional |

- **Status:** Employed

### Professional Experience
- **Data Engineer** (2020-01 - Present) - **Evidence Works** (London)

### Technical Skills
- **Primary:** Python
""",
        encoding="utf-8",
    )
    (candidate / "01-candidate-profile.md").write_text(
        """# Candidate Profile

## Identity
- **Name:** Ada Lovelace
- **Location:** London hybrid
- **Status:** Employed
- **Constraints:** Right to work in the UK

### Languages

| Language | Level | Notes |
|----------|-------|-------|
| German | Professional | professional use |

## Professional Experience

### Data Engineer - Evidence Works (2020-01 - Present)
London
- Built production data pipelines

## Technical Skills

### Programming & ML
- Python

## Publications
1. Ada Lovelace (2026). Notes on the Analytical Engine.
""",
        encoding="utf-8",
    )
    (root / "cv/main_example.tex").write_text(
        "\\documentclass{moderncv}\\name{Ada}{Lovelace}\\begin{document}\\end{document}\n",
        encoding="utf-8",
    )


class _UnderstandingProvider:
    provider_id = "browser-fake"
    model_id = "browser-fixture"
    model_version = "v0"

    def extract(self, request):
        quotes = (
            ("python", "requirements", "required", "Python is required."),
            ("cloud", "requirements", "required", "Cloud certification is required."),
            ("pipelines", "responsibilities", "required", "Build reliable data pipelines."),
            ("rights", "eligibility_requirements", "required", "Applicants must already have the right to work in the UK."),
            ("german", "language_requirements", "preferred", "German would be an advantage."),
            ("hybrid", "logistics_requirements", "required", "Hybrid role: two days per week in London."),
        )
        return UnderstandingResponse(payload={
            "schema_version": "job-understanding-candidate.v0",
            "items": [
                {
                    "proposal_id": f"browser-{name}", "category": category,
                    "kind": kind, "quote": quote, "certainty": "explicit",
                }
                for name, category, kind, quote in quotes
            ],
            "suggestions": [], "ambiguous_statements": [], "warnings": [],
        })


def _claim_id(claims: list[dict], needle: str) -> str:
    return next(
        claim["id"] for claim in claims
        if needle.casefold() in str(claim.get("value", "")).casefold()
    )


def _job_id(evidence: list[dict], exact_text: str) -> str:
    return next(item["id"] for item in evidence if item["text"] == exact_text)


class _SemanticAdapter:
    """Dynamic fake: references the real IDs produced by Profile/Ticket 6."""

    def propose(self, *, profile_evidence, resolved_job_evidence, active_extensions):
        evidence = resolved_job_evidence["evidence"]
        python_claim = _claim_id(profile_evidence, "Python")
        pipeline_claim = _claim_id(profile_evidence, "Built production data pipelines")
        rights_claim = _claim_id(profile_evidence, "Right to work")
        german_claim = _claim_id(profile_evidence, "German")
        location_claim = _claim_id(profile_evidence, "London hybrid")
        return {
            "matches": [
                {
                    "proposal_id": "browser-direct",
                    "job_evidence_id": _job_id(evidence, "Python is required."),
                    "profile_evidence_ids": [python_claim],
                    "classification": "direct",
                    "rationale": "Explicit Python evidence on both sides.",
                    "confidence": "high",
                },
                {
                    "proposal_id": "browser-functional",
                    "job_evidence_id": _job_id(evidence, "Build reliable data pipelines."),
                    "profile_evidence_ids": [pipeline_claim],
                    "classification": "functionally_equivalent",
                    "rationale": "The responsibilities align by function.",
                    "confidence": "high",
                    "functional_basis": {
                        "responsibility_alignment": [
                            "Build reliable data pipelines",
                            "Built production data pipelines",
                        ],
                        "competency_alignment": [],
                        "title_similarity_only": False,
                    },
                },
                {
                    "proposal_id": "browser-transfer",
                    "job_evidence_id": _job_id(evidence, "German would be an advantage."),
                    "profile_evidence_ids": [pipeline_claim],
                    "classification": "transferable",
                    "rationale": "A bounded active mapping was proposed.",
                    "confidence": "medium",
                    "extension_ref": {
                        "extension_id": "data-transfer",
                        "extension_version": "0.1.0",
                        "record_type": "transferable_mapping",
                        "record_id": "field-models-to-pipelines",
                    },
                },
            ],
            "gates": [
                {
                    "gate_id": "eligibility", "status": "PASS",
                    "reason": "Affirmative candidate and job evidence.",
                    "job_evidence_ids": [_job_id(evidence, "Applicants must already have the right to work in the UK.")],
                    "profile_evidence_ids": [rights_claim],
                },
                {
                    "gate_id": "language", "status": "PASS",
                    "reason": "Affirmative candidate and job evidence.",
                    "job_evidence_ids": [_job_id(evidence, "German would be an advantage.")],
                    "profile_evidence_ids": [german_claim],
                },
                {
                    "gate_id": "location_logistics", "status": "PASS",
                    "reason": "Affirmative candidate and job evidence.",
                    "job_evidence_ids": [_job_id(evidence, "Hybrid role: two days per week in London.")],
                    "profile_evidence_ids": [location_claim],
                },
            ],
        }


class _ApplicationIntelligenceProvider:
    provider_id = "browser-fake"
    model_id = "browser-fixture"
    model_version = "v0"

    def propose(self, request):
        python_claim = _claim_id(request["profile_snapshot"]["claims"], "Python")
        valid_atom = {
            "atom_id": "browser-valid", "atom_kind": "candidate_fact",
            "assertion_type": "technical_skill",
            "profile_evidence_ids": [python_claim], "rendering_variant": "PLAIN",
        }
        unknown_atom = {
            "atom_id": "browser-unsupported", "atom_kind": "candidate_fact",
            "assertion_type": "certification",
            "profile_evidence_ids": ["clm_9999999999999999"],
            "rendering_variant": "PLAIN",
        }
        return AIResponse(payload={"content_units": [
            {
                "unit_id": "cv-ready", "unit_type": "cv_bullet",
                "atoms": [valid_atom], "connectives": [],
            },
            {
                "unit_id": "cv-needs-review", "unit_type": "cv_bullet",
                "atoms": [valid_atom, unknown_atom], "connectives": [],
            },
            {
                "unit_id": "cv-unsupported-only", "unit_type": "cv_bullet",
                "atoms": [unknown_atom], "connectives": [],
            },
        ]})


@pytest.fixture
def live_server(tmp_path, monkeypatch):
    profile_root = tmp_path / "profile"
    _write_profile_root(profile_root)
    extensions_dir = tmp_path / "private-extension-registry"
    extension_dir = extensions_dir / "data-transfer"
    extension_dir.mkdir(parents=True)
    (extension_dir / "extension.json").write_text(
        json.dumps(extension(conditional=True)), encoding="utf-8"
    )
    browser_secret = "sk-browser-must-never-render"
    monkeypatch.setenv("OPENAI_API_KEY", browser_secret)
    port = _free_port()
    settings = Settings(
        db_path=tmp_path / "browser.sqlite3", host="127.0.0.1", port=port,
        profile_root=str(profile_root), extensions_dir=extensions_dir,
        documents_root=tmp_path / "documents",
    )
    app = create_app(settings)
    app.state.job_understanding_provider = _UnderstandingProvider()
    app.state.semantic_adapter = _SemanticAdapter()
    app.state.application_intelligence_provider = _ApplicationIntelligenceProvider()
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="warning", access_log=False,
    ))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                break
        except OSError:
            time.sleep(0.05)
    else:
        server.should_exit = True
        thread.join(timeout=5)
        raise RuntimeError("Uvicorn browser fixture did not start on 127.0.0.1")
    yield SimpleNamespace(
        base_url=f"http://127.0.0.1:{port}", profile_root=profile_root,
        extensions_dir=extensions_dir, secret=browser_secret,
    )
    server.should_exit = True
    thread.join(timeout=10)
    assert not thread.is_alive(), "Uvicorn browser fixture did not stop cleanly"


def _click_reload(page, locator) -> None:
    with page.expect_navigation(wait_until="networkidle"):
        locator.click()


def _refresh_profile(page, live_server) -> None:
    page.goto(f"{live_server.base_url}/profile", wait_until="networkidle")
    _click_reload(page, page.get_by_role("button", name="Refresh snapshot"))
    assert page.get_by_text("Verified evidence").first.is_visible()


def _create_job(page, live_server, company="Browser Evidence Co") -> str:
    page.goto(f"{live_server.base_url}/new-job", wait_until="networkidle")
    paste_panel = page.locator('[data-mode-panel="paste"]')
    manual_panel = page.locator('[data-mode-panel="manual"]')
    import_panel = page.locator('[data-mode-panel="import"]')
    assert paste_panel.is_visible()
    assert not manual_panel.is_visible()
    assert not import_panel.is_visible()
    page.locator('input[name="mode"][value="manual"]').check()
    assert not paste_panel.is_visible()
    assert manual_panel.is_visible()
    assert not import_panel.is_visible()
    page.locator('input[name="mode"][value="import"]').check()
    assert not paste_panel.is_visible()
    assert not manual_panel.is_visible()
    assert import_panel.is_visible()
    page.locator('input[name="mode"][value="paste"]').check()
    page.locator('input[name="company"]').fill(company)
    page.locator('input[name="title"]').fill("Evidence Data Engineer")
    page.locator('textarea[name="posting_text"]').fill(POSTING_TEXT)
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Create workspace").click()
    return page.url


def _run_to_intelligence(page, live_server) -> str:
    workspace_url = _create_job(page, live_server)
    _click_reload(page, page.get_by_role("button", name="Run Understanding"))
    assert page.get_by_text("Accepted job evidence", exact=True).count() == 6
    page.locator('input[name="extension_ids"][value="data-transfer"]').check()
    _click_reload(page, page.get_by_role("button", name="Run Job Fit"))
    assert page.get_by_text("Verified evidence", exact=True).is_visible()
    assert page.get_by_text("Accepted inference — functionally equivalent", exact=True).is_visible()
    assert page.get_by_text("Transferable evidence", exact=True).is_visible()
    assert page.get_by_text("Missing evidence", exact=True).is_visible()
    assert page.get_by_text("Functional basis:").is_visible()
    assert page.get_by_text("Candidate evidence exists").is_visible()
    assert page.get_by_text("Does not prove employment history").is_visible()
    assert page.get_by_text("NEEDS_REVIEW", exact=True).first.is_visible()
    _click_reload(page, page.get_by_role("button", name="Run Application Intelligence"))
    return workspace_url


def _assert_no_private_browser_content(page, live_server) -> None:
    html = page.content()
    visible = page.locator("body").inner_text()
    combined = html + visible
    assert live_server.secret not in combined
    assert "OPENAI_API_KEY" not in combined
    assert str(live_server.extensions_dir) not in combined
    assert "extension.json" not in combined


def test_full_visible_journey_reaches_interview_with_explicit_submission(page, live_server):
    page.goto(live_server.base_url, wait_until="networkidle")
    assert page.get_by_role("heading", name="Your job pipeline").is_visible()
    assert page.get_by_text("No active applications").is_visible()
    _refresh_profile(page, live_server)
    workspace_url = _run_to_intelligence(page, live_server)

    assert page.locator('[data-item-id="cv-ready"]').count() == 2
    assert page.locator('[data-item-id="cv-needs-review"]').count() == 2
    unsupported = page.locator(".unsupported-record").first
    assert unsupported.is_visible()
    assert unsupported.get_by_text("Unsupported — excluded from application material").is_visible()
    assert unsupported.locator("button").count() == 0
    assert page.locator('[data-item-id="cv-unsupported-only"]').count() == 0
    assert page.get_by_role(
        "button", name="Acknowledge — include in reviewed pack"
    ).first.is_visible()
    assert page.get_by_role(
        "button", name="Omit — exclude from application material"
    ).first.is_visible()
    assert page.locator("button.confirm-pack").is_disabled()
    assert page.locator('[data-status="drafted"]').count() == 0
    assert "applied" not in page.locator(".workspace-header").inner_text().casefold()
    _assert_no_private_browser_content(page, live_server)

    for _ in range(30):
        acknowledge = page.locator(
            'article.review-item:not(:has(.decision)) '
            'button.review-action[data-disposition="acknowledged_and_proceed"]'
        ).first
        if acknowledge.count() == 0:
            break
        _click_reload(page, acknowledge)
    else:
        raise AssertionError("review queue did not converge")
    assert page.get_by_text("0 outstanding", exact=True).is_visible()
    assert page.locator("button.confirm-pack").is_enabled()

    page.once("dialog", lambda dialog: dialog.accept())
    _click_reload(page, page.get_by_role("button", name="Create reviewed pack — does not submit"))
    assert page.get_by_text("Workflow status:").locator("strong").inner_text() == "drafted"
    assert page.get_by_text("Generating or reviewing material never means it was submitted.").is_visible()
    assert page.get_by_role("heading", name="Reviewed application output").is_visible()
    assert page.get_by_role("heading", name="CV content").is_visible()
    assert page.get_by_role("heading", name="Cover letter content").is_visible()
    assert page.locator('[data-copy-section="cv"]').is_visible()
    assert page.get_by_text("No reviewed cover-letter content.").is_visible()
    assert page.locator('[data-copy-section="cover-letter"]').count() == 0

    page.once("dialog", lambda dialog: dialog.accept())
    _click_reload(page, page.get_by_role("button", name="Mark applied — I submitted externally"))
    assert page.get_by_text("Workflow status:").locator("strong").inner_text() == "applied"
    _click_reload(page, page.get_by_role("button", name="Interview"))
    assert page.get_by_text("Workflow status:").locator("strong").inner_text() == "interview"

    page.goto(f"{live_server.base_url}/?filter=all", wait_until="networkidle")
    assert "active" in page.get_by_role("link", name="All").get_attribute("class")
    assert page.get_by_text("Browser Evidence Co").is_visible()
    assert page.get_by_text("Evidence Data Engineer").is_visible()
    assert page.get_by_text("interview", exact=True).is_visible()
    assert page.locator("th", has_text="Product stage").count() == 1
    assert page.locator("th", has_text="Application status").count() == 1
    assert page.locator("th", has_text="Next action").count() == 1
    page.get_by_role("link", name="Browser Evidence Co Evidence Data Engineer").click()
    assert page.url == workspace_url
    assert workspace_url.startswith(live_server.base_url + "/workspaces/")
    _assert_no_private_browser_content(page, live_server)


def test_stale_and_review_negative_paths_are_enforced_in_rendered_ui(page, live_server):
    _refresh_profile(page, live_server)
    workspace_url = _run_to_intelligence(page, live_server)
    assert page.locator("button.confirm-pack").is_disabled()
    assert page.locator('[data-item-id="cv-needs-review"]').count() == 2
    assert page.locator('[data-status="drafted"]').count() == 0
    assert "applied" not in page.locator(".workspace-header").inner_text().casefold()

    for _ in range(30):
        omit = page.locator(
            'article.review-item:not(:has(.decision)) '
            'button.review-action[data-disposition="omit_from_positioning"]'
        ).first
        if omit.count() == 0:
            break
        _click_reload(page, omit)
    else:
        raise AssertionError("omission review queue did not converge")
    assert page.get_by_text("0 outstanding", exact=True).is_visible()
    assert page.get_by_text("INCOMPLETE", exact=True).is_visible()
    assert page.locator("button.confirm-pack").is_disabled()

    workspace_id = workspace_url.rsplit("/", 1)[-1]
    pack_response = page.request.post(
        f"{live_server.base_url}/api/workspaces/{workspace_id}/application-pack",
        data={"confirmed": True, "effective_date": "2026-08-21"},
    )
    assert pack_response.status == 400
    assert "no reviewed usable application material" in pack_response.json()["detail"]
    applied_response = page.request.patch(
        f"{live_server.base_url}/api/workspaces/{workspace_id}/status",
        data={"new_status": "applied", "effective_date": "2026-08-21"},
    )
    assert applied_response.status == 400
    assert page.locator('[data-status="drafted"]').count() == 0

    candidate_path = (
        live_server.profile_root
        / ".claude/skills/job-application-assistant/01-candidate-profile.md"
    )
    candidate_path.write_text(
        candidate_path.read_text(encoding="utf-8")
        + "\n2. Ada Lovelace (2027). A new browser-staleness publication.\n",
        encoding="utf-8",
    )
    _refresh_profile(page, live_server)
    page.goto(workspace_url, wait_until="networkidle")
    assert page.locator(".badge.stale").count() >= 1
    assert page.locator("button.confirm-pack").is_disabled()
    assert page.get_by_role("button", name="Rerun Job Fit").is_visible()
    assert page.get_by_role("button", name="Rerun Application Intelligence").count() == 0
    assert page.locator('[data-status="drafted"]').count() == 0
    _assert_no_private_browser_content(page, live_server)

    page.locator('input[name="extension_ids"][value="data-transfer"]').check()
    _click_reload(page, page.get_by_role("button", name="Rerun Job Fit"))
    assert page.get_by_role("button", name="Rerun Application Intelligence").is_visible()
    assert page.locator("button.confirm-pack").is_disabled()
    _click_reload(page, page.get_by_role("button", name="Rerun Application Intelligence"))
    assert page.locator('[data-item-id="cv-ready"]').count() == 2
    assert page.locator('[data-item-id="cv-needs-review"]').count() == 2
    assert page.locator("button.confirm-pack").is_disabled()

    for _ in range(30):
        acknowledge = page.locator(
            'article.review-item:not(:has(.decision)) '
            'button.review-action[data-disposition="acknowledged_and_proceed"]'
        ).first
        if acknowledge.count() == 0:
            break
        _click_reload(page, acknowledge)
    else:
        raise AssertionError("recovered review queue did not converge")
    assert page.get_by_text("0 outstanding", exact=True).is_visible()
    assert page.locator("button.confirm-pack").is_enabled()
    _assert_no_private_browser_content(page, live_server)
