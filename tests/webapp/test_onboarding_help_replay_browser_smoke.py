"""Playwright acceptance for Bundle B's explicit replay model: Help is a
launcher only, replay always executes on the walkthrough's real page,
workspace-context replay requires an explicit user choice (never a
guessed workspace), and invalid replay ids fail closed."""
from __future__ import annotations

from tests.webapp.test_onboarding_first_use_triggers_browser_smoke import (
    live_server,
    live_server_with_job,
)


def test_dashboard_replay_navigates_and_starts_against_real_targets(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    for _ in range(3):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    page.goto(live_server.base_url + "/walkthroughs", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("table tbody tr", has_text="Your JobSearch dashboard").get_by_role(
            "link", name="Replay"
        ).click()
    assert page.url.rstrip("/") == live_server.base_url
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-popover-title").inner_text() == "This is your pipeline."
    assert page.locator(".onboarding-why-seeing-this").count() == 0
    assert "onboarding_replay" not in page.url


def test_candidate_profile_replay_navigates_and_starts_against_real_targets(live_server, page):
    import requests

    requests.post(
        f"{live_server.base_url}/api/profile/setup/basic",
        json={
            "name": "Ada Lovelace", "location": "London hybrid", "status": "Employed",
            "constraints": "", "education": [], "experience": [], "skills": ["Python"],
            "certifications": [],
        },
    )
    page.goto(f"{live_server.base_url}/walkthroughs", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("table tbody tr", has_text="Your Candidate Profile").get_by_role(
            "link", name="Start"
        ).click()
    assert page.url.startswith(live_server.base_url + "/profile")
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-popover-title").inner_text() == "Your evidence, one source at a time."


def test_job_workflow_replay_with_no_workspace_asks_user_to_choose(live_server, page):
    page.goto(f"{live_server.base_url}/walkthroughs", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("table tbody tr", has_text="Working a job through JobSearch").get_by_role(
            "link", name="Start"
        ).click()
    assert page.url.rstrip("/").split("?")[0] == live_server.base_url
    assert page.get_by_text("becomes available once you have a job", exact=False).is_visible()
    assert page.locator(".onboarding-popover").count() == 0


def test_selecting_a_workspace_carries_replay_intent_and_starts_job_workflow_tour(live_server_with_job, page):
    page.goto(
        f"{live_server_with_job.base_url}/?onboarding_replay=job_workflow_intro",
        wait_until="networkidle",
    )
    assert page.get_by_text("Choose a job below", exact=False).is_visible()
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("a.row-link").first.click()
    # By the time networkidle settles, the destination page's own
    # bootstrap has already consumed and stripped its onboarding_replay
    # param (history.replaceState) -- that stripping IS the mechanism
    # working, not a bug. The real proof the intent was carried through
    # is that the correct tour actually opened.
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-popover-title").inner_text() == "This is where the job stands."
    assert "onboarding_replay" not in page.url


def test_selecting_a_workspace_carries_document_workflow_replay_intent(live_server_with_job, page):
    page.goto(
        f"{live_server_with_job.base_url}/?onboarding_replay=document_workflow_intro",
        wait_until="networkidle",
    )
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("a.row-link").first.click()
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-popover-title").inner_text() == "Your CV and cover letter, your call."


def test_explicit_replay_of_a_completed_walkthrough_works_and_preserves_history(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    for _ in range(3):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    page.goto(live_server.base_url + "/?onboarding_replay=dashboard_intro", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    page.get_by_role("button", name="Skip").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    status = page.evaluate(
        "fetch('/api/onboarding/walkthroughs/dashboard_intro').then(r => r.json())"
    )
    assert status["times_completed"] == 1
    assert status["status"] == "skipped"


def test_invalid_replay_id_never_starts_any_walkthrough(live_server, page):
    page.goto(
        live_server.base_url + "/?onboarding_replay=not_a_real_walkthrough",
        wait_until="networkidle",
    )
    page.wait_for_timeout(500)
    assert page.locator(".onboarding-popover").count() == 0
    assert "onboarding_replay" not in page.url


def test_mismatched_replay_id_on_wrong_page_never_starts(live_server, page):
    page.goto(
        live_server.base_url + "/?onboarding_replay=candidate_profile_intro",
        wait_until="networkidle",
    )
    page.wait_for_timeout(500)
    assert page.locator(".onboarding-popover").count() == 0
