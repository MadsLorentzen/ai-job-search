"""Playwright acceptance for the Ticket 2 shared onboarding overlay."""
from __future__ import annotations

import socket
import threading
import time
from types import SimpleNamespace

import pytest
import uvicorn

from product.onboarding import WalkthroughDefinition, WalkthroughStep, register_walkthrough
from webapp.app import create_app
from webapp.config import Settings


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(autouse=True)
def _register_overlay_test_walkthrough():
    register_walkthrough(
        WalkthroughDefinition(
            walkthrough_id="overlay_smoke_walkthrough",
            version=1,
            title="Overlay smoke walkthrough",
            steps=(
                WalkthroughStep(
                    step_id="s0", target='[data-onboarding-target="dashboard-link"]',
                    title="Dashboard", body="This takes you back to your pipeline.",
                    placement="bottom",
                ),
                WalkthroughStep(
                    step_id="s1", target='[data-onboarding-target="add-job-button"]',
                    title="Add a job", body="Start a new application from here.",
                    placement="bottom",
                ),
            ),
        )
    )


@pytest.fixture
def live_server(tmp_path):
    port = _free_port()
    settings = Settings(
        db_path=tmp_path / "onboarding-overlay.sqlite3", host="127.0.0.1", port=port,
        documents_root=tmp_path / "documents",
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
        raise RuntimeError("Uvicorn onboarding overlay fixture did not start")
    yield SimpleNamespace(base_url=f"http://127.0.0.1:{port}")
    server.should_exit = True
    thread.join(timeout=10)


def test_overlay_renders_spotlight_and_popover_on_start(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-popover-title").inner_text() == "Dashboard"
    assert page.locator(".onboarding-popover-body").inner_text() == (
        "This takes you back to your pipeline."
    )
    assert page.locator(".onboarding-spotlight").is_visible()


def test_overlay_next_advances_to_step_two_and_repositions(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    page.get_by_role("button", name="Next").click()
    page.wait_for_function(
        "document.querySelector('.onboarding-popover-title').innerText === 'Add a job'"
    )
    # .onboarding-popover-progress is styled text-transform:uppercase, which
    # is what inner_text() reports (the rendered text, not the DOM source).
    assert page.locator(".onboarding-popover-progress").inner_text().strip() == "STEP 2 OF 2"


def test_overlay_finish_on_last_step_closes_overlay(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    page.get_by_role("button", name="Next").click()
    page.wait_for_function(
        "document.querySelector('.onboarding-popover-title').innerText === 'Add a job'"
    )
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")
    assert page.locator(".onboarding-backdrop").count() == 0


def test_replaying_a_completed_walkthrough_reopens_it(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    page.get_by_role("button", name="Next").click()
    page.wait_for_function(
        "document.querySelector('.onboarding-popover-title').innerText === 'Add a job'"
    )
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    assert page.locator(".onboarding-popover-title").inner_text() == "Dashboard"


def test_escape_key_closes_overlay_and_restores_focus(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.locator('[data-onboarding-target="add-job-button"]').focus()
    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    page.keyboard.press("Escape")
    page.wait_for_selector(".onboarding-popover", state="detached")
    assert page.evaluate(
        "document.activeElement.getAttribute('data-onboarding-target')"
    ) == "add-job-button"


def test_focus_moves_into_popover_on_open(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    assert page.evaluate(
        "document.activeElement.classList.contains('onboarding-popover')"
    ) is True


def test_tab_cycles_within_popover_without_escaping_to_page(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    focusable_count = page.evaluate(
        "document.querySelectorAll('.onboarding-popover button').length"
    )
    for _ in range(focusable_count + 2):
        page.keyboard.press("Tab")
    assert page.evaluate(
        "document.activeElement.closest('.onboarding-popover') !== null"
    ) is True


def test_missing_target_fails_gracefully_without_breaking_the_page(live_server, page):
    register_walkthrough(
        WalkthroughDefinition(
            walkthrough_id="overlay_missing_target_walkthrough",
            version=1,
            title="Missing target walkthrough",
            steps=(
                WalkthroughStep(
                    step_id="s0", target='[data-onboarding-target="does-not-exist-anywhere"]',
                    title="Ghost step", body="This target will never be found.",
                ),
            ),
        )
    )
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.evaluate("window.Onboarding.start('overlay_missing_target_walkthrough')")
    page.wait_for_selector(".onboarding-fail-notice")
    assert page.locator(".onboarding-popover").count() == 0
    # the underlying page must remain fully usable
    page.locator('[data-onboarding-target="add-job-button"]').click()
    page.wait_for_url("**/new-job")


def test_dont_show_again_checkbox_skips_with_that_reason(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    page.locator('[data-onboarding-dont-show-again]').check()
    page.get_by_role("button", name="Skip").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    status = page.evaluate(
        "fetch('/api/onboarding/walkthroughs/overlay_smoke_walkthrough')"
        ".then(r => r.json())"
    )
    assert status["dismissal_reason"] == "dont_show_again"


def test_overlay_repositions_on_viewport_resize(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.evaluate("window.Onboarding.start('overlay_smoke_walkthrough')")
    page.wait_for_selector(".onboarding-popover")
    before = page.locator(".onboarding-popover").bounding_box()
    page.set_viewport_size({"width": 480, "height": 760})
    page.wait_for_function(
        """() => {
            const el = document.querySelector('.onboarding-popover');
            return el && el.getBoundingClientRect().width <= window.innerWidth;
        }"""
    )
    after = page.locator(".onboarding-popover").bounding_box()
    assert after["width"] <= 480
    assert before is not None and after is not None
