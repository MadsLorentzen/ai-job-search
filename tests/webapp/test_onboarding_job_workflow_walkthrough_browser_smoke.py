"""Playwright acceptance for the Ticket 4 job workflow walkthrough --
real target resolution across the actual job journey, graceful failure,
no unintended mutation, and unchanged job-analysis behavior."""
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
from webapp.persistence.workspaces import ensure_profile_workspace, get_workspace
from webapp.services.pipeline import create_job_from_source_record


POSTING_TEXT = (
    "Python is required.\n"
    "Cloud certification is required.\n"
    "Build reliable data pipelines.\n"
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
        "# Job Application Assistant for Ada Lovelace\n\n"
        "## Candidate Profile\n\n### Identity\n- **Name:** Ada Lovelace\n"
        "- **Location:** London hybrid\n- **Status:** Employed\n\n"
        "### Technical Skills\n- **Primary:** Python\n",
        encoding="utf-8",
    )
    (candidate / "01-candidate-profile.md").write_text(
        "# Candidate Profile\n\n## Identity\n- **Name:** Ada Lovelace\n"
        "- **Location:** London hybrid\n- **Status:** Employed\n",
        encoding="utf-8",
    )
    (root / "cv/main_example.tex").write_text(
        "\\documentclass{moderncv}\\name{Ada}{Lovelace}\\begin{document}\\end{document}\n",
        encoding="utf-8",
    )


@pytest.fixture
def live_server(tmp_path):
    profile_root = tmp_path / "profile"
    _write_profile_root(profile_root)
    port = _free_port()
    settings = Settings(
        db_path=tmp_path / "onboarding-job-tour.sqlite3", host="127.0.0.1", port=port,
        profile_root=str(profile_root), documents_root=tmp_path / "documents",
    )
    app = create_app(settings)
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
        raise RuntimeError("Uvicorn job-tour fixture did not start")

    conn = connect(settings.db_path)
    ensure_profile_workspace(conn)
    result = create_job_from_source_record(
        conn, company="Acme Robotics", title="Data Engineer",
        source_record={
            "schema_version": "job-source-record.v0", "source": "manual-paste",
            "captured_at": "2026-08-28T00:00:00+00:00", "company": "Acme Robotics",
            "title": "Data Engineer", "raw_text": POSTING_TEXT,
        },
    )
    conn.close()

    yield SimpleNamespace(
        base_url=f"http://127.0.0.1:{port}", db_path=settings.db_path,
        workspace_id=result["workspace"]["id"],
    )
    server.should_exit = True
    thread.join(timeout=10)


def _dismiss_auto_triggered_job_workflow_tour(page) -> None:
    """Since Bundle B, job_workflow_intro auto-opens on first visit to a
    workspace page -- dismiss it via Skip so a test's own manual "Take
    the tour" click opens a single, uncontested popover."""
    if page.locator(".onboarding-popover").count():
        page.get_by_role("button", name="Skip").click()
        page.wait_for_selector(".onboarding-popover", state="detached")


def test_job_workflow_tour_walks_all_five_real_targets_in_journey_order(live_server, page):
    page.goto(
        f"{live_server.base_url}/workspaces/{live_server.workspace_id}",
        wait_until="networkidle",
    )
    _dismiss_auto_triggered_job_workflow_tour(page)
    page.get_by_role("button", name="Take the tour").first.click()
    page.wait_for_selector(".onboarding-popover")
    expected_titles = [
        "This is where the job stands.",
        "Start with exactly what was posted.",
        "See the evidence behind the verdict.",
        "What's confident enough to propose.",
        "This answers the one question that matters.",
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


def test_job_workflow_tour_does_not_mutate_workspace_or_run_any_analysis_stage(live_server, page):
    page.goto(
        f"{live_server.base_url}/workspaces/{live_server.workspace_id}",
        wait_until="networkidle",
    )
    conn = connect(live_server.db_path)
    workspace_before = get_workspace(conn, live_server.workspace_id)
    conn.close()

    _dismiss_auto_triggered_job_workflow_tour(page)
    page.get_by_role("button", name="Take the tour").first.click()
    page.wait_for_selector(".onboarding-popover")
    for _ in range(4):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    conn = connect(live_server.db_path)
    workspace_after = get_workspace(conn, live_server.workspace_id)
    # No Understanding/Fit/Intelligence artifact rows appear: the exactly
    # one job_posting_snapshot artifact created at fixture setup is the
    # simplest single proof that nothing wrote through this workspace as
    # a side effect of the tour.
    artifact_count = conn.execute(
        "SELECT COUNT(*) FROM artifacts WHERE workspace_id = ?",
        (live_server.workspace_id,),
    ).fetchone()[0]
    conn.close()
    assert workspace_after["updated_at"] == workspace_before["updated_at"]
    assert artifact_count == 1


def test_job_workflow_tour_fails_gracefully_on_a_missing_target(live_server, page):
    page.goto(
        f"{live_server.base_url}/workspaces/{live_server.workspace_id}",
        wait_until="networkidle",
    )
    # Simulate a rerendered/stale page by removing the second step's real
    # target before advancing to it -- proves the mechanism against this
    # ticket's actual content, not a synthetic walkthrough.
    _dismiss_auto_triggered_job_workflow_tour(page)
    page.get_by_role("button", name="Take the tour").first.click()
    page.wait_for_selector(".onboarding-popover")
    page.evaluate("document.getElementById('job-posting').remove()")
    page.get_by_role("button", name="Next").click()
    page.wait_for_selector(".onboarding-fail-notice")
    assert page.locator(".onboarding-popover").count() == 0
    # the underlying page must remain fully usable
    page.locator('[data-onboarding-target="workspace-stepper"]').scroll_into_view_if_needed()
    assert page.locator('[data-onboarding-target="workspace-stepper"]').is_visible()


def test_existing_job_workflow_controls_are_unchanged(live_server, page):
    # Regression proof that adding onboarding content did not alter the
    # real workflow: the stage-action buttons the product already had
    # (Run Understanding, extension picker, etc.) are still present and
    # enabled exactly as before -- Ticket 4 added no business logic.
    page.goto(
        f"{live_server.base_url}/workspaces/{live_server.workspace_id}",
        wait_until="networkidle",
    )
    assert page.get_by_role("button", name="Run Understanding").is_visible()
    assert page.locator("#job-fit").count() == 1
    assert page.locator("#application-intelligence").count() == 1
    assert page.locator(".readiness-panel").count() == 1
