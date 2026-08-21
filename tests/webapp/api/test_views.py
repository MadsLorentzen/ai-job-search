from pathlib import Path

from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, create_workspace, ensure_profile_workspace
from tests.webapp.services.test_workspace_view import _seed_evidence


def _client(tmp_path):
    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3", documents_root=tmp_path / "documents", extensions_dir=Path(__file__).parents[2] / "fixtures" / "extensions")
    return TestClient(create_app(settings)), settings


def test_dashboard_renders_required_columns_and_all_filters(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Backend Engineer")
        conn.close()
        response = client.get("/")
        assert response.status_code == 200
        for text in ("Acme", "Backend Engineer", "Product stage", "Fit", "Recommendation", "Trust state", "Workflow", "Updated"):
            assert text in response.text
        for filter_name in ("Active", "Drafted", "Applied", "Interview", "Offer", "Final"):
            assert filter_name in response.text


def test_dashboard_uses_configured_extension_registry(tmp_path, monkeypatch):
    client, settings = _client(tmp_path)
    captured = {}

    def fake_dashboard(conn, *, filter_name, extensions_dir):
        captured["extensions_dir"] = extensions_dir
        return {"workspaces": [], "filter": filter_name, "filters": ()}

    monkeypatch.setattr("webapp.api.views.build_dashboard_view_model", fake_dashboard)
    with client:
        assert client.get("/").status_code == 200
    assert captured["extensions_dir"] == settings.extensions_dir


def test_profile_is_trust_inspection_and_conflict_never_verified(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot", content_id="profile", payload={
            "claims": [{"id": "clm", "concept_id": "concept", "field": "title", "value": "Engineer", "placeholder": False}],
            "conflicts": [{"id": "conf", "concept_id": "concept", "field": "title"}],
        })
        conn.close()
        text = client.get("/profile").text
        assert "Trust inspection" in text and "No editing" in text
        assert "NEEDS_REVIEW" in text
        assert "Verified evidence" not in text


def test_new_job_offers_only_manual_paste_and_supported_import(tmp_path):
    client, _ = _client(tmp_path)
    with client:
        text = client.get("/new-job").text
        assert "Paste posting" in text and "Manual details" in text and "Supported JSON import" in text
        assert "scrape" in text.lower() and "does not" in text.lower()


def test_dashboard_and_workspace_direct_missing_profile_to_setup(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        dashboard = client.get("/").text
        assert "Set up your Evidence Profile" in dashboard

        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Planner")
        save_artifact(
            conn, workspace_id=ws["id"], artifact_type="job_posting_snapshot",
            content_id="job", payload={"raw_text": "Plan delivery."},
        )
        save_artifact(
            conn, workspace_id=ws["id"], artifact_type="job_understanding_result",
            content_id="understanding", payload={"status": "READY"},
        )
        conn.close()

        workspace = client.get(f"/workspaces/{ws['id']}").text
        assert "Evidence Profile required" in workspace
        assert f"/profile?return_to=/workspaces/{ws['id']}" in workspace
        assert "Run Job Fit" not in workspace


def test_workspace_renders_stepper_all_evidence_and_safe_controls(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        ws = create_workspace(conn, company="Acme", title="Backend Engineer")
        _seed_evidence(conn, ws["id"])
        conn.close()
        response = client.get(f"/workspaces/{ws['id']}")
        assert response.status_code == 200
        text = response.text
        for stage in ("Job", "Understanding", "Job Fit", "Application Intelligence", "Review", "Status"):
            assert stage in text
        for label in ("Verified evidence", "Accepted inference — functionally equivalent", "Transferable evidence", "Missing evidence", "NEEDS_REVIEW", "Unsupported — excluded from application material"):
            assert label in text
        for detail in ("Subsurface models", "Model workflows", "geophysics", "Confirm context", "Does not prove employment"):
            assert detail in text
        assert "Create reviewed pack — does not submit" in text
        assert "Mark applied" not in text
        assert 'data-item-id="unit_ready"' in text
        assert 'data-item-id="unit_review"' in text
        assert "Audit only. No inclusion control is available." in text


def test_provider_rationale_is_not_rendered_as_candidate_evidence(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        ws = create_workspace(conn, company="Acme", title="Engineer")
        save_artifact(conn, workspace_id=ws["id"], artifact_type="job_fit_result", payload={
            "status": "READY", "direct_matches": [{"match_id": "m", "profile_evidence_ids": [], "job_requirement_ids": [], "status": "READY", "rationale": "MODEL_ONLY_SECRET_RATIONALE"}],
            "functionally_equivalent_matches": [], "transferable_matches": [], "gaps": [], "unsupported_claims": [], "gate_assessments": [], "human_judgment_questions": [],
        })
        conn.close()
        assert "MODEL_ONLY_SECRET_RATIONALE" not in client.get(f"/workspaces/{ws['id']}").text


def test_untrusted_posting_is_escaped_and_secrets_paths_never_render(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-ui-secret")
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Engineer")
        save_artifact(conn, workspace_id=ws["id"], artifact_type="job_posting_snapshot", content_id="job", payload={"raw_text": "<script>alert(1)</script>"})
        conn.close()
        text = client.get(f"/workspaces/{ws['id']}").text
        assert "<script>alert(1)</script>" not in text
        assert "&lt;script&gt;" in text
        assert "sk-ui-secret" not in text
        assert "extension.json" not in text and str(settings.extensions_dir) not in text


def test_stale_downstream_action_is_not_rendered(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        ws = create_workspace(conn, company="Acme", title="Engineer")
        _seed_evidence(conn, ws["id"])
        save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot", content_id="profile_new", payload={"claims": [], "conflicts": []})
        conn.close()
        text = client.get(f"/workspaces/{ws['id']}").text
        assert ">stale<" in text.lower()
        assert "Run Application Intelligence" not in text
        assert 'class="button confirm-pack"' in text and "disabled" in text


def test_workspace_unknown_and_profile_pseudo_are_404(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        conn.close()
        assert client.get("/workspaces/missing").status_code == 404
        assert client.get("/workspaces/profile").status_code == 404


def test_javascript_controls_call_task13_endpoints_without_paths_or_secrets(tmp_path):
    client, _ = _client(tmp_path)
    with client:
        script = client.get("/static/app.js").text
        for endpoint in (
            "/api/profile/refresh", "/review-decisions", "/application-pack", "/status"
        ):
            assert endpoint in script
        assert "extension_ids" in script
        assert "extension_paths" not in script and "extension.json" not in script
        assert "OPENAI_API_KEY" not in script
        assert "This does not submit an application" in script
        assert "submitted this application externally" in script
