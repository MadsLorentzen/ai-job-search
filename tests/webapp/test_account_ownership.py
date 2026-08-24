from __future__ import annotations

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.api.dependencies import get_account_scope
from webapp.config import Settings
from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID, create_account
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect, init_db
from webapp.persistence.search_workspaces import create_search_workspace
from webapp.persistence.profile_sources import (
    list_profile_source_settings,
    set_supplemental_source_included,
)
from webapp.persistence.workspaces import ensure_profile_workspace
from webapp.services.ownership import account_profile_root
from webapp.services.profile_manager import get_profile_manager


ACCOUNT_B = "account_b"


def test_every_user_facing_route_resolves_account_scope(tmp_path):
    app = create_app(_settings(tmp_path))
    system_routes = {"/health", "/api/extensions"}

    unscoped = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or route.path in system_routes:
            continue
        dependency_calls = {
            dependency.call for dependency in route.dependant.dependencies
        }
        if get_account_scope not in dependency_calls:
            unscoped.append(f"{','.join(sorted(route.methods or []))} {route.path}")

    assert unscoped == []


def test_account_ids_cannot_escape_the_isolated_profile_root(tmp_path):
    settings = _settings(tmp_path)
    init_db(settings.db_path)
    conn = connect(settings.db_path)
    with pytest.raises(ValueError, match="safe opaque identifier"):
        create_account(
            conn,
            account_id="../account_escape",
            display_name="Invalid account",
        )
    with pytest.raises(ValueError, match="safe opaque identifier"):
        account_profile_root(settings.profile_root, "../account_escape")
    conn.close()


def _settings(tmp_path, account_id: str | None = None) -> Settings:
    return Settings(
        db_path=tmp_path / "ownership.sqlite3",
        documents_root=tmp_path / "documents",
        extensions_dir=tmp_path / "extensions",
        profile_root=str(tmp_path / "profiles"),
        account_id=account_id,
    )


def _prepare(tmp_path):
    settings_a = _settings(tmp_path)
    init_db(settings_a.db_path)
    conn = connect(settings_a.db_path)
    create_account(conn, account_id=ACCOUNT_B, display_name="Second user")
    search_b = create_search_workspace(
        conn,
        account_id=ACCOUNT_B,
        search_workspace_id="search_b",
        name="Second search",
    )
    profile_a = ensure_profile_workspace(conn, account_id=DEFAULT_ACCOUNT_ID)
    profile_b = ensure_profile_workspace(conn, account_id=ACCOUNT_B)
    save_artifact(
        conn,
        workspace_id=profile_a["id"],
        artifact_type="profile_snapshot",
        content_id="profile-a",
        payload={"claims": [{"value": "Account A evidence"}]},
    )
    save_artifact(
        conn,
        workspace_id=profile_b["id"],
        artifact_type="profile_snapshot",
        content_id="profile-b",
        payload={"claims": [{"value": "Account B evidence"}]},
    )
    conn.close()
    return settings_a, _settings(tmp_path, ACCOUNT_B), search_b


def _source_record() -> dict:
    return {
        "schema_version": "job-source-record.v0",
        "source": "ownership-test",
        "source_record_id": "same-external-job",
        "captured_at": "2026-08-24T12:00:00+00:00",
        "company": "Shared Employer",
        "title": "Platform Engineer",
        "description": "Build the same platform for both applicants.",
    }


def _create_application(client: TestClient) -> dict:
    response = client.post(
        "/api/workspaces",
        json={
            "company": "Shared Employer",
            "title": "Platform Engineer",
            "source_record": _source_record(),
        },
    )
    assert response.status_code == 201
    return response.json()


def test_current_account_scopes_profile_search_and_application_identity(tmp_path):
    settings_a, settings_b, search_b = _prepare(tmp_path)
    with TestClient(create_app(settings_a)) as account_a, TestClient(
        create_app(settings_b)
    ) as account_b:
        profile_a = account_a.get("/api/profile").json()["profile"]
        profile_b = account_b.get("/api/profile").json()["profile"]
        assert profile_a["content_id"] == "profile-a"
        assert profile_b["content_id"] == "profile-b"

        search_a_ids = {
            item["id"]
            for item in account_a.get("/api/search-workspaces").json()[
                "search_workspaces"
            ]
        }
        search_b_ids = {
            item["id"]
            for item in account_b.get("/api/search-workspaces").json()[
                "search_workspaces"
            ]
        }
        assert "search_default" in search_a_ids
        assert search_b["id"] in search_b_ids
        assert search_b["id"] not in search_a_ids
        assert account_a.get(
            f"/api/search-workspaces/{search_b['id']}"
        ).status_code == 404
        assert account_a.patch(
            f"/api/search-workspaces/{search_b['id']}",
            json={"name": "stolen", "expected_revision": 1},
        ).status_code == 404
        assert account_a.get(
            f"/api/search-workspaces/{search_b['id']}/discovery/sources"
        ).status_code == 404

        first_a = _create_application(account_a)
        repeated_a = _create_application(account_a)
        first_b = _create_application(account_b)
        assert repeated_a["created"] is False
        assert repeated_a["workspace"]["id"] == first_a["workspace"]["id"]
        assert first_b["created"] is True
        assert first_b["workspace"]["id"] != first_a["workspace"]["id"]


