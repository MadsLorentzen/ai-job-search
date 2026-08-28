# Onboarding Bundle A: CV/Cover-Letter Document Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fourth contextual walkthrough — the accepted user-managed
document workflow (generate → edit externally → upload → choose → confirm,
with immutability explained at confirmation) — as pure data registered
against the Ticket 1 engine and rendered by the Ticket 2 overlay, following
the pattern Tickets 3-4 established. No new document-finalization
behavior, no workspace-detail redesign, no data mutation from walking
through the tour, and no internal vocabulary (hash/artifact/blob/pack/
snapshot/frozen) in any walkthrough copy.

**Scope note — the application-handoff/extension walkthrough (originally
also part of this bundle) is NOT implemented here.** Research confirmed
the webapp renders no real UI to attach it to: no "Connect extension"
page, no pairing UI, no session-status view exist anywhere in
`webapp/templates/` — the design spec describes such a page but it was
never built, and the browser extension has no popup UI either. Ticket 2's
overlay only runs inside webapp pages. Building new webapp UI to give
onboarding something to point at would violate "do not redesign
underlying product workflows for onboarding" and "use real UI targets
only" simultaneously — there is no way to satisfy both constraints for
this half of the original ticket as scoped. This gap is reported in this
plan's final task rather than worked around by inventing UI or targeting
non-webapp surfaces the overlay mechanism cannot reach.

**Architecture:** `product/onboarding_walkthroughs.py` (from Ticket 3,
extended in Ticket 4) gains one more `WalkthroughDefinition`,
`DOCUMENT_WORKFLOW_WALKTHROUGH`, registered by the same
`register_default_walkthroughs()`. `webapp/templates/workspace_detail.html`
gains zero new `data-onboarding-target` attributes — every one of this
walkthrough's five steps targets a selector that already exists for its
own reason (`.gate-four.document-finalization`,
`.document-generate.confirm-pack`, `.document-kind-grid`,
`.document-select`, `.confirm-documents`). The existing "Take the tour"
button already added to the workspace header in Ticket 4 is reused
unchanged — this bundle does not add a second trigger button to the same
page; instead a `data-onboarding-start` attribute is added to a small,
new, clearly-labeled second link placed directly beside the document
section's own heading, so a user already deep in the document area does
not have to scroll back to the page header to start this specific tour
(see Task 2 for the exact placement rationale).

**Tech Stack:** Same as Tickets 1-4 — Python/FastAPI/Jinja2, vanilla JS,
pytest + pytest-playwright for acceptance.

**Spec:** The consolidated Bundle A instructions (conversation-supplied),
covering original Tickets 5 and 6 of the contextual-onboarding stream —
Ticket 6 (handoff/extension) is descoped per the scope note above and
reported, not implemented. Builds on
`docs/superpowers/plans/2026-08-27-onboarding-ticket1-state-engine.md`
through `...-ticket4-job-workflow-walkthrough.md`.

## Global Constraints

- Frozen baseline commit: `12224eeb6d401209ed0da6fe1360fc90a722bc98`. Work
  happens only on branch `feature/contextual-onboarding` in worktree
  `C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`.
  Never touch `master` or any other worktree.
- Ticket 4 is accepted at `8c0e07f0718d7c43efd7db5fab656666cd66950d`
  (`HEAD` at the start of this bundle).
- Five steps, mapping exactly to the approved journey:
  1. Orient to the document area.
  2. Generate documents.
  3. Edit externally if desired, then upload a preferred version (upload
     never auto-selects).
  4. Explicitly choose the CV and cover letter to use.
  5. Confirm the exact selection — copy explains that confirmed versions
     stay fixed afterward, without using the words "frozen," "artifact,"
     "pack," or "snapshot."
- Do not add a sixth step targeting `.pack-downloads` or any other
  conditionally-rendered-only-after-confirmation element. Immutability is
  explained in step 5's copy, not demonstrated by a step that would
  fail-gracefully for every first-time visitor.
