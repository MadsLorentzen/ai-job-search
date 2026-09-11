"""Playwright acceptance for the Bundle A document workflow walkthrough --
real target resolution across the actual document journey, upload/select/
confirm staying distinct, historical-pack immutability surviving the
tour, graceful failure, and zero document-workflow API calls made by the
walkthrough itself.

Reuses tests/webapp/test_browser_smoke.py's proven page-driven helpers
and fake providers rather than re-deriving fixture/provider setup here --
GET /api/workspaces/{id} returns only the bare workspace row (see
webapp/api/workspaces.py:84-97), never the rich view-model data
(pending_review_items, document_finalization.versions) the Jinja
template renders, so there is no JSON contract to script against
directly; the state this bundle's tests need can only be reached by
driving the real pages, exactly as test_browser_smoke.py already does.
"""
from __future__ import annotations

import json

from tests.webapp.test_browser_smoke import (
    _confirm_pack,
    _refresh_profile,
    _resolve_all_pending_reviews,
    _run_to_intelligence,
    live_server,
)


def _generated_workspace_url(page, live_server) -> str:
    """Refreshes the Evidence Profile (required before Job Fit will run --
    see test_browser_smoke.py, which calls this before every test that
    reaches Job Fit), runs the job through to Application Intelligence,
    resolves reviews, and generates documents. Stops short of selecting
    or confirming, so tests can drive step 4 ("Choose the documents to
    use") against a real, populated document-select button."""
    _refresh_profile(page, live_server)
    workspace_url = _run_to_intelligence(page, live_server)
    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    page.goto(workspace_url, wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Generate AI documents").click()
    return workspace_url


def _confirmed_workspace_url(page, live_server) -> str:
    """Drives the exact same generate -> select AI original -> confirm
    sequence tests/webapp/test_browser_smoke.py proves end-to-end, via
    _confirm_pack, to reach a state with one confirmed pack."""
    _refresh_profile(page, live_server)
    workspace_url = _run_to_intelligence(page, live_server)
    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    _confirm_pack(page)
    return workspace_url


def _start_and_walk_tour(page, expected_titles: list[str]) -> None:
    page.get_by_role("button", name="Take the tour").nth(1).click()
    page.wait_for_selector(".onboarding-popover")
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


EXPECTED_TITLES = [
    "Your CV and cover letter, your call.",
    "Generate your documents.",
    "Edit them if you want, then upload your version.",
    "Choose the documents to use.",
    "Confirm your selection.",
]


def test_document_tour_walks_all_five_real_targets_in_journey_order(live_server, page):
    # Documents must already be generated for step 4's real "Use this
    # version" button to exist -- a workspace with zero document versions
    # renders no such button (see workspace_detail.html's per-version
    # loop), so this test drives generation (not confirmation) first.
    _generated_workspace_url(page, live_server)
    _start_and_walk_tour(page, EXPECTED_TITLES)


def test_document_tour_never_calls_any_document_workflow_api_route(live_server, page):
    _generated_workspace_url(page, live_server)

    seen_urls = []
    page.on("request", lambda request: seen_urls.append(request.url))

    _start_and_walk_tour(page, EXPECTED_TITLES)

    forbidden_fragments = [
        "/application-documents/generate",
        "/application-documents/upload/",
        "/application-documents/selection/",
        "/application-pack",
    ]
    violations = [
        url for url in seen_urls if any(fragment in url for fragment in forbidden_fragments)
    ]
    assert violations == [], f"walkthrough triggered document-workflow API calls: {violations}"


def test_document_tour_does_not_touch_a_previously_confirmed_packs_bytes(live_server, page):
    workspace_url = _confirmed_workspace_url(page, live_server)
    workspace_id = workspace_url.rsplit("/", 1)[-1]

    # page.request shares the browser context's session/cookies but never
    # navigates the page itself -- the right tool for fetching raw bytes
    # from a file-download endpoint without disturbing page state.
    render_url = f"{live_server.base_url}/api/workspaces/{workspace_id}/application-pack/render/cv"
    bytes_before = page.request.get(render_url).body()

    page.goto(workspace_url, wait_until="networkidle")
    _start_and_walk_tour(page, EXPECTED_TITLES)

    bytes_after = page.request.get(render_url).body()
    assert bytes_after == bytes_before


def test_document_tour_fails_gracefully_on_a_missing_target(live_server, page):
    _generated_workspace_url(page, live_server)

    page.get_by_role("button", name="Take the tour").nth(1).click()
    page.wait_for_selector(".onboarding-popover")
    page.evaluate(
        "document.querySelector('.document-generate.confirm-pack').remove()"
    )
    page.get_by_role("button", name="Next").click()
    page.wait_for_selector(".onboarding-fail-notice")
    assert page.locator(".onboarding-popover").count() == 0
    assert page.locator(".gate-four.document-finalization").is_visible()


def test_choose_step_targets_the_cv_panels_button(live_server, page):
    _generated_workspace_url(page, live_server)

    page.get_by_role("button", name="Take the tour").nth(1).click()
    page.wait_for_selector(".onboarding-popover")
    for _ in range(3):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.wait_for_function(
        "document.querySelector('.onboarding-popover-title').innerText === 'Choose the documents to use.'"
    )
    inside_cv_panel = page.evaluate(
        "document.querySelector('.document-select')"
        ".closest('[data-document-kind]').dataset.documentKind === 'cv'"
    )
    assert inside_cv_panel is True
