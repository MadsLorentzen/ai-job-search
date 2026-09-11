# Onboarding Ticket 2: Shared Interactive Overlay and Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one reusable, framework-free walkthrough overlay (spotlight +
popover + controls) driven entirely by the Ticket 1 engine/API and by
walkthrough *definitions* (id, steps, targets) supplied as data — not a
bespoke component per feature. No feature-specific walkthrough content is
added in this ticket; that begins in Ticket 3.

**Architecture:** `webapp/static/onboarding.js` defines a single
`Onboarding` controller, loaded globally by `base.html` exactly like the
existing `app.js`. It fetches a walkthrough's steps + current progress from
`/api/onboarding/walkthroughs/{id}` (built in Ticket 1), renders a
spotlight overlay + popover card positioned relative to the DOM element
matched by the current step's `target` selector, and drives Next/Back/
Skip/Close/Finish through the same `/api/onboarding/...` transition
endpoints. `webapp/static/onboarding.css` styles it using the same design
tokens (`--ink`, `--green`, `--line`, etc.) already defined in `app.css`.
Two stable navigation elements in `base.html` gain
`data-onboarding-target="..."` attributes purely as real anchor points the
overlay can be proven against in this ticket — they carry no walkthrough
content of their own. Acceptance tests are Playwright browser tests
(this repo's existing "frontend test" mechanism — there is no JS unit-test
harness in the repo), following the `tests/webapp/test_browser_smoke.py`
pattern, driving a walkthrough registered only inside the test module.