- User-facing language only: "Generate your documents," "Edit them if you
  want," "Upload your preferred version," "Choose the documents to use,"
  "Confirm your selection." Never expose hashes, artifact IDs, frozen-blob
  concepts, renderer internals, or evidence-store mechanics — confirmed by
  research that none of that leaks into the rendered template today,
  so the walkthrough must hold that same bar.
- Do not resurrect the rejected governed document editor. Confirmed by
  research: this worktree contains zero in-app rich-text/WYSIWYG editing
  UI, and the branches with that rejected work
  (`design/manual-document-editing-presentation`,
  `feature/manual-document-editing-presentation`) live in other
  worktrees, never merged into this branch. Do not reference, import, or
  describe an in-app editor anywhere in this bundle's copy or code.
- Must not mutate job/application/profile/document data. The only network
  calls a running walkthrough makes are to `/api/onboarding/*` (already
  proven safe in Tickets 2-4). No walkthrough content or script in this
  bundle may call any other API route — specifically never
  `/application-documents/generate`, `/application-documents/upload/*`,
  `/application-documents/selection/*`, or `/application-pack`.
- Every target in this bundle must already exist in
  `workspace_detail.html` for its own reason. No new
  `data-onboarding-target` attributes are needed on the five journey
  steps; only the one new trigger link (Task 2) is new markup, and it is
  a trigger, not a walkthrough target.
- Follow existing repo conventions: Jinja2 templates, the existing
  `[data-onboarding-start]` generic click handler in
  `webapp/static/onboarding.js` (no changes needed to that file this
  bundle), pytest + pytest-playwright acceptance tests following
  `tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py`'s
  pattern and its `create_job_from_source_record` / `cv/main_example.tex`
  fixture requirements.
- Before the first write in this worktree, and again before every commit,
  verify: `git rev-parse --show-toplevel`, `git branch --show-current`,
  `git rev-parse HEAD`, `git status --short`. Expected: this worktree path,
  branch `feature/contextual-onboarding`, HEAD `8c0e07f` (until Task 1's
  commit) then advancing one commit per task, clean status. Stop on drift.
- Do not push. Do not merge.

---

## File Structure

- **Modify:** `product/onboarding_walkthroughs.py` — add
  `DOCUMENT_WORKFLOW_WALKTHROUGH` and register it from
  `register_default_walkthroughs()`.
- **Modify:** `webapp/templates/workspace_detail.html` — add one small
  `data-onboarding-start="document_workflow_intro"` trigger link beside
  the "Final application documents" heading (Task 2). Zero new
  `data-onboarding-target` attributes.
- **Test:** `tests/test_onboarding_walkthroughs_content.py` (extended, not
  replaced) — content assertions for the new definition, including a
  vocabulary guard that forbids leaked internal terms.
- **Test:** `tests/webapp/test_onboarding_document_walkthrough_browser_smoke.py`
  — Playwright acceptance proving real target resolution across the
  actual document journey, that upload stays distinct from selection and
  selection stays distinct from confirmation, that a previously confirmed
  pack's downloadable bytes are unchanged by merely running the tour, that
  a missing target fails gracefully, and that zero document-workflow API
  routes are called by the tour.

No changes to `product/onboarding.py`, `webapp/services/onboarding.py`,
`webapp/persistence/onboarding.py`, `webapp/api/onboarding.py`,
`webapp/static/onboarding.js`, or `webapp/static/onboarding.css` — the
generic trigger/overlay mechanism needs no changes to carry this
bundle's content.

---

## Walkthrough content

### Document workflow (`walkthrough_id="document_workflow_intro"`)

Five steps, targeting elements that already exist in
`webapp/templates/workspace_detail.html` (line numbers as of Ticket 4's
final state — `git blame` before editing to confirm they have not moved):

1. `.gate-four.document-finalization` (line 59, the whole document area)
   — "Your CV and cover letter, your call." / "JobSearch prepares Word
   files you can generate, edit, or replace. Nothing here is submitted
   anywhere until you choose to."
