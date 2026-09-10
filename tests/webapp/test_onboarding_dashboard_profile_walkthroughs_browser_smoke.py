"""Playwright acceptance for the Ticket 3 Dashboard and Candidate Profile
walkthroughs -- real target resolution and no unintended data mutation."""
from __future__ import annotations

import json
import socket
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
import uvicorn

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.db import connect
from webapp.persistence.workspaces import list_workspaces


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _write_profile_root(root: Path) -> None:
    candidate = root / ".claude/skills/job-application-assistant"
    candidate.mkdir(parents=True)
    (root / "cv").mkdir(parents=True)
    (root / "CLAUDE.md").write_text(
        "# Job Application Assistant for Ada Lovelace\n\n"
        "## Candidate Profile\n\n### Identity\n- **Name:** Ada Lovelace\n"
        "- **Location:** London hybrid\n- **Status:** Employed\n\n"
        "### Professional Experience\n"
        "- **Data Engineer** (2020-01 - Present) - **Evidence Works** (London)\n\n"
        "### Technical Skills\n- **Primary:** Python\n",
        encoding="utf-8",
    )
    (candidate / "01-candidate-profile.md").write_text(
        "# Candidate Profile\n\n## Identity\n- **Name:** Ada Lovelace\n"
        "- **Location:** London hybrid\n- **Status:** Employed\n\n"
        "## Professional Experience\n\n"
        "### Data Engineer - Evidence Works (2020-01 - Present)\nLondon\n"
        "- Built production data pipelines\n",
        encoding="utf-8",
    )
    (root / "cv/main_example.tex").write_text(
        "\\documentclass{moderncv}\\name{Ada}{Lovelace}\\begin{document}\\end{document}\n",
        encoding="utf-8",
    )


def _start_server(settings: Settings):
    app = create_app(settings)
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=settings.port, log_level="warning", access_log=False,
    ))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", settings.port), timeout=0.25):
                break
        except OSError:
            time.sleep(0.05)
    else:
        server.should_exit = True
        thread.join(timeout=5)
        raise RuntimeError("Uvicorn onboarding tour fixture did not start")
    return server, thread


@pytest.fixture
def live_server(tmp_path):
    profile_root = tmp_path / "profile"
    _write_profile_root(profile_root)
    port = _free_port()
    settings = Settings(
        db_path=tmp_path / "onboarding-tour.sqlite3", host="127.0.0.1", port=port,
        profile_root=str(profile_root), documents_root=tmp_path / "documents",
    )
    server, thread = _start_server(settings)
    yield SimpleNamespace(base_url=f"http://127.0.0.1:{port}", db_path=settings.db_path)
    server.should_exit = True
    thread.join(timeout=10)


@pytest.fixture
def live_server_no_profile_yet(tmp_path):
    """A second live_server variant that does NOT write a candidate-profile
    source file, so build_profile_view_model's setup_required is genuinely
    True and profile.html renders only the setup form -- none of this
    ticket's profile-manager targets exist in the DOM. This is what lets
    the graceful-degradation test below exercise the real "before first
    setup" case, not a synthetic one."""
    profile_root = tmp_path / "profile"
    (profile_root / ".claude/skills/job-application-assistant").mkdir(parents=True)
    (profile_root / "cv").mkdir(parents=True)
    port = _free_port()
    settings = Settings(
        db_path=tmp_path / "onboarding-tour-no-profile.sqlite3", host="127.0.0.1",
        port=port, profile_root=str(profile_root), documents_root=tmp_path / "documents",
    )
    server, thread = _start_server(settings)
    yield SimpleNamespace(base_url=f"http://127.0.0.1:{port}")
    server.should_exit = True
    thread.join(timeout=10)


def _dismiss_auto_triggered_dashboard_tour(page) -> None:
    """Since Bundle B, dashboard_intro auto-opens on first visit to "/" --
    dismiss it via Skip so a test's own manual "Take the tour" click opens
    a single, uncontested popover (the button re-triggers the very same
    walkthrough via the existing replay transition, which is what this
    file's tests actually mean to exercise)."""
    if page.locator(".onboarding-popover").count():
        page.get_by_role("button", name="Skip").click()
        page.wait_for_selector(".onboarding-popover", state="detached")


