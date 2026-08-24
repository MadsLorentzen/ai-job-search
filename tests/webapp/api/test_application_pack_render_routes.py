from copy import deepcopy
from io import BytesIO

from docx import Document
from fastapi.testclient import TestClient

from tests.webapp.api.test_review_routes import _app_with_pack_chain
from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.accounts import create_account
from webapp.persistence.artifacts import get_artifact, save_artifact
from webapp.persistence.db import connect


def _confirm_pack(client, workspace_id):
    response = client.post(f"/api/workspaces/{workspace_id}/application-pack", json={
        "confirmed": True, "effective_date": "2026-08-24",
    })
    assert response.status_code == 201, response.text
    return response.json()


def _document_text(response) -> str:
    document = Document(BytesIO(response.content))
    return " ".join(paragraph.text for paragraph in document.paragraphs)


def test_download_cv_document_after_pack_confirmation(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        _confirm_pack(client, workspace_id)
        response = client.get(f"/api/workspaces/{workspace_id}/application-pack/render/cv")
        assert response.status_code == 200
        assert response.headers["content-type"] == (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        assert "attachment" in response.headers["content-disposition"]
        assert response.headers["content-disposition"].endswith('.docx"')
        document = Document(BytesIO(response.content))
        texts = [p.text for p in document.paragraphs]
        assert any(text for text in texts)


def test_download_cover_letter_document_after_pack_confirmation(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        _confirm_pack(client, workspace_id)
        response = client.get(
            f"/api/workspaces/{workspace_id}/application-pack/render/cover_letter"
        )
        assert response.status_code == 200
        document = Document(BytesIO(response.content))
        texts = [p.text for p in document.paragraphs]
        assert any(text for text in texts)


def test_render_before_pack_confirmation_is_a_clean_error(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        response = client.get(f"/api/workspaces/{workspace_id}/application-pack/render/cv")
        assert response.status_code == 400


def test_render_unknown_kind_is_404(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        _confirm_pack(client, workspace_id)
        response = client.get(
            f"/api/workspaces/{workspace_id}/application-pack/render/resume_video"
        )
        assert response.status_code == 404


def test_render_of_unknown_workspace_is_404(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/workspaces/does-not-exist/application-pack/render/cv")
        assert response.status_code == 404


def test_explicit_historical_pack_artifact_id_renders_that_exact_pack(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        first_confirm = _confirm_pack(client, workspace_id)
        first_pack_artifact_id = first_confirm["artifact"]["id"]

        conn = connect(settings.db_path)
        first_pack = get_artifact(conn, first_pack_artifact_id)
        historical_text = first_pack["payload"]["cv_content"][0]["text"]
        current_marker = "CURRENT PACK MARKER MUST NOT APPEAR IN HISTORY"
        current_payload = deepcopy(first_pack["payload"])
        current_payload["cv_content"][0]["text"] = current_marker
        current_pack = save_artifact(
            conn,
            workspace_id=workspace_id,
            artifact_type="application_pack",
            payload=current_payload,
            content_id="integration-current-pack",
        )
        conn.close()

        historical_response = client.get(
            f"/api/workspaces/{workspace_id}/application-pack/render/cv",
            params={"pack_artifact_id": first_pack_artifact_id},
        )
        current_response = client.get(
            f"/api/workspaces/{workspace_id}/application-pack/render/cv"
        )
        assert historical_response.status_code == current_response.status_code == 200

    historical_render = _document_text(historical_response)
    current_render = _document_text(current_response)
    assert historical_text in historical_render
    assert current_marker not in historical_render
    assert current_marker in current_render
    assert historical_response.headers["x-content-hash"] != current_response.headers[
        "x-content-hash"
    ]
    assert current_pack["id"] != first_pack_artifact_id


def test_account_cannot_render_another_accounts_exact_pack(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as account_a:
        pack_artifact_id = _confirm_pack(account_a, workspace_id)["artifact"]["id"]

    conn = connect(settings.db_path)
    create_account(conn, account_id="account_render_b", display_name="Renderer B")
    conn.close()
    account_b_settings = Settings(
        db_path=settings.db_path,
        documents_root=tmp_path / "account-b-documents",
        extensions_dir=settings.extensions_dir,
        profile_root=str(tmp_path / "account-b-profile"),
        account_id="account_render_b",
    )
    with TestClient(create_app(account_b_settings)) as account_b:
        response = account_b.get(
            f"/api/workspaces/{workspace_id}/application-pack/render/cv",
            params={"pack_artifact_id": pack_artifact_id},
        )

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert not response.content.startswith(b"PK")


def test_download_remains_available_after_workflow_advances_past_drafted(tmp_path):
    """Regression: the immutable pack, and therefore its rendered documents,
    must stay downloadable once the workflow moves to applied/interview/etc.
    Downloading is not submission, and pack existence -- not workflow status
    -- is what should gate availability."""
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        _confirm_pack(client, workspace_id)

        applied = client.patch(f"/api/workspaces/{workspace_id}/status", json={
            "new_status": "applied", "effective_date": "2026-08-24",
        })
        assert applied.status_code == 200, applied.text

        response = client.get(f"/api/workspaces/{workspace_id}/application-pack/render/cv")
        assert response.status_code == 200

        interview = client.patch(f"/api/workspaces/{workspace_id}/status", json={
            "new_status": "interview", "effective_date": "2026-08-24",
        })
        assert interview.status_code == 200, interview.text

        response = client.get(
            f"/api/workspaces/{workspace_id}/application-pack/render/cover_letter"
        )
        assert response.status_code == 200


def test_render_rejects_pack_artifact_id_belonging_to_a_different_workspace(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        first_confirm = _confirm_pack(client, workspace_id)
        first_pack_artifact_id = first_confirm["artifact"]["id"]

    other_app, other_settings, other_workspace_id = _app_with_pack_chain(tmp_path.parent / "other")
    with TestClient(other_app) as other_client:
        response = other_client.get(
            f"/api/workspaces/{other_workspace_id}/application-pack/render/cv",
            params={"pack_artifact_id": first_pack_artifact_id},
        )
        assert response.status_code == 400
