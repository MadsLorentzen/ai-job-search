from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import list_artifact_history
from webapp.persistence.db import connect
from webapp.persistence.review import list_review_decisions
from webapp.persistence.workflow import list_workflow_events
from webapp.persistence.workspaces import ensure_profile_workspace
from tests.webapp.services.test_application_pack import _decide, _seed, _completion_ready_units


def _app_with_pack_chain(tmp_path):
    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", documents_root=tmp_path / "documents"
    )
    app = create_app(settings)
    with TestClient(app):
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        from webapp.persistence.workspaces import create_workspace
        workspace = create_workspace(conn, company="Acme", title="Backend Engineer")
        units = _completion_ready_units()
        _, _, _, intelligence = _seed(conn, workspace["id"], units=units)
        for unit in units:
            _decide(conn, workspace["id"], intelligence, "content_unit", unit["unit_id"])
        conn.close()
    return app, settings, workspace["id"]


def test_review_view_and_decision_route(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        view = client.get(f"/api/workspaces/{workspace_id}/review")
        assert view.status_code == 200
        intelligence = view.json()["application_intelligence_result"]
        response = client.post(f"/api/workspaces/{workspace_id}/review-decisions", json={
            "review_item_type": "content_unit", "source_artifact_id": intelligence["id"],
            "domain_item_id": "cv_1", "disposition": "omit_from_positioning",
            "note": "newest decision wins",
        })
        assert response.status_code == 201
        conn = connect(settings.db_path)
        decisions = list_review_decisions(conn, workspace_id, intelligence["id"])
        assert len(decisions) == 4
        cv_decisions = [item for item in decisions if item["domain_item_id"] == "cv_1"]
        assert [item["disposition"] for item in cv_decisions] == [
            "omit_from_positioning",
            "acknowledged_and_proceed",
        ]
        conn.close()


def test_batch_review_records_existing_dispositions_atomically(tmp_path):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        intelligence = client.get(
            f"/api/workspaces/{workspace_id}/review"
        ).json()["application_intelligence_result"]
        decisions = [
            {
                "review_item_type": "content_unit",
                "source_artifact_id": intelligence["id"],
                "domain_item_id": item_id,
                "disposition": "omit_from_positioning",
            }
            for item_id in ("cv_1", "cv_2")
        ]
        response = client.post(
            f"/api/workspaces/{workspace_id}/review-decisions/batch",
            json={"decisions": decisions},
        )
        assert response.status_code == 201
        assert [item["disposition"] for item in response.json()["decisions"]] == [
            "omit_from_positioning", "omit_from_positioning",
        ]

        conn = connect(settings.db_path)
        before = len(list_review_decisions(conn, workspace_id))
        conn.close()
        invalid = client.post(
            f"/api/workspaces/{workspace_id}/review-decisions/batch",
            json={"decisions": [decisions[0], {**decisions[1], "source_artifact_id": "missing"}]},
        )
        assert invalid.status_code == 400
        conn = connect(settings.db_path)
        assert len(list_review_decisions(conn, workspace_id)) == before
        conn.close()


def test_profile_pseudo_workspace_rejected_by_review_and_pack_routes(tmp_path):
    app, settings, _ = _app_with_pack_chain(tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/workspaces/profile/review").status_code == 404
        assert client.post("/api/workspaces/profile/application-pack", json={
            "confirmed": True, "effective_date": "2026-08-20"
        }).status_code == 404


def test_projection_failure_http_is_201_partial_success_and_retry_has_no_db_side_effects(tmp_path, monkeypatch):
    app, settings, workspace_id = _app_with_pack_chain(tmp_path)
    from webapp.services import archive_projection
    real_writer = archive_projection.write_application_pack_projection
    monkeypatch.setattr(
        archive_projection, "write_application_pack_projection",
        lambda *args, **kwargs: (_ for _ in ()).throw(OSError("archive unavailable")),
    )
    with TestClient(app) as client:
        response = client.post(f"/api/workspaces/{workspace_id}/application-pack", json={
            "confirmed": True, "effective_date": "2026-08-20"
        })
        assert response.status_code == 201
        body = response.json()
        assert body["gate4_status"] == "SUCCEEDED"
        assert body["projection"]["status"] == "FAILED"
        assert body["projection"]["retryable"] is True
        pack_id = body["projection"]["pack_artifact_id"]

        monkeypatch.setattr(archive_projection, "write_application_pack_projection", real_writer)
        retry = client.post(
            f"/api/workspaces/{workspace_id}/application-pack/{pack_id}/retry-projection"
        )
        assert retry.status_code == 200
        assert retry.json()["status"] == "SUCCEEDED"
        assert retry.json()["pack_artifact_id"] == pack_id

        conn = connect(settings.db_path)
        assert len(list_artifact_history(conn, workspace_id, "application_pack")) == 1
        assert len(list_workflow_events(conn, workspace_id)) == 1
        conn.close()