2. `.document-generate.confirm-pack` (line 60, "Generate AI documents"
   button) — "Generate your documents." / "JobSearch writes a CV and
   cover letter from your reviewed evidence. You can always replace them
   with your own."
3. `.document-kind-grid` (line 62, wraps both the CV and cover-letter
   panels including their upload forms) — "Edit them if you want, then
   upload your version." / "Download a generated file, edit it in Word,
   and upload your preferred version here. Uploading never selects a
   file automatically -- that's always your next, separate step."
4. `.document-select` (line 63, the first "Use this version" button
   `document.querySelector` resolves — see Task 1 Step 1 for why
   targeting a repeated class is acceptable here) — "Choose the documents
   to use." / "Pick the exact CV and the exact cover letter you want for
   this application -- an AI original or one you uploaded."
5. `.confirm-documents` (line 67, "Confirm selected files — does not
   submit" button) — "Confirm your selection." / "Once you confirm,
   JobSearch keeps those exact CV and cover-letter versions with this
   application. Earlier confirmed versions stay exactly as they were and
   remain available later."

---

### Task 1: Walkthrough content, target verification, and registration

**Files:**
- Modify: `product/onboarding_walkthroughs.py`
- Test: `tests/test_onboarding_walkthroughs_content.py` (extended)

**Interfaces:**
- Consumes: `product.onboarding.{WalkthroughDefinition, WalkthroughStep}`
  (Ticket 1); the existing `register_default_walkthroughs()` function body
  (Ticket 3/4) — this task adds one more `register_walkthrough(...)` call
  inside it.
- Produces (for Task 2's template work and Task 3's acceptance tests):
  - `DOCUMENT_WORKFLOW_WALKTHROUGH: WalkthroughDefinition`
    (`walkthrough_id = "document_workflow_intro"`)

- [ ] **Step 1: Verify the repeated-class target is acceptable before committing to it**

Read `webapp/templates/workspace_detail.html` around the current
"Generate AI documents"/document-kind-grid block (confirm exact current
line numbers first — they were 60-69 as of Ticket 4's HEAD, but re-read
before editing since intervening work may have shifted them). Confirm:
`.document-select` is applied to every "Use this version" button across
both document-kind panels and any cross-workspace reusable-file rows —
i.e., there can be more than one element matching this selector on the
page. Ticket 2's `_renderStep()` calls `document.querySelector(step.target)`,
which resolves to the *first* matching element in document order — for a
freshly generated workspace with no uploads yet, this is deterministically
the CV panel's "Use this version" button for the sole AI-generated CV
version, which is exactly the control step 4's copy describes ("Pick the
exact CV..."). This is acceptable specifically because: (a) the first
match is always inside the CV panel (document order: CV panel before
cover-letter panel, per the `[('cv', 'CV'), ('cover_letter', 'Cover
letter')]` loop), so the highlighted control is never ambiguous or
wrong-labeled; (b) Task 3's acceptance test asserts the actual highlighted
element is inside the `[data-document-kind="cv"]` panel, catching a
future template reordering that would break this assumption. No code
change in this step — this is a verification gate before Task 1 Step 3.

- [ ] **Step 2: Write the failing content test**

Add to `tests/test_onboarding_walkthroughs_content.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_onboarding_walkthroughs_content.py -v -k document_workflow`
Expected: FAIL — `ImportError: cannot import name 'DOCUMENT_WORKFLOW_WALKTHROUGH'`

- [ ] **Step 4: Add the walkthrough definition**

In `product/onboarding_walkthroughs.py`, add after
`JOB_WORKFLOW_WALKTHROUGH`:

```python
DOCUMENT_WORKFLOW_WALKTHROUGH = WalkthroughDefinition(
    walkthrough_id="document_workflow_intro",
    version=1,
    title="Your CV and cover letter",
    steps=(
        WalkthroughStep(
            step_id="overview",
            target='.gate-four.document-finalization',
            title="Your CV and cover letter, your call.",
            body=(
                "JobSearch prepares Word files you can generate, edit, "
                "or replace. Nothing here is submitted anywhere until "
                "you choose to."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="generate",
            target='.document-generate.confirm-pack',
            title="Generate your documents.",
            body=(
                "JobSearch writes a CV and cover letter from your "
                "reviewed evidence. You can always replace them with "
                "your own."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="edit_and_upload",
            target='.document-kind-grid',
            title="Edit them if you want, then upload your version.",
            body=(
                "Download a generated file, edit it in Word, and upload "
                "your preferred version here. Uploading never selects a "
                "file automatically -- that's always your next, "
                "separate step."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="choose",
            target='.document-select',
            title="Choose the documents to use.",
            body=(
                "Pick the exact CV and the exact cover letter you want "
                "for this application -- an AI original or one you "
                "uploaded."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="confirm",
            target='.confirm-documents',
            title="Confirm your selection.",
            body=(
                "Once you confirm, JobSearch keeps those exact CV and "
                "cover-letter versions with this application. Earlier "
                "confirmed versions stay exactly as they were and "
                "remain available later."
            ),
            placement="top",
        ),
    ),
    trigger="first_visit:document_workflow",
)
```

Update `register_default_walkthroughs()`:

```python
def register_default_walkthroughs() -> None:
    register_walkthrough(DASHBOARD_WALKTHROUGH)
    register_walkthrough(CANDIDATE_PROFILE_WALKTHROUGH)
    register_walkthrough(JOB_WORKFLOW_WALKTHROUGH)
    register_walkthrough(DOCUMENT_WORKFLOW_WALKTHROUGH)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_onboarding_walkthroughs_content.py -v`
Expected: PASS (all tests, old and new)

- [ ] **Step 6: Run relevant regression tests**

Run: `pytest tests/webapp/test_app_factory.py tests/webapp/api/test_onboarding_routes.py -v`
Expected: PASS (registering one more walkthrough doesn't change any
existing route's behavior, per the same reasoning confirmed in Ticket 4)

- [ ] **Step 7: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: worktree
`C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`,
branch `feature/contextual-onboarding`, HEAD still `8c0e07f` (no commits
yet on this bundle), status shows only the modified content module and
test file. Stop on drift.

- [ ] **Step 8: Commit**

```bash
git add product/onboarding_walkthroughs.py tests/test_onboarding_walkthroughs_content.py
git commit -m "feat(onboarding): add document workflow walkthrough content"
```

---

### Task 2: Trigger link for the document workflow tour

**Files:**
- Modify: `webapp/templates/workspace_detail.html`

**Interfaces:**
- Consumes: the exact five selector strings from Task 1's
  `DOCUMENT_WORKFLOW_WALKTHROUGH` — this task's markup change must not
  alter any of them (it adds a trigger, not a target).
- Produces: one real, visible trigger
  (`data-onboarding-start="document_workflow_intro"`), reusing the
  generic click handler already shipped in Ticket 2/3/4 — no JS changes
  in this task.

- [ ] **Step 1: Add the trigger link beside the document section heading**

Why a link beside the section heading rather than reusing the page-header
"Take the tour" button added in Ticket 4: that button is already bound to
`job_workflow_intro` and a page-level trigger can only start one
walkthrough per click. A user who has scrolled deep into the document
section (which can be far down a long workspace-detail page) needs a
second, differently-labeled entry point close to what it starts, matching
the same in-context placement precedent as every other trigger this
stream has added (each page's trigger sits next to what it introduces,
not only at the top).

In `webapp/templates/workspace_detail.html`, modify the document
section's heading line (currently: `<h3>Final application
documents</h3>`) to:

```html
<h3>Final application documents <button type="button" class="button secondary button-small" data-onboarding-start="document_workflow_intro">Take the tour</button></h3>
```

- [ ] **Step 2: Manually verify template rendering with no Jinja errors**

Run:
```
python -c "
from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace, ensure_profile_workspace
from fastapi.testclient import TestClient
import tempfile, pathlib
d = pathlib.Path(tempfile.mkdtemp())
settings = Settings(db_path=d/'t.sqlite3', documents_root=d/'documents')
app = create_app(settings)
with TestClient(app) as client:
    conn = connect(settings.db_path)
    ensure_profile_workspace(conn)
    workspace = create_workspace(conn, company='Acme', title='Engineer')
    conn.close()
    r = client.get(f'/workspaces/{workspace[\"id\"]}')
    assert r.status_code == 200, r.text
    assert 'data-onboarding-start=\"document_workflow_intro\"' in r.text
    print('ok')
"
```
Expected: prints `ok`

- [ ] **Step 3: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 1's commit, status shows only
the modified template. Stop on drift.

- [ ] **Step 4: Commit**

```bash
git add webapp/templates/workspace_detail.html
git commit -m "feat(onboarding): add trigger for document workflow tour"
```

---

### Task 3: Acceptance — real target resolution, distinct steps, immutability, no mutation

**Files:**
- Create: `tests/webapp/test_onboarding_document_walkthrough_browser_smoke.py`

**Interfaces:**
- Consumes: `window.Onboarding.start('document_workflow_intro')` (Ticket
  2), the `[data-onboarding-start]` trigger link (Task 2 of this bundle),
  `webapp.services.pipeline.create_job_from_source_record` (matching
  Ticket 4's fixture pattern) plus the document-generation/upload/select/
  confirm service functions needed to set up a realistic "already has a
  confirmed pack" scenario for the immutability assertion.
- Produces: nothing consumed by a later task — this is the bundle's final
  acceptance gate for the document walkthrough.

- [ ] **Step 1: Locate the exact service functions needed to script document generation/selection/confirmation outside the browser**

`GET /api/workspaces/{workspace_id}` returns only `{"workspace": {...}}`
— the bare workspace row (confirmed by reading
`webapp/api/workspaces.py:84-97`). The rich data the Jinja template
renders (`pending_review_items`, `document_finalization.versions`, etc.)
comes from `build_workspace_view_model`, a server-side-only view builder
never exposed as JSON anywhere. **Do not attempt to script the
generate/select/confirm sequence via raw HTTP JSON calls** — there is no
JSON endpoint that returns what would be needed to find review-item ids
or document-version ids without already having driven the page. Reaching
a "pack already confirmed" state also requires the exact fake
Understanding/Semantic/Application-Intelligence providers and the richer
profile fixture (`_write_profile_root`) already defined in
`tests/webapp/test_browser_smoke.py` — reimplementing ~150 lines of fake
providers here would risk silent mismatches against the real contract.

Instead, **import and reuse the existing, proven page-driven helpers
directly from `tests/webapp/test_browser_smoke.py`**:
`_write_profile_root`, `_UnderstandingProvider`, `_SemanticAdapter`,
`_ApplicationIntelligenceProvider`, `_create_job`, `_run_to_intelligence`,
`_resolve_all_pending_reviews`, `_confirm_pack`. These are module-private
(leading underscore) but importable across modules in Python — this repo
has no rule against it, and duplicating this much fixture logic would be
the actual violation of "match the existing acceptance test's proven path
exactly." Read `tests/webapp/test_browser_smoke.py` lines 1-450
(imports, `_write_profile_root`, `_UnderstandingProvider`,
`_SemanticAdapter`, `_ApplicationIntelligenceProvider`, `_create_job`,
`_run_to_intelligence`, `_resolve_all_pending_reviews`, `_confirm_pack`)
before writing this task's fixture, to confirm current signatures match
what Step 2 below assumes — re-derive any that have drifted rather than
guessing.

- [ ] **Step 2: Write the acceptance tests**

```python
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

import pytest

from tests.webapp.test_browser_smoke import (
    _confirm_pack,
    _resolve_all_pending_reviews,
    _run_to_intelligence,
    live_server,
)


def _confirmed_workspace_url(page, live_server) -> str:
    """Drives the exact same generate -> select AI original -> confirm
    sequence tests/webapp/test_browser_smoke.py proves end-to-end, via
    _confirm_pack, to reach a state with one confirmed pack."""
    workspace_url = _run_to_intelligence(page, live_server)
    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    _confirm_pack(page)
    return workspace_url


def test_document_tour_walks_all_five_real_targets_in_journey_order(live_server, page):
    # Documents must already be generated for step 4's real "Use this
    # version" button to exist -- a workspace with zero document versions
    # renders no such button (see workspace_detail.html's per-version
    # loop), so this test drives generation (not confirmation) first.
    workspace_url = _run_to_intelligence(page, live_server)
    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    page.goto(workspace_url, wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Generate AI documents").click()

    page.get_by_role("button", name="Take the tour").nth(1).click()
    page.wait_for_selector(".onboarding-popover")
    expected_titles = [
        "Your CV and cover letter, your call.",
        "Generate your documents.",
        "Edit them if you want, then upload your version.",
        "Choose the documents to use.",
        "Confirm your selection.",
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


def test_document_tour_never_calls_any_document_workflow_api_route(live_server, page):
    workspace_url = _run_to_intelligence(page, live_server)
    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    page.goto(workspace_url, wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Generate AI documents").click()

    seen_urls = []
    page.on("request", lambda request: seen_urls.append(request.url))

    page.get_by_role("button", name="Take the tour").nth(1).click()
    page.wait_for_selector(".onboarding-popover")
    for _ in range(4):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

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
    page.get_by_role("button", name="Take the tour").nth(1).click()
    page.wait_for_selector(".onboarding-popover")
    for _ in range(4):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    bytes_after = page.request.get(render_url).body()
    assert bytes_after == bytes_before


def test_document_tour_fails_gracefully_on_a_missing_target(live_server, page):
    workspace_url = _run_to_intelligence(page, live_server)
    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    page.goto(workspace_url, wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Generate AI documents").click()

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
    workspace_url = _run_to_intelligence(page, live_server)
    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    page.goto(workspace_url, wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Generate AI documents").click()

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
```

Note: importing the `@pytest.fixture`-decorated `live_server` function by
name from `test_browser_smoke` makes it usable as a fixture in this
module too -- a standard pytest pattern, and simpler/more robust than
re-deriving the fixture body here. `_write_profile_root`,
`_UnderstandingProvider`, `_SemanticAdapter`,
`_ApplicationIntelligenceProvider`, and `_create_job` are consumed
transitively through `live_server` and `_run_to_intelligence` and do not
need separate imports.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/webapp/test_onboarding_document_walkthrough_browser_smoke.py -v`
Expected: FAIL — "Take the tour" trigger for the document tour doesn't
exist yet (if run before Tasks 1-2 land); if run after Tasks 1-2 are
already implemented, this step instead confirms the suite already passes
(same allowance as Tickets 3-4's plans).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/webapp/test_onboarding_document_walkthrough_browser_smoke.py -v`
Expected: PASS (all 5 tests). If any test fails because
`test_browser_smoke.py`'s helper signatures (`_run_to_intelligence`,
`_resolve_all_pending_reviews`, `_confirm_pack`, `live_server`) have
drifted since this plan was written, re-read that file's current state
and adjust the imports/calls to match — do not guess further.

- [ ] **Step 5: Run the flake-check loop**

Run six times: `pytest tests/webapp/test_onboarding_document_walkthrough_browser_smoke.py -q`
Expected: PASS all six runs, 5/5 each time. Watch specifically for the
same reload-race class Ticket 3 hit (a fetch-triggering click followed
immediately by an assertion, racing a `window.location.reload()`) — none
of this bundle's own tests click the underlying document-workflow buttons
through the browser (they use direct HTTP for setup), so this class of
flake is less likely here, but confirm empirically rather than assuming.

- [ ] **Step 6: Run the full relevant regression set**

Run: `pytest tests/webapp/test_browser_smoke.py tests/webapp/test_onboarding_overlay_browser_smoke.py tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py tests/webapp/api/test_onboarding_routes.py tests/webapp/services/test_onboarding_service.py tests/webapp/persistence/test_onboarding.py -v`
Expected: PASS (no regressions in existing browser smoke -- including
`test_user_managed_documents_upload_select_confirm_replace_and_apply_exact_bytes`,
which proves the underlying document-finalization behavior this bundle's
walkthrough describes is unchanged -- or in any earlier onboarding
ticket's suite)

- [ ] **Step 7: Run the full webapp and product regression suites**

Run: `pytest tests/webapp -q` and `pytest tests -q --ignore=tests/webapp`
Expected: PASS across both. If a pre-existing failure surfaces that is
unrelated to onboarding, stop and report it distinctly rather than
folding a fix into this bundle's diff (matching the precedent from
Tickets 1-4).

- [ ] **Step 8: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 2's commit (three commits
total ahead of `8c0e07f` across this bundle), status shows only the new
test file. Stop on drift.

- [ ] **Step 9: Commit**

```bash
git add tests/webapp/test_onboarding_document_walkthrough_browser_smoke.py
git commit -m "test(onboarding): add document workflow tour acceptance coverage"
```

---

### Task 4: Report the handoff/extension walkthrough gap (no code)

This task produces no commit. It is the deliverable that ensures the
scope gap identified at the top of this plan is not silently dropped.

- [ ] **Step 1: Confirm the gap is still current**

Re-run a quick check before reporting, in case UI was added between
research and this bundle's completion: `grep -rli "connect.extension\|pairing" webapp/templates/`
Expected: no matches (if matches appear, the gap may have closed —
investigate before reporting it as still open).

- [ ] **Step 2: Include in the final bundle report** (see below) a
  distinct, clearly-labeled section stating: the application-handoff/
  extension walkthrough was not implemented in this bundle because no
  real webapp UI exists to attach it to (no "Connect extension" page, no
  pairing UI, no session-status view — confirmed absent from every
  template in `webapp/templates/`); the design spec describes such a page
  but it was never built; the browser extension has no popup UI either;
  and Ticket 2's overlay mechanism only runs inside webapp pages, so it
  cannot reach extension-side surfaces even if they existed. State that
  closing this gap requires either new webapp UI (a real, functional
  pairing/session page — separate authorization, out of onboarding
  scope) or an out-of-webapp onboarding mechanism, and that this bundle
  deliberately did not build either, per explicit instruction.

---

## Post-Bundle-A Report Checklist

Before reporting Bundle A complete, confirm:
- [ ] Three commits on `feature/contextual-onboarding`, each corresponding
  to one of Tasks 1-3 above, all ahead of Ticket 4's final commit
  `8c0e07f`.
- [ ] `git log --oneline 8c0e07f..HEAD` shows exactly these three
  commits, nothing else.
- [ ] `git status --short` clean.
- [ ] Full test suite passes (`pytest -q`).
- [ ] `git diff --check` clean.
- [ ] No file outside `product/onboarding_walkthroughs.py`,
  `webapp/templates/workspace_detail.html`,
  `tests/test_onboarding_walkthroughs_content.py`, and
  `tests/webapp/test_onboarding_document_walkthrough_browser_smoke.py`
  was touched.
- [ ] The workspace detail page was not redesigned — only one trigger
  link was added; every walkthrough target reuses existing markup.
- [ ] No walkthrough content or script mutates document/job/application/
  profile data — proven by the API-call-interception and
  previously-confirmed-pack-bytes-unchanged assertions in Task 3.
- [ ] No internal vocabulary (hash/artifact/blob/content_id/frozen/pack/
  snapshot) appears in any walkthrough copy — proven by the dedicated
  content test.
- [ ] The rejected governed document editor was not referenced,
  imported, or resurrected anywhere in this bundle.
- [ ] Five steps, each tied to a real, already-existing UI element.
- [ ] The application-handoff/extension walkthrough gap is reported
  explicitly (Task 4), not silently dropped.
- [ ] Nothing pushed; `master` untouched; no other worktree touched.
- [ ] Stop here and report back before beginning Bundle B (contextual
  triggers, Help → Walkthroughs, accessibility, full acceptance), per
  the revised bundle sequencing.
