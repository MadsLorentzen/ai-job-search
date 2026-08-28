"""Playwright acceptance for Bundle B first-use auto-trigger behavior."""
from __future__ import annotations

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
from webapp.persistence.workspaces import ensure_profile_workspace
from webapp.services.pipeline import create_job_from_source_record


POSTING_TEXT = "Python is required.\nBuild reliable data pipelines.\n"


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
        "- **Location:** London hybrid\n- **Status:** Employed\n",
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
        db_path=tmp_path / "onboarding-triggers.sqlite3", host="127.0.0.1", port=port,
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
        raise RuntimeError("Uvicorn triggers fixture did not start")
    yield SimpleNamespace(base_url=f"http://127.0.0.1:{port}", db_path=settings.db_path)
    server.should_exit = True
    thread.join(timeout=10)


@pytest.fixture
def live_server_with_job(live_server):
    conn = connect(live_server.db_path)
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
    live_server.workspace_id = result["workspace"]["id"]
    return live_server


def test_dashboard_walkthrough_auto_opens_on_first_visit(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-popover-title").inner_text() == "This is your pipeline."


def test_why_am_i_seeing_this_shows_for_auto_trigger_but_not_manual_start(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-why-seeing-this").count() == 1

    for _ in range(3):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")
    page.evaluate("window.Onboarding.start('dashboard_intro')")
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-why-seeing-this").count() == 0


def test_completed_dashboard_walkthrough_does_not_reopen_on_next_visit(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    for _ in range(3):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_timeout(500)
    assert page.locator(".onboarding-popover").count() == 0


def test_skipped_dashboard_walkthrough_does_not_reopen_on_next_visit(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    page.get_by_role("button", name="Skip").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_timeout(500)
    assert page.locator(".onboarding-popover").count() == 0


def test_navigating_away_mid_tour_does_not_mark_it_complete_and_does_not_reopen_it(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    page.get_by_role("button", name="Next").click()
    page.wait_for_timeout(150)
    page.goto(live_server.base_url + "/profile", wait_until="networkidle")

    status = page.evaluate(
        "fetch('/api/onboarding/walkthroughs/dashboard_intro').then(r => r.json())"
    )
    assert status["status"] == "in_progress"
    assert status["current_step_index"] == 1

    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_timeout(500)
    assert page.locator(".onboarding-popover").count() == 0


def test_job_workflow_walkthrough_auto_opens_on_first_visit_to_a_workspace(live_server_with_job, page):
    page.goto(
        f"{live_server_with_job.base_url}/workspaces/{live_server_with_job.workspace_id}",
        wait_until="networkidle",
    )
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-popover-title").inner_text() == "This is where the job stands."


def test_document_workflow_walkthrough_does_not_auto_open_on_workspace_page(live_server_with_job, page):
    page.goto(
        f"{live_server_with_job.base_url}/workspaces/{live_server_with_job.workspace_id}",
        wait_until="networkidle",
    )
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-popover-title").inner_text() != "Your CV and cover letter, your call."
    page.get_by_role("button", name="Skip").click()
    page.wait_for_selector(".onboarding-popover", state="detached")
    page.wait_for_timeout(500)
    assert page.locator(".onboarding-popover").count() == 0
