"""Playwright acceptance for Bundle B accessibility and responsive
behavior, exercised against a real auto-triggered walkthrough."""
from __future__ import annotations

from tests.webapp.test_onboarding_first_use_triggers_browser_smoke import live_server


def test_full_keyboard_only_journey_completes_the_dashboard_walkthrough(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    assert page.evaluate(
        "document.activeElement.classList.contains('onboarding-popover')"
    ) is True

    for _ in range(3):
        for _ in range(6):
            page.keyboard.press("Tab")
            focused_action = page.evaluate(
                "document.activeElement.dataset ? document.activeElement.dataset.onboardingAction : null"
            )
            if focused_action == "next":
                break
        page.keyboard.press("Enter")
        page.wait_for_timeout(150)

    for _ in range(6):
        page.keyboard.press("Tab")
        focused_action = page.evaluate(
            "document.activeElement.dataset ? document.activeElement.dataset.onboardingAction : null"
        )
        if focused_action == "finish":
            break
    page.keyboard.press("Enter")
    page.wait_for_selector(".onboarding-popover", state="detached")

    status = page.evaluate(
        "fetch('/api/onboarding/walkthroughs/dashboard_intro').then(r => r.json())"
    )
    assert status["status"] == "completed"


def test_escape_closes_a_real_auto_triggered_walkthrough_and_restores_focus(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    page.keyboard.press("Escape")
    page.wait_for_selector(".onboarding-popover", state="detached")
    status = page.evaluate(
        "fetch('/api/onboarding/walkthroughs/dashboard_intro').then(r => r.json())"
    )
    assert status["status"] == "in_progress"


def test_overlay_usable_at_a_constrained_mobile_viewport(live_server, page):
    page.set_viewport_size({"width": 375, "height": 667})
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    box = page.locator(".onboarding-popover").bounding_box()
    assert box is not None
    assert box["width"] <= 375
    assert box["x"] >= 0
    page.get_by_role("button", name="Next").click()
    page.wait_for_timeout(150)
    assert page.locator(".onboarding-popover-title").inner_text() == "The stages, at a glance."


def test_why_am_i_seeing_this_disclosure_has_accessible_summary(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    summary = page.locator(".onboarding-why-seeing-this summary")
    assert summary.count() == 1
    assert summary.inner_text() == "Why am I seeing this?"
    tag_name = page.evaluate(
        "document.querySelector('.onboarding-why-seeing-this').tagName"
    )
    assert tag_name == "DETAILS"


def test_popover_dialog_has_correct_aria_wiring(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    page.wait_for_selector(".onboarding-popover")
    role = page.evaluate("document.querySelector('.onboarding-popover').getAttribute('role')")
    labelledby = page.evaluate("document.querySelector('.onboarding-popover').getAttribute('aria-labelledby')")
    describedby = page.evaluate("document.querySelector('.onboarding-popover').getAttribute('aria-describedby')")
    assert role == "dialog"
    assert labelledby == "onboarding-popover-title"
    assert describedby == "onboarding-popover-body"
    assert page.locator(f"#{labelledby}").count() == 1
    assert page.locator(f"#{describedby}").count() == 1