**Tech Stack:** Vanilla ES2020+ JavaScript (no build step, no framework —
matches `app.js`), plain CSS (matches `app.css`), FastAPI/Jinja2 (existing),
pytest + pytest-playwright (existing, already installed — confirmed via
`plugins: ... playwright-0.6.2` in the repo's pytest output).

**Spec:** The Ticket 2 section of the contextual-onboarding stream brief
(conversation-supplied). Builds on
`docs/superpowers/plans/2026-08-27-onboarding-ticket1-state-engine.md`,
which implemented `/api/onboarding/*` and the state engine this ticket
drives.

## Global Constraints

- Frozen baseline commit: `12224eeb6d401209ed0da6fe1360fc90a722bc98`. Work
  happens only on branch `feature/contextual-onboarding` in worktree
  `C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`.
  Never touch `master` or any other worktree.
- Ticket 1 is accepted and merged into this branch at commit `d874579`
  (`HEAD` at the start of this ticket). Ticket 1 provides:
  `/api/onboarding/walkthroughs`, `/api/onboarding/walkthroughs/{id}`, and
  the `begin`/`advance`/`back`/`interrupt`/`resume`/`complete`/`skip`/
  `replay` POST endpoints (`webapp/api/onboarding.py`), backed by
  `webapp/services/onboarding.py` and `product/onboarding.py`
  (`WalkthroughDefinition`, `WalkthroughStep`, `register_walkthrough`,
  `get_walkthrough`).
- One reusable overlay system only. Do not create a separate component per
  feature walkthrough — Tickets 3-6 must be able to drive this same
  overlay purely by registering new `WalkthroughDefinition`s.
- No feature-specific walkthrough content in this ticket. The only new
  `data-onboarding-target` attributes added are on stable, already-real
  navigation elements in `base.html`, solely to give the overlay something
  genuine to test against — they carry no explanatory copy of their own.
- Must fail safely: a missing/stale/temporarily-unavailable target must
  never crash the page or trap the user. See Task 4.
- Must support keyboard navigation, visible focus, Escape-to-close, and
  focus restoration to the element that had focus before the walkthrough
  opened.
- Must never mutate application data. The overlay only calls
  `/api/onboarding/*` endpoints (progress bookkeeping) — never any other
  API route.
- Follow existing repo conventions: vanilla JS matching `app.js`'s style
  (top-level `document.addEventListener`/`querySelectorAll` wiring, an
  `api()` fetch helper, no imports/exports, no build step), CSS using the
  `:root` custom properties already defined in `app.css`, Playwright tests
  following `tests/webapp/test_browser_smoke.py`'s `live_server` +
  `sync_playwright`-provided `page` fixture pattern.
- Before the first write in this worktree, and again before every commit,
  verify: `git rev-parse --show-toplevel`, `git branch --show-current`,
  `git rev-parse HEAD`, `git status --short`. Expected: this worktree path,
  branch `feature/contextual-onboarding`, HEAD `d874579` (until Task 1's
  commit) then advancing one commit per task, clean status. Stop on drift.
- Do not push. Do not merge.

---

## File Structure

- **Create:** `webapp/static/onboarding.css` — spotlight, popover, controls,
  progress indicator, responsive/reduced-motion rules.
- **Create:** `webapp/static/onboarding.js` — the `Onboarding` overlay
  controller: fetch walkthrough state, render spotlight + popover,
  position/reposition, scroll-into-view, target reacquisition, keyboard
  handling, focus trap/restoration, wiring to `/api/onboarding/*`.
- **Modify:** `webapp/templates/base.html` — load the two new static
  assets; add `data-onboarding-target` to two existing stable nav elements
  (the "Dashboard" link and the "Add job" button) as real anchor points.
- **Test:** `tests/webapp/test_onboarding_overlay_browser_smoke.py` —
  Playwright acceptance tests for the overlay mechanics, using a
  test-only walkthrough definition registered in the test module via
  `product.onboarding.register_walkthrough`.

No changes to `webapp/api/onboarding.py`, `webapp/services/onboarding.py`,
`webapp/persistence/onboarding.py`, or `product/onboarding.py` — Ticket 2
is UI-only, consuming Ticket 1's surface as-is.

---

## Design notes carried into the tasks below

**Why a `<template>`-driven single controller, not per-step markup:**
The overlay is injected once into the DOM (via `document.body.appendChild`)
and repopulated per step from the fetched `WalkthroughDefinition`/step
data — never per-feature markup baked into templates. This is what makes
Tickets 3-6 pure data additions.

**Target resolution contract:** each step's `target` is a CSS selector
string (as defined in Ticket 1's `WalkthroughStep.target`). Before
rendering a step, the controller calls `document.querySelector(target)`.
If it returns `null` — target missing, moved, or the surrounding UI
rerendered mid-tour — the controller does not throw or trap the user; it
calls a `_failStepGracefully()` path (Task 4) that ends the walkthrough via
the same `interrupt` transition (never `complete`, since the walkthrough
was not actually finished) and shows a small, dismissible inline notice
that a walkthrough step could not be shown, without blocking the rest of
the page.

**Positioning:** `getBoundingClientRect()` on the target plus the
popover's own measured size decides placement (`top`/`bottom`/`left`/
`right`/`auto`, per `WalkthroughStep.placement` from Ticket 1). `auto`
picks whichever side has more viewport room. Recomputed on `resize` and
`scroll` (throttled via `requestAnimationFrame`) so viewport changes and
target movement keep the popover attached without hiding the target.

**Reduced motion:** all transitions are wrapped in a
`@media (prefers-reduced-motion: no-preference)` block in the CSS, so the
unprefixed rule is "no motion" and motion is opt-in for users who haven't
asked for reduced motion — this is the safe default direction.

---

### Task 1: Overlay stylesheet

**Files:**
- Create: `webapp/static/onboarding.css`
- Modify: `webapp/templates/base.html` (stylesheet `<link>` only in this
  task; JS and target attributes come in later tasks)

**Interfaces:**
- Consumes: the `:root` custom properties already defined in
  `webapp/static/app.css` (`--ink`, `--muted`, `--line`, `--paper`,
  `--white`, `--green`, `--shadow`), so the overlay visually matches the
  rest of the app without redefining a second palette.
- Produces (for Task 2's JS to target): stable class names
  `.onboarding-backdrop`, `.onboarding-spotlight`, `.onboarding-popover`,
  `.onboarding-popover-title`, `.onboarding-popover-body`,
  `.onboarding-popover-progress`, `.onboarding-popover-controls`,
  `.onboarding-popover-close`, `.onboarding-fail-notice`.

- [ ] **Step 1: Write the CSS**

```css
/* webapp/static/onboarding.css */
.onboarding-backdrop{position:fixed;inset:0;z-index:1000;pointer-events:none}
.onboarding-spotlight{position:fixed;border-radius:10px;box-shadow:0 0 0 4000px rgba(23,33,29,.55);pointer-events:none;z-index:1001}
@media(prefers-reduced-motion:no-preference){.onboarding-spotlight{transition:top .18s ease,left .18s ease,width .18s ease,height .18s ease}.onboarding-popover{transition:top .18s ease,left .18s ease}}
.onboarding-popover{position:fixed;z-index:1002;max-width:340px;background:var(--white);color:var(--ink);border-radius:14px;box-shadow:var(--shadow);padding:18px 20px;pointer-events:auto}
.onboarding-popover:focus{outline:none}
.onboarding-popover-close{position:absolute;top:10px;right:10px;appearance:none;border:0;background:transparent;color:var(--muted);font-size:16px;line-height:1;cursor:pointer;padding:6px;border-radius:8px}
.onboarding-popover-close:hover{background:#edf2ee}
.onboarding-popover-close:focus-visible,.onboarding-popover button:focus-visible,.onboarding-popover a:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.onboarding-popover-title{font-size:16px;font-weight:750;margin:0 26px 8px 0}
.onboarding-popover-body{font-size:14px;color:var(--ink);margin:0 0 14px}
.onboarding-popover-progress{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 10px}
.onboarding-popover-controls{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.onboarding-popover-controls-primary{display:flex;gap:8px}
.onboarding-popover-controls .button{padding:8px 13px;font-size:13px}
.onboarding-popover-dont-show{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);font-weight:500}
.onboarding-popover-dont-show input{width:auto}
.onboarding-fail-notice{position:fixed;bottom:20px;left:20px;max-width:360px;background:var(--white);border:1px solid var(--line);color:var(--muted);padding:11px 14px;border-radius:10px;box-shadow:var(--shadow);font-size:13px;z-index:1002}
.onboarding-fail-notice button{margin-left:8px;appearance:none;border:0;background:transparent;color:var(--green);font-weight:700;cursor:pointer;padding:0}
@media(max-width:640px){.onboarding-popover{left:12px!important;right:12px;max-width:none;width:calc(100vw - 24px)}}
```

Note: the spotlight uses a single giant `box-shadow` to darken everything
outside its rounded rect, rather than four separate overlay divs — this
keeps repositioning to updating one element's `top/left/width/height`
inline styles per step, which Task 2 relies on.

- [ ] **Step 2: Load the stylesheet in base.html**

In `webapp/templates/base.html`, add after the existing `app.css` link:

```html
  <link rel="stylesheet" href="/static/onboarding.css">
```

- [ ] **Step 3: Manually verify the file loads with no console errors**

Run: `python -c "from webapp.app import create_app; from webapp.config import Settings; import tempfile, pathlib; d = pathlib.Path(tempfile.mkdtemp()); app = create_app(Settings(db_path=d/'t.sqlite3', documents_root=d/'documents')); print('ok')"`
Expected: prints `ok` (app still constructs cleanly with the new
stylesheet reference — this is not yet a rendering test, just confirms no
Jinja/template break).

- [ ] **Step 4: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: worktree
`C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`,
branch `feature/contextual-onboarding`, HEAD still `d874579` (no commits
yet on this ticket), status shows only the new CSS file and modified
`base.html`. Stop on drift.

- [ ] **Step 5: Commit**

```bash
git add webapp/static/onboarding.css webapp/templates/base.html
git commit -m "feat(onboarding): add shared overlay stylesheet"
```

---

### Task 2: Overlay controller — render, fetch, and static-target happy path

**Files:**
- Create: `webapp/static/onboarding.js`
- Modify: `webapp/templates/base.html` (load the script; add
  `data-onboarding-target` to two real, stable elements)
- Test: `tests/webapp/test_onboarding_overlay_browser_smoke.py`
  (created here, extended in later tasks)

**Interfaces:**
- Consumes:
  - `/api/onboarding/walkthroughs/{walkthrough_id}` (GET, from Ticket 1) —
    returns `{walkthrough_id, title, step_count, status, current_step_index,
    ...}`. Note: Ticket 1's status payload does **not** include the step
    list (title/body/target/placement per step) — only counts and
    progress. This task adds that missing piece via a second, additive
    endpoint (see Step 3 below) rather than overloading the status
    response, since Ticket 1 deliberately kept persistence/status separate
    from static definition content.
  - `/api/onboarding/walkthroughs/{walkthrough_id}/begin` etc. (POST, from
    Ticket 1).
  - CSS classes from Task 1.
- Produces (for Task 3's keyboard/focus work and Task 4's fail-safety work
  to extend): a global `window.Onboarding` object with
  `window.Onboarding.start(walkthroughId)` as its public entry point, plus
  internal render/position functions in the same closure that later tasks
  extend in place (this file is edited incrementally across Tasks 2-4, not
  re-created).

- [ ] **Step 1: Write the failing Playwright test for the render happy path**

```python
# tests/webapp/test_onboarding_overlay_browser_smoke.py
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
    assert page.locator(".onboarding-popover-progress").inner_text().strip() == "Step 2 of 2"


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/test_onboarding_overlay_browser_smoke.py -v`
Expected: FAIL — `page.evaluate("window.Onboarding.start(...)")` raises
because `window.Onboarding` is undefined (script doesn't exist yet), and
`data-onboarding-target` attributes don't exist on any element yet.

- [ ] **Step 3: Add a step-content endpoint to the existing onboarding API router**

Ticket 1's `GET /api/onboarding/walkthroughs/{id}` returns only progress
bookkeeping, not the step content (title/body/target/placement per step)
needed to render. Rather than changing that endpoint's contract (which
Ticket 1's tests already pin), add one new read-only endpoint to the same
router file, reusing the existing `get_walkthrough` service resolution:

Modify `webapp/api/onboarding.py` — add near the top-level imports:

```python
from product.onboarding import get_walkthrough as _get_walkthrough_definition
```

Add a new route (placed after `get_walkthrough` in the file):

```python
@router.get("/walkthroughs/{walkthrough_id}/definition")
def get_walkthrough_definition(walkthrough_id: str) -> dict:
    try:
        definition = _get_walkthrough_definition(walkthrough_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown walkthrough: {walkthrough_id}")
    return {
        "walkthrough_id": definition.walkthrough_id,
        "version": definition.version,
        "title": definition.title,
        "steps": [
            {
                "step_id": step.step_id, "target": step.target,
                "title": step.title, "body": step.body,
                "placement": step.placement,
            }
            for step in definition.steps
        ],
    }
```

This endpoint is deliberately unscoped by `AccountScope` (no `Depends`
needed) — walkthrough *definitions* are static, non-account-specific data,
unlike progress. It never touches the database.

Add a matching test to `tests/webapp/api/test_onboarding_routes.py`:

```python
def test_get_walkthrough_definition_returns_step_content(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.get(
            "/api/onboarding/walkthroughs/api_test_walkthrough/definition"
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["title"] == "API test walkthrough"
        assert [step["step_id"] for step in body["steps"]] == ["s0", "s1"]
        assert body["steps"][0]["target"] == "[data-onboarding-target=a]"


def test_get_walkthrough_definition_unknown_returns_404(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/onboarding/walkthroughs/does_not_exist/definition")
        assert response.status_code == 404
```

Run: `pytest tests/webapp/api/test_onboarding_routes.py -v`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 4: Add the two real anchor points to base.html**

In `webapp/templates/base.html`, add `data-onboarding-target` to the
existing "Dashboard" nav link (`<a href="/">Dashboard</a>`, currently
line 16) and the "Add job" button
(`<a class="button button-small" href="/new-job">Add job</a>`, currently
line 21) — do not otherwise change their markup, text, or behavior:

```html
      <a href="/" data-onboarding-target="dashboard-link">Dashboard</a>
```

and

```html
      <a class="button button-small" href="/new-job" data-onboarding-target="add-job-button">Add job</a>
```

- [ ] **Step 5: Implement the overlay controller (render + fetch + static positioning)**

```javascript
// webapp/static/onboarding.js
window.Onboarding = (function () {
  let state = null; // {walkthroughId, definition, status, popoverEl, backdropEl, spotlightEl}

  async function apiCall(url, options) {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || "Onboarding request failed");
    return body;
  }

  async function start(walkthroughId) {
    const [definition, status] = await Promise.all([
      apiCall(`/api/onboarding/walkthroughs/${walkthroughId}/definition`),
      apiCall(`/api/onboarding/walkthroughs/${walkthroughId}`),
    ]);
    // Three legal entry points map to three distinct engine transitions
    // (see product/onboarding.py from Ticket 1): "in_progress" resumes in
    // place; "completed"/"skipped" is an explicit replay (preserves
    // times_completed, counts as a new times_started -- this is the Help
    // -> Walkthroughs "Replay" action's semantics, Ticket 7); "not_started"
    // is the only case that begins fresh. Using begin() for an already
    // completed/skipped walkthrough would work today (begin() is only
    // blocked while in_progress) but would blur that distinction the
    // moment Ticket 1's engine semantics diverge further -- replay() is
    // the one always-correct call for "already touched, starting over".
    let nextEndpoint = "begin";
    if (status.status === "in_progress") nextEndpoint = "resume";
    else if (status.status === "completed" || status.status === "skipped") nextEndpoint = "replay";
    const opened = await apiCall(
      `/api/onboarding/walkthroughs/${walkthroughId}/${nextEndpoint}`, {method: "POST"}
    );
    _open(walkthroughId, definition, opened);
  }

  function _open(walkthroughId, definition, status) {
    state = {walkthroughId, definition, status};
    _buildDom();
    _renderStep();
  }

  function _buildDom() {
    const backdrop = document.createElement("div");
    backdrop.className = "onboarding-backdrop";
    const spotlight = document.createElement("div");
    spotlight.className = "onboarding-spotlight";
    const popover = document.createElement("div");
    popover.className = "onboarding-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-modal", "false");
    popover.tabIndex = -1;
    document.body.appendChild(backdrop);
    document.body.appendChild(spotlight);
    document.body.appendChild(popover);
    state.backdropEl = backdrop;
    state.spotlightEl = spotlight;
    state.popoverEl = popover;
  }

  function _currentStep() {
    return state.definition.steps[state.status.current_step_index];
  }

  function _renderStep() {
    const step = _currentStep();
    const target = document.querySelector(step.target);
    if (!target) {
      _failStepGracefully();
      return;
    }
    const total = state.definition.steps.length;
    const index = state.status.current_step_index;
    state.popoverEl.innerHTML = `
      <button type="button" class="onboarding-popover-close" aria-label="Close walkthrough">&times;</button>
      <p class="onboarding-popover-progress">Step ${index + 1} of ${total}</p>
      <h2 class="onboarding-popover-title">${_escapeHtml(step.title)}</h2>
      <p class="onboarding-popover-body">${_escapeHtml(step.body)}</p>
      <div class="onboarding-popover-controls">
        <div class="onboarding-popover-controls-primary">
          ${index > 0 ? '<button type="button" class="button secondary" data-onboarding-action="back">Back</button>' : ""}
          <button type="button" class="button secondary" data-onboarding-action="skip">Skip</button>
        </div>
        <button type="button" class="button" data-onboarding-action="${index === total - 1 ? "finish" : "next"}">${index === total - 1 ? "Finish" : "Next"}</button>
      </div>`;
    target.scrollIntoView({block: "center", inline: "nearest"});
    _position(target, step.placement);
  }

  function _escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  function _position(target, placement) {
    const rect = target.getBoundingClientRect();
    const padding = 6;
    state.spotlightEl.style.top = `${rect.top - padding}px`;
    state.spotlightEl.style.left = `${rect.left - padding}px`;
    state.spotlightEl.style.width = `${rect.width + padding * 2}px`;
    state.spotlightEl.style.height = `${rect.height + padding * 2}px`;

    const popover = state.popoverEl;
    const popoverRect = popover.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    let resolvedPlacement = placement;
    if (placement === "auto" || !placement) {
      resolvedPlacement = (rect.bottom + popoverRect.height + 16 < viewportHeight) ? "bottom" : "top";
    }
    let top, left;
    if (resolvedPlacement === "bottom") {
      top = rect.bottom + 14;
      left = rect.left;
    } else if (resolvedPlacement === "top") {
      top = rect.top - popoverRect.height - 14;
      left = rect.left;
    } else if (resolvedPlacement === "left") {
      top = rect.top;
      left = rect.left - popoverRect.width - 14;
    } else {
      top = rect.top;
      left = rect.right + 14;
    }
    left = Math.max(12, Math.min(left, viewportWidth - popoverRect.width - 12));
    top = Math.max(12, Math.min(top, viewportHeight - popoverRect.height - 12));
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function _failStepGracefully() {
    // Placeholder for Task 4 -- real implementation added there.
  }

  return {start};
})();
```

Load it in `webapp/templates/base.html`, after the existing `app.js`
script tag:

```html
  <script src="/static/onboarding.js" defer></script>
```

- [ ] **Step 6: Wire up Next/Back/Skip/Finish/Close click handling**

Append to `webapp/static/onboarding.js`, inside the same IIFE, above the
`return {start};` line:

```javascript
  document.addEventListener("click", async (event) => {
    if (!state) return;
    const actionEl = event.target.closest("[data-onboarding-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.onboardingAction;
    try {
      if (action === "next") {
        state.status = await apiCall(
          `/api/onboarding/walkthroughs/${state.walkthroughId}/advance`, {method: "POST"}
        );
        _renderStep();
      } else if (action === "back") {
        state.status = await apiCall(
          `/api/onboarding/walkthroughs/${state.walkthroughId}/back`, {method: "POST"}
        );
        _renderStep();
      } else if (action === "finish") {
        await apiCall(
          `/api/onboarding/walkthroughs/${state.walkthroughId}/complete`, {method: "POST"}
        );
        _close();
      } else if (action === "skip") {
        await apiCall(
          `/api/onboarding/walkthroughs/${state.walkthroughId}/skip`, {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({reason: "skip"}),
          }
        );
        _close();
      }
    } catch (error) {
      _close();
    }
  });

  document.addEventListener("click", (event) => {
    if (!state) return;
    if (event.target.closest(".onboarding-popover-close")) {
      _closeViaInterrupt();
    }
  });

  async function _closeViaInterrupt() {
    try {
      await apiCall(
        `/api/onboarding/walkthroughs/${state.walkthroughId}/interrupt`, {method: "POST"}
      );
    } finally {
      _close();
    }
  }

  function _close() {
    if (!state) return;
    state.backdropEl.remove();
    state.spotlightEl.remove();
    state.popoverEl.remove();
    state = null;
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/webapp/test_onboarding_overlay_browser_smoke.py -v`
Expected: PASS (all four tests)

- [ ] **Step 8: Run relevant regression tests**

Run: `pytest tests/webapp/test_browser_smoke.py tests/webapp/api/test_onboarding_routes.py -v`
Expected: PASS (no regressions in the existing browser smoke suite or the
onboarding API tests, including the two new definition-endpoint tests)

- [ ] **Step 9: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 1's commit (i.e. two ahead of
`d874579`), status shows the new/modified files from this task only. Stop
on drift.

- [ ] **Step 10: Commit**

```bash
git add webapp/api/onboarding.py webapp/static/onboarding.js webapp/templates/base.html \
  tests/webapp/api/test_onboarding_routes.py \
  tests/webapp/test_onboarding_overlay_browser_smoke.py
git commit -m "feat(onboarding): add shared overlay controller with render/fetch/positioning"
```

---

### Task 3: Keyboard navigation, focus management, and progress indication polish

**Files:**
- Modify: `webapp/static/onboarding.js`
- Modify: `tests/webapp/test_onboarding_overlay_browser_smoke.py`

**Interfaces:**
- Consumes: `state`, `_renderStep`, `_close` from Task 2 (same file, same
  closure — extended in place).
- Produces: keyboard-driven Next/Back/Escape, focus moved into the
  popover on open and restored to the pre-open `document.activeElement`
  on close, `Tab`/`Shift+Tab` cycling confined within the popover's
  focusable controls while it is open.

- [ ] **Step 1: Write the failing keyboard/focus tests**

```python
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
```

Note: arrow-key step advance is deliberately out of scope — it is not in
the required control set (Next/Back/Skip/Finish/Close/Replay), and
Tab + Enter on the rendered Next button already gives full keyboard
access. No test is written for it because there is no such behavior to
test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/test_onboarding_overlay_browser_smoke.py -v -k "escape or focus or tab_cycles"`
Expected: FAIL — Escape does nothing yet, focus is never moved into the
popover, Tab is not constrained.

- [ ] **Step 3: Implement focus management and keyboard handling**

Extend `webapp/static/onboarding.js`. Add a module-level variable near
`let state = null;`:

```javascript
  let previouslyFocusedEl = null;
```

In `_open`, before `_buildDom()`:

```javascript
    previouslyFocusedEl = document.activeElement;
```

After `_buildDom()` in `_open` (i.e. right after `state.popoverEl =
popover;` inside `_buildDom`, or by calling a focus step at the end of
`_open` — place it at the end of `_open`, after `_renderStep()`):

```javascript
  function _open(walkthroughId, definition, status) {
    state = {walkthroughId, definition, status};
    previouslyFocusedEl = document.activeElement;
    _buildDom();
    _renderStep();
    state.popoverEl.focus();
    document.addEventListener("keydown", _handleKeydown);
  }
```

Add the keydown handler and Tab-trap logic:

```javascript
  function _handleKeydown(event) {
    if (!state) return;
    if (event.key === "Escape") {
      event.preventDefault();
      _closeViaInterrupt();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [...state.popoverEl.querySelectorAll("button")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
```

Update `_close` to restore focus and remove the keydown listener:

```javascript
  function _close() {
    if (!state) return;
    document.removeEventListener("keydown", _handleKeydown);
    state.backdropEl.remove();
    state.spotlightEl.remove();
    state.popoverEl.remove();
    state = null;
    if (previouslyFocusedEl && document.body.contains(previouslyFocusedEl)) {
      previouslyFocusedEl.focus();
    }
    previouslyFocusedEl = null;
  }
```

Add an accessible name to the popover container itself (referencing its
own title node) inside `_buildDom`, so screen readers announce it as a
dialog with the step title. Change the popover creation block to:

```javascript
    popover.setAttribute("aria-modal", "false");
    popover.setAttribute("aria-labelledby", "onboarding-popover-title");
    popover.setAttribute("aria-describedby", "onboarding-popover-body");
```

and in `_renderStep`'s template string, add matching `id`s:

```javascript
      <h2 class="onboarding-popover-title" id="onboarding-popover-title">${_escapeHtml(step.title)}</h2>
      <p class="onboarding-popover-body" id="onboarding-popover-body">${_escapeHtml(step.body)}</p>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/webapp/test_onboarding_overlay_browser_smoke.py -v`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Run relevant regression tests**

Run: `pytest tests/webapp/test_browser_smoke.py -v`
Expected: PASS (no regressions — confirms the new global `keydown`
listener doesn't interfere with existing pages when no walkthrough is
open, since `_handleKeydown` only runs while `state` is non-null and is
only attached/detached around `_open`/`_close`)

- [ ] **Step 6: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 2's commit, status shows only
`webapp/static/onboarding.js` and the test file modified. Stop on drift.

- [ ] **Step 7: Commit**

```bash
git add webapp/static/onboarding.js tests/webapp/test_onboarding_overlay_browser_smoke.py
git commit -m "feat(onboarding): add keyboard navigation and focus management to overlay"
```

---

### Task 4: Safe handling of missing/stale targets, reflow on resize/scroll, "Don't show again"

**Files:**
- Modify: `webapp/static/onboarding.js`
- Modify: `tests/webapp/test_onboarding_overlay_browser_smoke.py`

**Interfaces:**
- Consumes: `_renderStep`, `_currentStep`, `state` from Tasks 2-3 (same
  file, extended in place).
- Produces: `_failStepGracefully()` (real implementation, replacing the
  Task 2 placeholder), a `resize`/`scroll` reflow listener, and a
  "Don't show this automatically again" checkbox wired to the `skip`
  endpoint with `reason: "dont_show_again"`.

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/test_onboarding_overlay_browser_smoke.py -v -k "missing_target or dont_show_again or resize"`
Expected: FAIL — missing target currently does nothing visible (empty
`_failStepGracefully` placeholder leaves the popover never rendered but
also never explained, so `.onboarding-fail-notice` never appears); no
"don't show again" checkbox exists; no resize listener exists.

- [ ] **Step 3: Implement graceful target-fail handling**

Replace the Task 2 placeholder in `webapp/static/onboarding.js`:

```javascript
  function _failStepGracefully() {
    const walkthroughId = state.walkthroughId;
    _teardownDom();
    state = null;
    apiCall(`/api/onboarding/walkthroughs/${walkthroughId}/interrupt`, {method: "POST"})
      .catch(() => {});
    _showFailNotice();
  }

  function _teardownDom() {
    document.removeEventListener("keydown", _handleKeydown);
    if (state.backdropEl) state.backdropEl.remove();
    if (state.spotlightEl) state.spotlightEl.remove();
    if (state.popoverEl) state.popoverEl.remove();
  }

  function _showFailNotice() {
    const notice = document.createElement("div");
    notice.className = "onboarding-fail-notice";
    notice.setAttribute("role", "status");
    notice.innerHTML = 'This walkthrough step is unavailable right now. <button type="button">Dismiss</button>';
    notice.querySelector("button").addEventListener("click", () => notice.remove());
    document.body.appendChild(notice);
    if (previouslyFocusedEl && document.body.contains(previouslyFocusedEl)) {
      previouslyFocusedEl.focus();
    }
    previouslyFocusedEl = null;
  }
```

Refactor `_close` to reuse `_teardownDom` (avoids duplicated removal
logic between the graceful-fail path and the normal close path):

```javascript
  function _close() {
    if (!state) return;
    _teardownDom();
    const restoreTarget = previouslyFocusedEl;
    state = null;
    previouslyFocusedEl = null;
    if (restoreTarget && document.body.contains(restoreTarget)) {
      restoreTarget.focus();
    }
  }
```

Also call `_failStepGracefully()` defensively from within
`_renderStep`'s target lookup on every step transition, not just the
first render — this already happens because `_renderStep` is the single
call site that resolves `step.target` (used both by `_open` and by the
`next`/`back` handlers in Task 2's click listener), so no additional call
site changes are needed. Confirm this by inspection: `_renderStep` is
called from `_open` and from the `next`/`back` branches in the click
handler — both paths already route through the same target-lookup
`if (!target) { _failStepGracefully(); return; }` guard.

- [ ] **Step 4: Implement resize/scroll reflow**

Add to `_open`, alongside the existing `document.addEventListener("keydown", ...)`:

```javascript
    window.addEventListener("resize", _handleReflow);
    window.addEventListener("scroll", _handleReflow, true);
```

Add the reflow handler and remove the listeners in `_teardownDom`:

```javascript
  let reflowScheduled = false;
  function _handleReflow() {
    if (!state || reflowScheduled) return;
    reflowScheduled = true;
    requestAnimationFrame(() => {
      reflowScheduled = false;
      if (!state) return;
      const step = _currentStep();
      const target = document.querySelector(step.target);
      if (!target) {
        _failStepGracefully();
        return;
      }
      _position(target, step.placement);
    });
  }
```

```javascript
  function _teardownDom() {
    document.removeEventListener("keydown", _handleKeydown);
    window.removeEventListener("resize", _handleReflow);
    window.removeEventListener("scroll", _handleReflow, true);
    if (state.backdropEl) state.backdropEl.remove();
    if (state.spotlightEl) state.spotlightEl.remove();
    if (state.popoverEl) state.popoverEl.remove();
  }
```

- [ ] **Step 5: Add the "Don't show this automatically again" checkbox**

Update the controls template inside `_renderStep` in
`webapp/static/onboarding.js`:

```javascript
      <div class="onboarding-popover-controls">
        <div class="onboarding-popover-controls-primary">
          ${index > 0 ? '<button type="button" class="button secondary" data-onboarding-action="back">Back</button>' : ""}
          <label class="onboarding-popover-dont-show"><input type="checkbox" data-onboarding-dont-show-again> Don't show this automatically again</label>
          <button type="button" class="button secondary" data-onboarding-action="skip">Skip</button>
        </div>
        <button type="button" class="button" data-onboarding-action="${index === total - 1 ? "finish" : "next"}">${index === total - 1 ? "Finish" : "Next"}</button>
      </div>`;
```

Update the `skip` branch of the click handler to read the checkbox:

```javascript
      } else if (action === "skip") {
        const dontShowAgain = state.popoverEl.querySelector("[data-onboarding-dont-show-again]")?.checked;
        await apiCall(
          `/api/onboarding/walkthroughs/${state.walkthroughId}/skip`, {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({reason: dontShowAgain ? "dont_show_again" : "skip"}),
          }
        );
        _close();
      }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/webapp/test_onboarding_overlay_browser_smoke.py -v`
Expected: PASS (all tests, old and new)

- [ ] **Step 7: Run relevant regression tests**

Run: `pytest tests/webapp/test_browser_smoke.py tests/webapp/api/test_onboarding_routes.py tests/webapp/services/test_onboarding_service.py -v`
Expected: PASS (no regressions)

- [ ] **Step 8: Run the full webapp and product regression suites**

Run: `pytest tests/webapp -q` and `pytest tests -q --ignore=tests/webapp`
Expected: PASS across both. If any pre-existing failure surfaces that is
unrelated to onboarding, stop and report it distinctly rather than
folding a fix into this ticket's diff.

- [ ] **Step 9: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 3's commit (four commits
total ahead of `d874579` across this ticket), status shows only
`webapp/static/onboarding.js` and the test file modified. Stop on drift.

- [ ] **Step 10: Commit**

```bash
git add webapp/static/onboarding.js tests/webapp/test_onboarding_overlay_browser_smoke.py
git commit -m "feat(onboarding): fail gracefully on missing targets, reflow on resize, add don't-show-again"
```

---

## Post-Ticket-2 Report Checklist

Before reporting Ticket 2 complete, confirm:
- [ ] Four commits on `feature/contextual-onboarding`, each corresponding
  to one task above, all ahead of Ticket 1's final commit `d874579`.
- [ ] `git log --oneline d874579..HEAD` shows exactly these four commits,
  nothing else.
- [ ] `git status --short` clean.
- [ ] Full test suite passes (`pytest -q`, with the pre-existing
  npm-dependent browser smoke caveat resolved the same way as Ticket 1 —
  i.e. `npm ci --prefix extension` already installed from Ticket 1's
  acceptance, so no environment gap should recur unless the worktree was
  recreated).
- [ ] `git diff --check` clean.
- [ ] No file outside `webapp/static/onboarding.css`,
  `webapp/static/onboarding.js`, `webapp/templates/base.html`,
  `webapp/api/onboarding.py` (one additive read-only endpoint),
  `tests/webapp/api/test_onboarding_routes.py`, and
  `tests/webapp/test_onboarding_overlay_browser_smoke.py` was touched.
- [ ] No feature-specific walkthrough content was added — only the shared
  overlay mechanism and two generic anchor attributes on pre-existing nav
  elements.
- [ ] Nothing pushed; `master` untouched; no other worktree touched.
- [ ] Stop here and report back before beginning Ticket 3 (Dashboard and
  Candidate Profile walkthroughs), per the stream's explicit sequencing.
