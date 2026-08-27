from __future__ import annotations

from product.onboarding import get_walkthrough
from product.onboarding_walkthroughs import (
    CANDIDATE_PROFILE_WALKTHROUGH,
    DASHBOARD_WALKTHROUGH,
    register_default_walkthroughs,
)


def test_dashboard_walkthrough_has_four_steps_targeting_real_dashboard_elements():
    assert DASHBOARD_WALKTHROUGH.walkthrough_id == "dashboard_intro"
    assert len(DASHBOARD_WALKTHROUGH.steps) == 4
    targets = [step.target for step in DASHBOARD_WALKTHROUGH.steps]
    assert targets == [
        '[data-onboarding-target="dashboard-hero"]',
        '[data-onboarding-target="dashboard-getting-started"]',
        '[data-onboarding-target="dashboard-filters"]',
        '[data-onboarding-target="add-job-button"]',
    ]


def test_candidate_profile_walkthrough_states_no_invented_qualifications():
    assert CANDIDATE_PROFILE_WALKTHROUGH.walkthrough_id == "candidate_profile_intro"
    bodies = " ".join(step.body for step in CANDIDATE_PROFILE_WALKTHROUGH.steps)
    assert "never invents" in bodies or "never invent" in bodies


def test_candidate_profile_walkthrough_has_four_steps_targeting_real_profile_elements():
    targets = [step.target for step in CANDIDATE_PROFILE_WALKTHROUGH.steps]
    assert targets == [
        '[data-onboarding-target="profile-sources-panel"]',
        '[data-onboarding-target="profile-entries-panel"]',
        '[data-onboarding-target="profile-add-details"]',
        '[data-onboarding-target="profile-claims-panel"]',
    ]


def test_register_default_walkthroughs_makes_both_resolvable():
    register_default_walkthroughs()
    assert get_walkthrough("dashboard_intro") is DASHBOARD_WALKTHROUGH
    assert get_walkthrough("candidate_profile_intro") is CANDIDATE_PROFILE_WALKTHROUGH


def test_register_default_walkthroughs_is_idempotent():
    register_default_walkthroughs()
    register_default_walkthroughs()
    assert get_walkthrough("dashboard_intro") is DASHBOARD_WALKTHROUGH


def test_creating_the_app_registers_both_default_walkthroughs(tmp_path):
    from fastapi.testclient import TestClient

    from webapp.app import create_app
    from webapp.config import Settings

    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", documents_root=tmp_path / "documents",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.get("/api/onboarding/walkthroughs")
        assert response.status_code == 200, response.text
        ids = {row["walkthrough_id"] for row in response.json()}
        assert "dashboard_intro" in ids
        assert "candidate_profile_intro" in ids
