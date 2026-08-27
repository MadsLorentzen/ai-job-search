from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from product.onboarding import WalkthroughDefinition, WalkthroughStep, register_walkthrough
from webapp.app import create_app
from webapp.config import Settings


@pytest.fixture(autouse=True)
def _register_route_test_walkthrough():
    register_walkthrough(
        WalkthroughDefinition(
            walkthrough_id="api_test_walkthrough",
            version=1,
            title="API test walkthrough",
            steps=(
                WalkthroughStep(
                    step_id="s0", target="[data-onboarding-target=a]",
                    title="A", body="A body",
                ),
                WalkthroughStep(
                    step_id="s1", target="[data-onboarding-target=b]",
                    title="B", body="B body",
                ),
            ),
        )
    )


def _app(tmp_path):
    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", documents_root=tmp_path / "documents",
    )
    return create_app(settings)


def test_list_walkthroughs_includes_registered_not_started(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/onboarding/walkthroughs")
        assert response.status_code == 200, response.text
        ids = {row["walkthrough_id"] for row in response.json()}
        assert "api_test_walkthrough" in ids


def test_get_single_walkthrough_not_found(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/onboarding/walkthroughs/does_not_exist")
        assert response.status_code == 404


def test_begin_advance_complete_lifecycle_over_http(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        begun = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/begin"
        )
        assert begun.status_code == 201, begun.text
        assert begun.json()["status"] == "in_progress"

        advanced = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/advance"
        )
        assert advanced.status_code == 200, advanced.text
        assert advanced.json()["current_step_index"] == 1

        completed = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/complete"
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "completed"

        fetched = client.get("/api/onboarding/walkthroughs/api_test_walkthrough")
        assert fetched.json()["status"] == "completed"


def test_illegal_transition_returns_409(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/back"
        )
        assert response.status_code == 409, response.text


def test_skip_requires_valid_reason(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/begin")
        bad = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/skip",
            json={"reason": "not_a_real_reason"},
        )
        assert bad.status_code in (400, 409), bad.text

        good = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/skip",
            json={"reason": "dont_show_again"},
        )
        assert good.status_code == 200, good.text
        assert good.json()["dismissal_reason"] == "dont_show_again"


def test_interrupt_then_resume_over_http(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/begin")
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/advance")
        interrupted = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/interrupt"
        )
        assert interrupted.status_code == 200
        assert interrupted.json()["status"] == "in_progress"

        resumed = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/resume"
        )
        assert resumed.status_code == 200
        assert resumed.json()["current_step_index"] == 1


def test_replay_after_completion_over_http(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/begin")
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/advance")
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/complete")

        replayed = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/replay"
        )
        assert replayed.status_code == 200, replayed.text
        body = replayed.json()
        assert body["status"] == "in_progress"
        assert body["current_step_index"] == 0
        assert body["times_completed"] == 1


def test_begin_unknown_walkthrough_returns_404(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.post("/api/onboarding/walkthroughs/does_not_exist/begin")
        assert response.status_code == 404


def test_get_walkthrough_definition_returns_step_content(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.get(
            "/api/onboarding/walkthroughs/api_test_walkthrough/definition"
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["title"] == "API test walkthrough"
        assert [step["step_id"] for step in body["steps"]] == ["s0", "s1"]
        assert body["steps"][0]["target"] == "[data-onboarding-target=a]"


def test_get_walkthrough_definition_unknown_returns_404(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/onboarding/walkthroughs/does_not_exist/definition")
        assert response.status_code == 404
