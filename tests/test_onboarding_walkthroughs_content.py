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


def test_job_workflow_walkthrough_has_five_steps_targeting_real_workspace_elements():
    from product.onboarding_walkthroughs import JOB_WORKFLOW_WALKTHROUGH

    assert JOB_WORKFLOW_WALKTHROUGH.walkthrough_id == "job_workflow_intro"
    assert len(JOB_WORKFLOW_WALKTHROUGH.steps) == 5
    targets = [step.target for step in JOB_WORKFLOW_WALKTHROUGH.steps]
    assert targets == [
        '[data-onboarding-target="workspace-stepper"]',
        '#job-posting',
        '#job-fit',
        '#application-intelligence',
        '.readiness-panel',
    ]


def test_job_workflow_walkthrough_mentions_evidence_and_review_not_submission():
    from product.onboarding_walkthroughs import JOB_WORKFLOW_WALKTHROUGH

    bodies = " ".join(step.body for step in JOB_WORKFLOW_WALKTHROUGH.steps)
    assert "evidence" in bodies.lower()
    assert "review" in bodies.lower()
    # Ticket 4 must never claim or imply the walkthrough itself submits
    # anything -- final submission stays manual per the stream's core
    # invariants.
    assert "submit" not in bodies.lower() or "submitted" in bodies.lower()


def test_register_default_walkthroughs_also_registers_job_workflow():
    from product.onboarding import get_walkthrough
    from product.onboarding_walkthroughs import (
        JOB_WORKFLOW_WALKTHROUGH,
        register_default_walkthroughs,
    )

    register_default_walkthroughs()
    assert get_walkthrough("job_workflow_intro") is JOB_WORKFLOW_WALKTHROUGH


def test_document_workflow_walkthrough_has_five_steps_targeting_real_elements():
    from product.onboarding_walkthroughs import DOCUMENT_WORKFLOW_WALKTHROUGH

    assert DOCUMENT_WORKFLOW_WALKTHROUGH.walkthrough_id == "document_workflow_intro"
    assert len(DOCUMENT_WORKFLOW_WALKTHROUGH.steps) == 5
    targets = [step.target for step in DOCUMENT_WORKFLOW_WALKTHROUGH.steps]
    assert targets == [
        '.gate-four.document-finalization',
        '.document-generate.confirm-pack',
        '.document-kind-grid',
        '.document-select',
        '.confirm-documents',
    ]


def test_document_workflow_walkthrough_avoids_internal_vocabulary():
    from product.onboarding_walkthroughs import DOCUMENT_WORKFLOW_WALKTHROUGH

    bodies = " ".join(
        step.title + " " + step.body for step in DOCUMENT_WORKFLOW_WALKTHROUGH.steps
    ).lower()
    forbidden = ["hash", "artifact", "blob", "content_id", "frozen", "pack", "snapshot"]
    leaked = [word for word in forbidden if word in bodies]
    assert leaked == [], f"internal vocabulary leaked into walkthrough copy: {leaked}"


def test_document_workflow_walkthrough_explains_confirm_without_naming_immutability_jargon():
    from product.onboarding_walkthroughs import DOCUMENT_WORKFLOW_WALKTHROUGH

    confirm_step = DOCUMENT_WORKFLOW_WALKTHROUGH.steps[-1]
    assert confirm_step.target == '.confirm-documents'
    assert "exact" in confirm_step.body.lower()
    assert "stay" in confirm_step.body.lower() or "remain" in confirm_step.body.lower()


def test_register_default_walkthroughs_also_registers_document_workflow():
    from product.onboarding import get_walkthrough
    from product.onboarding_walkthroughs import (
        DOCUMENT_WORKFLOW_WALKTHROUGH,
        register_default_walkthroughs,
    )

    register_default_walkthroughs()
    assert get_walkthrough("document_workflow_intro") is DOCUMENT_WORKFLOW_WALKTHROUGH


def test_every_registered_walkthrough_has_a_launch_context():
    from product.onboarding import WALKTHROUGH_REGISTRY
    from product.onboarding_walkthroughs import (
        WALKTHROUGH_LAUNCH_CONTEXTS,
        register_default_walkthroughs,
    )

    register_default_walkthroughs()
    for walkthrough_id in (
        "dashboard_intro", "candidate_profile_intro",
        "job_workflow_intro", "document_workflow_intro",
    ):
        assert walkthrough_id in WALKTHROUGH_LAUNCH_CONTEXTS
        assert walkthrough_id in WALKTHROUGH_REGISTRY


def test_page_context_walkthroughs_declare_a_fixed_path():
    from product.onboarding_walkthroughs import WALKTHROUGH_LAUNCH_CONTEXTS

    assert WALKTHROUGH_LAUNCH_CONTEXTS["dashboard_intro"] == {"context": "page", "path": "/"}
    assert WALKTHROUGH_LAUNCH_CONTEXTS["candidate_profile_intro"] == {
        "context": "page", "path": "/profile",
    }


def test_workspace_context_walkthroughs_declare_no_fixed_path():
    from product.onboarding_walkthroughs import WALKTHROUGH_LAUNCH_CONTEXTS

    assert WALKTHROUGH_LAUNCH_CONTEXTS["job_workflow_intro"] == {"context": "workspace"}
    assert WALKTHROUGH_LAUNCH_CONTEXTS["document_workflow_intro"] == {"context": "workspace"}