def test_dashboard_tour_button_walks_all_four_real_targets(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    _dismiss_auto_triggered_dashboard_tour(page)
    page.get_by_role("button", name="Take the tour").click()
    page.wait_for_selector(".onboarding-popover")
    expected_titles = [
        "This is your pipeline.",
        "The stages, at a glance.",
        "Filter by where things stand.",
        "Start with a job.",
    ]
    for index, title in enumerate(expected_titles):
        assert page.locator(".onboarding-popover-title").inner_text() == title
        assert page.locator(".onboarding-fail-notice").count() == 0
        if index < len(expected_titles) - 1:
            page.get_by_role("button", name="Next").click()
            page.wait_for_function(
                f"document.querySelector('.onboarding-popover-title').innerText === {json.dumps(expected_titles[index + 1])}"
            )
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")


def test_dashboard_tour_does_not_create_or_modify_any_workspace(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    _dismiss_auto_triggered_dashboard_tour(page)
    page.get_by_role("button", name="Take the tour").click()
    page.wait_for_selector(".onboarding-popover")
    for _ in range(3):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    conn = connect(live_server.db_path)
    workspaces = list_workspaces(conn)
    conn.close()
    assert workspaces == []


def test_candidate_profile_tour_walks_all_four_real_targets_and_states_no_invention(live_server, page):
    page.goto(live_server.base_url + "/profile", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Refresh snapshot from included sources").click()

    page.get_by_role("button", name="Take the tour").click()
    page.wait_for_selector(".onboarding-popover")
    expected_titles = [
        "Your evidence, one source at a time.",
        "Add or correct what JobSearch knows.",
        "Add new evidence here.",
        "This is what later stages will use.",
    ]
    bodies_seen = []
    for index, title in enumerate(expected_titles):
        assert page.locator(".onboarding-popover-title").inner_text() == title
        bodies_seen.append(page.locator(".onboarding-popover-body").inner_text())
        assert page.locator(".onboarding-fail-notice").count() == 0
        if index < len(expected_titles) - 1:
            page.get_by_role("button", name="Next").click()
            page.wait_for_function(
                f"document.querySelector('.onboarding-popover-title').innerText === {json.dumps(expected_titles[index + 1])}"
            )
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")
    assert any("never invent" in body for body in bodies_seen)


def test_candidate_profile_tour_does_not_mutate_the_profile_manager_revision(live_server, page):
    page.goto(live_server.base_url + "/profile", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Refresh snapshot from included sources").click()
    revision_before = page.locator("#profile-manager").get_attribute("data-revision")

    page.get_by_role("button", name="Take the tour").click()
    page.wait_for_selector(".onboarding-popover")
    for _ in range(3):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    page.reload(wait_until="networkidle")
    revision_after = page.locator("#profile-manager").get_attribute("data-revision")
    assert revision_after == revision_before


def test_candidate_profile_tour_retries_one_transient_target_and_stops_after_one_permanent_miss(
    live_server, page,
):
    """A target replaced during an advance gets one frame to return; a real
    absence closes cleanly instead of leaving an orphaned overlay or looping."""
    page.goto(live_server.base_url + "/profile", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Refresh snapshot from included sources").click()
    definition = page.evaluate(
        """async () => await (await fetch(
            '/api/onboarding/walkthroughs/candidate_profile_intro/definition'
        )).json()"""
    )
    second_target = definition["steps"][1]["target"]

    page.get_by_role("button", name="Take the tour").click()
    page.wait_for_selector(".onboarding-popover", timeout=2_000)
    page.evaluate(
        """selector => {
            const target = document.querySelector(selector);
            const parent = target.parentNode;
            const nextSibling = target.nextSibling;
            parent.removeChild(target);
            const nativeRequestAnimationFrame = window.requestAnimationFrame;
            window.__onboardingRetryFrameCount = 0;
            window.requestAnimationFrame = callback => {
                window.__onboardingRetryFrameCount += 1;
                window.requestAnimationFrame = nativeRequestAnimationFrame;
                return nativeRequestAnimationFrame(() => {
                    parent.insertBefore(target, nextSibling);
                    callback();
                });
            };
        }""",
        second_target,
    )
    page.get_by_role("button", name="Next").click()
    page.wait_for_function(
        "document.querySelector('.onboarding-popover-title')?.innerText === "
        + json.dumps(definition["steps"][1]["title"]), timeout=2_000,
    )
    assert page.evaluate("window.__onboardingRetryFrameCount") == 1
    assert page.locator(".onboarding-fail-notice").count() == 0
    assert page.locator(".onboarding-popover").count() == 1

    page.get_by_role("button", name="Skip").click()
    page.wait_for_selector(".onboarding-popover", state="detached", timeout=2_000)
    page.get_by_role("button", name="Take the tour").click()
    page.wait_for_selector(".onboarding-popover", timeout=2_000)
    page.evaluate(
        """selector => document.querySelector(selector).remove()""", second_target
    )
    page.get_by_role("button", name="Next").click()
    page.wait_for_selector(".onboarding-fail-notice", timeout=2_000)
    assert page.locator(".onboarding-popover").count() == 0
    page.wait_for_timeout(250)
    assert page.locator(".onboarding-fail-notice").count() == 1


def test_candidate_profile_tour_fails_gracefully_before_first_profile_setup(
    live_server_no_profile_yet, page
):
    # Before any profile exists, profile.html renders only the setup form
    # -- none of this walkthrough's real targets are in the DOM. The
    # overlay must fail gracefully on step one (Ticket 2's mechanism,
    # exercised here against this ticket's real walkthrough id and
    # definitions) and leave the setup form fully usable.
    page.goto(live_server_no_profile_yet.base_url + "/profile", wait_until="networkidle")
    assert page.locator("#basic-profile-form").count() == 1
    assert page.locator("#profile-manager").count() == 0

    page.evaluate("window.Onboarding.start('candidate_profile_intro')")
    page.wait_for_selector(".onboarding-fail-notice")
    assert page.locator(".onboarding-popover").count() == 0

    # the setup form itself must remain fully usable
    page.locator('input[name="name"]').fill("Ada Lovelace")
    assert page.locator('input[name="name"]').input_value() == "Ada Lovelace"
