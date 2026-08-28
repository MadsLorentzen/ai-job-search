"""Cumulative Bundle B acceptance: the complete onboarding system proven
end-to-end via the corrected launcher/replay model, plus the full-list
mutation-guard sweep."""
from __future__ import annotations

from tests.webapp.test_browser_smoke import (
    _click_reload,
    _confirm_pack,
    _refresh_profile,
    _resolve_all_pending_reviews,
    _run_to_intelligence,
    live_server,
)
from webapp.persistence.db import connect
from webapp.persistence.workflow import list_workflow_events
from webapp.persistence.workspaces import get_workspace, list_workspaces


def test_driving_every_walkthrough_via_its_real_launcher_flow_causes_zero_underlying_mutation(
    live_server, page
):
    _refresh_profile(page, live_server)
    workspace_url = _run_to_intelligence(page, live_server)
    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    _confirm_pack(page)
    workspace_id = workspace_url.rsplit("/", 1)[-1]

    conn = connect(live_server.db_path)
    workspace_before = get_workspace(conn, workspace_id)
    workflow_events_before = list_workflow_events(conn, workspace_id)
    workspace_count_before = len(list_workspaces(conn))
    render_url = f"{live_server.base_url}/api/workspaces/{workspace_id}/application-pack/render/cv"
    pack_bytes_before = page.request.get(render_url).body()
    conn.close()

    # Dashboard: genuinely first use here (the pipeline above never
    # visited "/").
    page.goto(live_server.base_url + "/", wait_until="networkidle")
    if page.locator(".onboarding-popover").count():
        for _ in range(3):
            page.get_by_role("button", name="Next").click()
            page.wait_for_timeout(150)
        page.get_by_role("button", name="Finish").click()
        page.wait_for_selector(".onboarding-popover", state="detached")

    # Candidate Profile: launch from Help.
    page.goto(live_server.base_url + "/walkthroughs", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("table tbody tr", has_text="Your Candidate Profile").get_by_role(
            "link"
        ).click()
    if page.locator(".onboarding-popover").count():
        page.get_by_role("button", name="Skip").click()
        page.wait_for_selector(".onboarding-popover", state="detached")

    # Job workflow: launch from Help, choose the one real workspace. The
    # workspace is already "drafted" (post-confirm), which the Dashboard's
    # default "active" filter excludes (active == workflow_status is
    # None) -- switch to the "All" filter so the row is actually visible
    # to click, matching what a real user would do to find a drafted job.
    page.goto(live_server.base_url + "/walkthroughs", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("table tbody tr", has_text="Working a job through JobSearch").get_by_role(
            "link"
        ).click()
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("link", name="All").click()
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("a.row-link").first.click()
    page.wait_for_timeout(300)
    if page.locator(".onboarding-popover").count():
        page.get_by_role("button", name="Skip").click()
        page.wait_for_selector(".onboarding-popover", state="detached")

    # Document workflow: same launcher path, same filter concern.
    page.goto(live_server.base_url + "/walkthroughs", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("table tbody tr", has_text="Your CV and cover letter").get_by_role(
            "link"
        ).click()
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("link", name="All").click()
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("a.row-link").first.click()
    page.wait_for_timeout(300)
    if page.locator(".onboarding-popover").count():
        page.get_by_role("button", name="Skip").click()
        page.wait_for_selector(".onboarding-popover", state="detached")

    conn = connect(live_server.db_path)
    workspace_after = get_workspace(conn, workspace_id)
    workflow_events_after = list_workflow_events(conn, workspace_id)
    workspace_count_after = len(list_workspaces(conn))
    conn.close()
    pack_bytes_after = page.request.get(render_url).body()

    assert workspace_after == workspace_before
    assert len(workflow_events_after) == len(workflow_events_before)
    assert workspace_count_after == workspace_count_before
    assert pack_bytes_after == pack_bytes_before
    assert page.locator('input[type="checkbox"][name*="legal"]').count() == 0
    # Precise, not a substring match: "Confirm selected files -- does not
    # submit", an upload form's type="submit" button labeled "Upload",
    # and "Mark applied -- I submitted externally" all legitimately
    # contain "submit"/"submitted" as text without being an actual
    # application-submission control -- the real invariant is that no
    # button's own visible label is literally "Submit".
    assert page.get_by_role("button", name="Submit", exact=True).count() == 0


def test_existing_full_journey_still_reaches_applied_status_after_a_full_onboarding_pass(
    live_server, page
):
    _refresh_profile(page, live_server)
    workspace_url = _run_to_intelligence(page, live_server)
    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    _confirm_pack(page)
    page.goto(workspace_url, wait_until="networkidle")
    if page.locator(".onboarding-popover").count():
        page.get_by_role("button", name="Skip").click()
        page.wait_for_selector(".onboarding-popover", state="detached")
    mark_applied = page.get_by_role("button", name="Mark applied — I submitted externally")
    page.once("dialog", lambda dialog: dialog.accept())
    _click_reload(page, mark_applied)
    assert page.get_by_text("applied", exact=False).first.is_visible()