def test_cross_owner_application_children_are_not_readable_or_mutable(tmp_path):
    settings_a, settings_b, _ = _prepare(tmp_path)
    with TestClient(create_app(settings_a)) as account_a, TestClient(
        create_app(settings_b)
    ) as account_b:
        application_a = _create_application(account_a)["workspace"]
        application_b = _create_application(account_b)
        workspace_b = application_b["workspace"]
        artifact_b = application_b["artifact"]

        cross_paths = (
            f"/api/workspaces/{workspace_b['id']}",
            f"/api/workspaces/{workspace_b['id']}/review",
            f"/api/workspaces/{workspace_b['id']}/events",
        )
        for path in cross_paths:
            assert account_a.get(path).status_code == 404
        assert account_a.get("/api/workspaces/ws_missing").status_code == 404
        assert account_a.patch(
            f"/api/workspaces/{workspace_b['id']}/status",
            json={"new_status": "withdrawn", "effective_date": "2026-08-24"},
        ).status_code == 404

        cross_review = account_a.post(
            f"/api/workspaces/{application_a['id']}/review-decisions",
            json={
                "review_item_type": "profile_conflict",
                "source_artifact_id": artifact_b["id"],
                "domain_item_id": "known-b-id",
                "disposition": "omit_from_positioning",
            },
        )
        missing_review = account_a.post(
            f"/api/workspaces/{application_a['id']}/review-decisions",
            json={
                "review_item_type": "profile_conflict",
                "source_artifact_id": "artifact_missing",
                "domain_item_id": "missing-id",
                "disposition": "omit_from_positioning",
            },
        )
        assert cross_review.status_code == missing_review.status_code == 400
        assert cross_review.json()["detail"] == missing_review.json()["detail"]


def test_unknown_configured_account_is_not_silently_replaced_by_default(tmp_path):
    settings = _settings(tmp_path, "account_missing")
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/workspaces")
    assert response.status_code == 503
    assert response.json()["detail"] == "configured account is unavailable"


def test_profile_entry_identity_and_source_settings_are_account_scoped(tmp_path):
    settings_a, _, _ = _prepare(tmp_path)
    root_a = account_profile_root(settings_a.profile_root, DEFAULT_ACCOUNT_ID)
    root_b = account_profile_root(settings_a.profile_root, ACCOUNT_B)
    relative = (
        ".claude/skills/job-application-assistant/01-candidate-profile.md"
    )
    markdown = (
        "# Candidate Profile\n\n## Identity\n\n"
        "<!-- profile-entry-id: profile-entry-aaaaaaaaaaaaaaaaaaaa -->\n"
        "- **Name:** Shared Marker\n"
    )
    for root in (root_a, root_b):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(markdown, encoding="utf-8")

    conn = connect(settings_a.db_path)
    manager_a = get_profile_manager(
        conn, root=root_a, account_id=DEFAULT_ACCOUNT_ID
    )
    manager_b = get_profile_manager(conn, root=root_b, account_id=ACCOUNT_B)
    assert manager_a["entries"][0]["entry_id"] == manager_b["entries"][0]["entry_id"]
    assert conn.execute(
        "SELECT COUNT(*) FROM profile_source_entries "
        "WHERE entry_id='profile-entry-aaaaaaaaaaaaaaaaaaaa'"
    ).fetchone()[0] == 2

    set_supplemental_source_included(
        conn, "cv/main_example.tex", True, account_id=ACCOUNT_B
    )
    set_supplemental_source_included(
        conn, "cv/main_example.tex", False, account_id=DEFAULT_ACCOUNT_ID
    )
    assert next(
        item for item in list_profile_source_settings(
            conn, account_id=DEFAULT_ACCOUNT_ID
        ) if item["source_path"] == "cv/main_example.tex"
    )["included"] is False
    assert next(
        item for item in list_profile_source_settings(
            conn, account_id=ACCOUNT_B
        ) if item["source_path"] == "cv/main_example.tex"
    )["included"] is True
