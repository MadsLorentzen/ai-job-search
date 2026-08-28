# Onboarding Bundle B: First-Use Triggers, Help, Accessibility, Full Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the four existing walkthroughs (Dashboard, Candidate Profile,
Job workflow, Document workflow) into real first-use behavior, add a
Help → Walkthroughs launcher/catalogue page with an explicit replay model
that always runs a tour on the real page containing its real UI targets,
add a "Why am I seeing this?" disclosure for auto-triggered tours, harden
the shared overlay for accessibility and responsive behavior, and prove
the complete system end-to-end with Playwright. No new walkthrough
content, no application-handoff/extension first-use onboarding (still
deferred — no real UI), no redesign of existing product pages beyond
what onboarding itself requires, and no fabricated workspace to make a
workspace-context replay easier.

**Architecture — two distinct mechanisms, kept separate:**

1. **Automatic first-use triggering** (unchanged from the original plan):
   a page opts in by rendering `data-onboarding-autotrigger="<id>"` on its
   `<body>` tag (one per page, so "only one walkthrough may auto-open at a
   time" holds by construction). On `DOMContentLoaded`, if that attribute
   is present, `onboarding.js` fetches the walkthrough's status and calls
   `start()` only when `status === "not_started"`.

2. **Explicit replay via Help → Walkthroughs** (the corrected design):
   Help is a *launcher/catalogue*, not an execution surface — none of the
   four walkthroughs' real targets exist on `/walkthroughs` itself, so a
   tour must never be started there. Each walkthrough declares a small,
   new piece of data-only metadata — its **launch context** — in
   `product/onboarding_walkthroughs.py`:
   `WALKTHROUGH_LAUNCH_CONTEXTS: dict[str, dict]`, mapping
   `walkthrough_id` to either a fixed `{"context": "page", "path": "/..."}`
   (Dashboard, Candidate Profile) or `{"context": "workspace"}` (Job
   workflow, Document workflow — no fixed path, since they only make
   sense against a real job the user picks). Clicking Replay on Help
   navigates to the walkthrough's destination carrying
   `?onboarding_replay=<id>` in the URL; for a `page`-context walkthrough
   that destination is immediate; for a `workspace`-context walkthrough,
   Help instead sends the user to the Dashboard (the existing job list)
   with the same query parameter, and the Dashboard — when it detects a
   pending workspace-context replay intent it cannot itself satisfy —
   shows an explanatory "Choose a job to replay this walkthrough" prompt
   and forwards the intent onto whichever job row the user actually
   clicks. On any page, `onboarding.js`'s bootstrap checks for
   `onboarding_replay` in the URL *before* checking the auto-trigger
   attribure; if present and valid for that page, it strips the
   parameter via `history.replaceState` (so a reload never re-fires it)
   and calls `start()` unconditionally — replay must work even on an
   already-`completed` walkthrough, which `start()` already supports via
   its existing `replay` transition branch.

   This keeps the target-based overlay mechanism (Ticket 2) completely
   unchanged — launch-context metadata only decides *where the browser
   navigates before* `start()` is ever called, never how the overlay
   itself renders or transitions.

**Tech Stack:** Same as Tickets 1-4 and Bundle A — Python/FastAPI/Jinja2,
vanilla JS, pytest + pytest-playwright for acceptance.

**Spec:** The Bundle B instructions (conversation-supplied, including the
corrected replay-model follow-up), covering original Tickets 7
(contextual triggers + Help), 8 (accessibility + "Why am I seeing
this?"), and 9 (full Playwright acceptance) of the contextual-onboarding
stream. Builds on
`docs/superpowers/plans/2026-08-27-onboarding-ticket1-state-engine.md`
through `...-bundle-a-document-walkthrough.md`.

## Global Constraints

- Frozen baseline commit: `12224eeb6d401209ed0da6fe1360fc90a722bc98`. Work
  happens only on branch `feature/contextual-onboarding` in worktree
  `C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`.
  Never touch `master` or any other worktree.
- Bundle A is accepted at `6589f58dc71abdf7492853c9f307ac5469e3e23c`
  (`HEAD` at the start of this bundle).
- Only Dashboard, Candidate Profile, Job workflow, and Document workflow
  get first-use auto-triggers and Help entries. The application-handoff/
  extension walkthrough does not exist (Bundle A's documented, deferred
  gap) and gets no wiring anywhere in this bundle.
- Auto-trigger firing rule: a walkthrough auto-opens only when its status
  is exactly `not_started`. `in_progress`, `completed`, and `skipped`
  must never auto-open.
- Explicit replay (via `?onboarding_replay=<id>`) is a *different* rule:
  it must work regardless of current status — including `completed` and
  `skipped` — because the user asked for it directly. It must never erase
  or reset `times_completed`; Ticket 1's existing `replay()` transition
  already guarantees this (preserves `times_completed`, increments
  `times_started`) — this bundle only decides *when* to call it, never
  changes what it does.
- Exactly one auto-trigger attribute per page (unchanged).
- Do not fabricate, auto-select, or silently guess a workspace for a
  workspace-context replay. If no workspace exists yet, show a plain
  message that the walkthrough becomes available once the user has a job
  to work with — never create one.
- Do not build fake walkthrough targets on `/walkthroughs` itself, and
  never call `start()` while the browser is on that page.
- Invalid or mismatched `onboarding_replay` values (an id that isn't a
  known walkthrough, or one whose launch context doesn't match the
  current page) must fail closed — never start an arbitrary walkthrough
  on a page it wasn't authored for. Validate the id against
  `WALKTHROUGH_LAUNCH_CONTEXTS` client-side before calling `start()`.
- The `onboarding_replay` query parameter must be removed from the
  visible URL via `history.replaceState` immediately after being
  consumed, so a page refresh never re-triggers the same replay.
- Do not redesign existing application pages beyond: the one
  `data-onboarding-autotrigger` attribute per page; the Dashboard's new
  (but small, non-visually-disruptive) "Choose a job to replay this
  walkthrough" prompt, shown only when a pending workspace-context
  replay intent is present; and the Help page's own new, dedicated
  template.
- Keep the existing target-based overlay mechanism (Ticket 2) completely
  unchanged. Launch-context routing only decides navigation before
  `start()` is called.
- Every acceptance scenario listed in the Bundle B instructions (plus the
  ten replay-specific scenarios from the corrected-design follow-up) must
  have a corresponding Playwright test.
- Follow existing repo conventions: Jinja2 templates, the existing
  `webapp/static/onboarding.js` IIFE (additive changes only), pytest +
  pytest-playwright acceptance tests following the patterns established
  in Tickets 2-4 and Bundle A.
- Before the first write in this worktree, and again before every commit,
  verify: `git rev-parse --show-toplevel`, `git branch --show-current`,
  `git rev-parse HEAD`, `git status --short`. Expected: this worktree
  path, branch `feature/contextual-onboarding`, HEAD `6589f58` (until
  Task 1's commit) then advancing per task, clean status. Stop on drift.
- Do not push. Do not merge.

---

## File Structure

- **Modify:** `product/onboarding_walkthroughs.py` — add
  `WALKTHROUGH_LAUNCH_CONTEXTS`, the new launch-context metadata mapping.
- **Modify:** `webapp/static/onboarding.js` — add the `onboarding_replay`
  query-param bootstrap (checked before the auto-trigger attribute), the
  "was auto-triggered vs. explicitly replayed" flag distinction feeding
  "Why am I seeing this?" (shown for auto-trigger only, never for
  explicit replay — the user already knows why in both manual cases), and
  a small helper that appends a pending `onboarding_replay` value onto
  workspace-row links on the Dashboard when present.
- **Modify:** `webapp/static/onboarding.css` — styles for the "Why am I
  seeing this?" disclosure and the Dashboard's replay-prompt banner.
- **Modify:** `webapp/templates/base.html` — `onboarding_autotrigger`
  block mechanism, Help nav link.
- **Modify:** `webapp/templates/dashboard.html` — auto-trigger attribute;
  the "Choose a job to replay this walkthrough" prompt and empty-state
  message; a `data-onboarding-replay-target` marker on the workspace
  table so JS can find and augment row links.
- **Modify:** `webapp/templates/profile.html` — auto-trigger attribute
  (unchanged from the original plan).
- **Modify:** `webapp/templates/workspace_detail.html` — auto-trigger
  attribute for `job_workflow_intro` (unchanged from the original plan).
- **Create:** `webapp/templates/walkthroughs.html` — the Help →
  Walkthroughs launcher page, with real navigation links (not JS-only
  buttons) built from `WALKTHROUGH_LAUNCH_CONTEXTS`.
- **Modify:** `webapp/api/views.py` — `GET /walkthroughs` route, passing
  launch-context data to the template; Dashboard route passes through
  whether any workspace exists (for the empty-state replay message).
- **Test:** five new Playwright acceptance test files (Tasks 4-6 below).

No changes to `product/onboarding.py`, `webapp/services/onboarding.py`,
`webapp/persistence/onboarding.py`, or `webapp/api/onboarding.py` — the
engine and its HTTP surface need no changes; this bundle is entirely
launch-routing, wiring, and a new read-only catalogue page.

---

## Design notes carried into the tasks below

**Why launch context is separate metadata, not a new `WalkthroughDefinition`
field:** it is navigation/routing information the *webapp* needs, not
something the pure Ticket 1 engine (`product/onboarding.py`) has any use
for — the engine only ever deals with step targets and transitions, never
with which URL a walkthrough "belongs to." Keeping it in
`product/onboarding_walkthroughs.py` (already the home of walkthrough
*content*, as opposed to *engine mechanism*) matches that existing
architectural boundary. It is intentionally as small as possible:

```python
WALKTHROUGH_LAUNCH_CONTEXTS: dict[str, dict[str, str]] = {
    "dashboard_intro": {"context": "page", "path": "/"},
    "candidate_profile_intro": {"context": "page", "path": "/profile"},
    "job_workflow_intro": {"context": "workspace"},
    "document_workflow_intro": {"context": "workspace"},
}
```

**Why the Dashboard, not a new `/workspaces` list page, is the
"choose a job" destination:** there is no separate HTML workspace-list
page in this app — `webapp/templates/dashboard.html` already *is* the job
list (the workspaces table with filters), confirmed by reading
`webapp/api/views.py`'s full route inventory (`GET /workspaces` is a
JSON-only API route in `webapp/api/workspaces.py`, not an HTML page).
Reusing the Dashboard avoids inventing a redundant page.

**Why the replay-forwarding from Dashboard to a workspace is JS, not a
server-side redirect:** the Dashboard's existing workspace row links
(`<a class="row-link" href="/workspaces/{{ ws.id }}">`) are static Jinja
output computed once at render time; there's no per-request knowledge of
"the user is mid-replay-selection" that would justify server-side
awareness. A tiny client-side script reads `onboarding_replay` from the
current URL (if present) and appends it as a query parameter to every
row link's `href` before the user clicks one — the simplest mechanism
that requires zero new server-side state and cannot itself mutate
anything.

**Why invalid/mismatched replay ids fail closed client-side, not
server-side:** `onboarding_replay` never reaches any API endpoint as a
distinguished parameter — it's consumed entirely by
`webapp/static/onboarding.js` before calling the existing `start()`,
which itself already 404s cleanly for an unknown `walkthrough_id` via the
existing `WalkthroughNotFound` → HTTP 404 path (Ticket 1). The only new
validation this bundle adds is confirming the *requested* id's launch
context matches the *current* page's context before ever calling
`start()` — e.g. `job_workflow_intro` requested while on `/profile` must
not be honored, even though the walkthrough id itself is valid, because
this page cannot render its real targets.

---

### Task 1: Launch-context metadata

**Files:**
- Modify: `product/onboarding_walkthroughs.py`
- Test: `tests/test_onboarding_walkthroughs_content.py` (extended)

**Interfaces:**
- Produces (for Task 2's JS and Task 3's templates):
  `WALKTHROUGH_LAUNCH_CONTEXTS: dict[str, dict[str, str]]`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_onboarding_walkthroughs_content.py`:

```python
def test_every_registered_walkthrough_has_a_launch_context():
    from product.onboarding import WALKTHROUGH_REGISTRY
    from product.onboarding_walkthroughs import (
        WALKTHROUGH_LAUNCH_CONTEXTS,
        register_default_walkthroughs,
    )

    register_default_walkthroughs()
    for walkthrough_id in (
        "dashboard_intro", "candidate_profile_intro",
        "job_workflow_intro", "document_workflow_intro",
    ):
        assert walkthrough_id in WALKTHROUGH_LAUNCH_CONTEXTS
        assert walkthrough_id in WALKTHROUGH_REGISTRY


def test_page_context_walkthroughs_declare_a_fixed_path():
    from product.onboarding_walkthroughs import WALKTHROUGH_LAUNCH_CONTEXTS

    assert WALKTHROUGH_LAUNCH_CONTEXTS["dashboard_intro"] == {"context": "page", "path": "/"}
    assert WALKTHROUGH_LAUNCH_CONTEXTS["candidate_profile_intro"] == {
        "context": "page", "path": "/profile",
    }


def test_workspace_context_walkthroughs_declare_no_fixed_path():
    from product.onboarding_walkthroughs import WALKTHROUGH_LAUNCH_CONTEXTS

    assert WALKTHROUGH_LAUNCH_CONTEXTS["job_workflow_intro"] == {"context": "workspace"}
    assert WALKTHROUGH_LAUNCH_CONTEXTS["document_workflow_intro"] == {"context": "workspace"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_onboarding_walkthroughs_content.py -v -k launch_context`
Expected: FAIL — `ImportError: cannot import name 'WALKTHROUGH_LAUNCH_CONTEXTS'`

- [ ] **Step 3: Add the mapping**

Add to `product/onboarding_walkthroughs.py`, after
`register_default_walkthroughs`:

```python
WALKTHROUGH_LAUNCH_CONTEXTS: dict[str, dict[str, str]] = {
    "dashboard_intro": {"context": "page", "path": "/"},
    "candidate_profile_intro": {"context": "page", "path": "/profile"},
    "job_workflow_intro": {"context": "workspace"},
    "document_workflow_intro": {"context": "workspace"},
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_onboarding_walkthroughs_content.py -v`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: worktree
`C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`,
branch `feature/contextual-onboarding`, HEAD still `6589f58`, status shows
only the modified content module and test file. Stop on drift.

- [ ] **Step 6: Commit**

```bash
git add product/onboarding_walkthroughs.py tests/test_onboarding_walkthroughs_content.py
git commit -m "feat(onboarding): add walkthrough launch-context metadata"
```

---

### Task 2: onboarding.js — auto-trigger bootstrap, replay bootstrap, why-am-I-seeing-this

**Files:**
- Modify: `webapp/static/onboarding.js`
- Modify: `webapp/static/onboarding.css`

**Interfaces:**
- Consumes: `GET /api/onboarding/walkthroughs/{id}` (Ticket 1), the
  existing `start()` (Ticket 2) — both unchanged.
- Produces: a `DOMContentLoaded` bootstrap that handles, in order: (1)
  `onboarding_replay` query param (explicit replay — validated against a
  page-supplied allow-list, see below), (2) `data-onboarding-autotrigger`
  (automatic first use). Also produces
  `window.Onboarding.appendReplayParamToLinks(selector)`, a small helper
  the Dashboard template calls to forward a pending replay intent onto
  workspace row links.

- [ ] **Step 1: Add the in-memory flags**

Add near `let previouslyFocusedEl = null;`:

```javascript
  let openedAutomatically = false;
```

(No separate "explicit replay" flag is needed — "Why am I seeing this?"
is shown only when `openedAutomatically` is true, and explicit replay
never sets it, matching "the user already knows why they're seeing it"
for every manual/explicit path: Take-the-tour clicks, Help-page replay
navigation, and Dashboard-forwarded workspace replay all count as
explicit.)

- [ ] **Step 2: Add the page-supplied valid-replay-ids allow-list convention**

Rather than hard-coding `WALKTHROUGH_LAUNCH_CONTEXTS` into JavaScript
(which would duplicate Python-side data and risk drifting out of sync),
each page that can be a replay destination declares which walkthrough id
it is valid for via a `data-onboarding-valid-replay` attribute on
`<body>` — the *same* mechanism already used for `data-onboarding-
autotrigger`, reusing the pattern rather than inventing a second one.
For `page`-context walkthroughs this is a single fixed id (e.g.
Dashboard's `<body>` always carries `data-onboarding-valid-replay=
"dashboard_intro"`). For the Dashboard specifically, which is also the
`workspace`-context forwarding hub, it must accept *either* its own id
or forward unrecognized-but-known-workspace ids onward — handled in Step
5 below via a distinct, explicit check rather than overloading this
attribute.

- [ ] **Step 3: Implement the bootstrap, replacing the Task-1-only version from the original plan**

Add at the end of the IIFE, just before `return {start};`:

```javascript
  function _consumeReplayParam() {
    const params = new URLSearchParams(window.location.search);
    const replayId = params.get("onboarding_replay");
    if (!replayId) return null;
    const url = new URL(window.location.href);
    url.searchParams.delete("onboarding_replay");
    window.history.replaceState({}, "", url.toString());
    return replayId;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const replayId = _consumeReplayParam();
    if (replayId) {
      const validReplayId = document.body.dataset.onboardingValidReplay;
      if (replayId === validReplayId) {
        start(replayId);
      }
      // An id present but not valid for this page fails closed silently
      // -- the parameter is already stripped above, so a reload will not
      // retry it, and no walkthrough starts on a page it wasn't authored
      // for. Dashboard's own workspace-forwarding case (Step 5) is
      // handled separately, before this generic check, and returns
      // early when it applies.
      return;
    }

    const autotriggerId = document.body.dataset.onboardingAutotrigger;
    if (!autotriggerId) return;
    apiCall(`/api/onboarding/walkthroughs/${autotriggerId}`)
      .then((status) => {
        if (status.status !== "not_started") return;
        openedAutomatically = true;
        return start(autotriggerId);
      })
      .catch(() => {});
  });

  function appendReplayParamToLinks(selector) {
    const params = new URLSearchParams(window.location.search);
    const replayId = params.get("onboarding_replay");
    if (!replayId) return;
    document.querySelectorAll(selector).forEach((link) => {
      const url = new URL(link.href, window.location.href);
      url.searchParams.set("onboarding_replay", replayId);
      link.href = url.toString();
    });
  }
```

Note: `appendReplayParamToLinks` deliberately reads the *live* URL (not
`_consumeReplayParam`'s stripped version) so the Dashboard can both show
its own "choose a job" prompt (reading the param) and forward it onto row
links, before the bootstrap's own `_consumeReplayParam` call strips it.
Order these two calls correctly in Task 3's Dashboard-specific inline
call (`appendReplayParamToLinks` must run, and the prompt must render,
before -- or independent of -- the generic bootstrap's
`_consumeReplayParam`, since the Dashboard is a `page`-context
destination for `dashboard_intro` specifically, not for the forwarded
`job_workflow_intro`/`document_workflow_intro` ids it is merely carrying
through). Concretely: the Dashboard's `data-onboarding-valid-replay` is
always `"dashboard_intro"` only; a forwarded `job_workflow_intro` id
arriding at `/` is *not* valid for the Dashboard itself and must not
trigger `start()` there -- it must only populate the "choose a job"
prompt and be appended to row links. Implement this as a Dashboard-only
inline check (Task 3), not inside the generic bootstrap.

Update `_close()` and `_failStepGracefully()` to reset the flag (the
`openedAutomatically = false;` line each already needs, per the original
plan's Task 1 Steps 1 and unchanged here):

```javascript
  function _close() {
    if (!state) return;
    _teardownDom();
    const restoreTarget = previouslyFocusedEl;
    state = null;
    previouslyFocusedEl = null;
    openedAutomatically = false;
    if (restoreTarget && document.body.contains(restoreTarget)) {
      restoreTarget.focus();
    }
  }
```

```javascript
  function _failStepGracefully() {
    const walkthroughId = state.walkthroughId;
    _teardownDom();
    state = null;
    openedAutomatically = false;
    apiCall(`/api/onboarding/walkthroughs/${walkthroughId}/interrupt`, {method: "POST"})
      .catch(() => {});
    _showFailNotice();
  }
```

- [ ] **Step 4: Add the "Why am I seeing this?" disclosure to `_renderStep()`**

Modify the template string inside `_renderStep()`:

```javascript
    state.popoverEl.innerHTML = `
      <button type="button" class="onboarding-popover-close" aria-label="Close walkthrough">&times;</button>
      <p class="onboarding-popover-progress">Step ${index + 1} of ${total}</p>
      <h2 class="onboarding-popover-title" id="onboarding-popover-title">${_escapeHtml(step.title)}</h2>
      <p class="onboarding-popover-body" id="onboarding-popover-body">${_escapeHtml(step.body)}</p>
      ${openedAutomatically ? `
      <details class="onboarding-why-seeing-this">
        <summary>Why am I seeing this?</summary>
        <p>This is a first-use guide for this feature. You can skip it any
        time. Once you finish or skip it, it won't interrupt you again --
        you can always replay it later from Help &rarr; Walkthroughs.</p>
      </details>` : ""}
      <div class="onboarding-popover-controls">
        <div class="onboarding-popover-controls-primary">
          ${index > 0 ? '<button type="button" class="button secondary" data-onboarding-action="back">Back</button>' : ""}
          <label class="onboarding-popover-dont-show"><input type="checkbox" data-onboarding-dont-show-again> Don't show this automatically again</label>
          <button type="button" class="button secondary" data-onboarding-action="skip">Skip</button>
        </div>
        <button type="button" class="button" data-onboarding-action="${index === total - 1 ? "finish" : "next"}">${index === total - 1 ? "Finish" : "Next"}</button>
      </div>`;
```

- [ ] **Step 5: Expose `appendReplayParamToLinks` on the public `window.Onboarding` object**

```javascript
  return {start, appendReplayParamToLinks};
```

- [ ] **Step 6: Style the disclosure and the (later, Task 3) Dashboard prompt banner**

Add to `webapp/static/onboarding.css`:

```css
.onboarding-why-seeing-this{margin:0 0 12px;font-size:12px;color:var(--muted)}
.onboarding-why-seeing-this summary{cursor:pointer;font-weight:600;color:var(--ink)}
.onboarding-why-seeing-this p{margin:6px 0 0}
.onboarding-replay-prompt{background:var(--amber-soft,#fff1c9);color:#664400;padding:12px 16px;border-radius:10px;margin-bottom:16px}
```

- [ ] **Step 7: Manually verify no syntax errors**

Run: `node --check webapp/static/onboarding.js`
Expected: no output. If `node` is unavailable, defer verification to
Task 3/4's manual page-render checks.

- [ ] **Step 8: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 1's commit, status shows only
the two modified static files. Stop on drift.

- [ ] **Step 9: Commit**

```bash
git add webapp/static/onboarding.js webapp/static/onboarding.css
git commit -m "feat(onboarding): add auto-trigger and explicit-replay bootstrap with why-am-I-seeing-this"
```

---

### Task 3: Wire pages — auto-trigger attributes, Dashboard replay-forwarding, Help page

**Files:**
- Modify: `webapp/templates/base.html`
- Modify: `webapp/templates/dashboard.html`
- Modify: `webapp/templates/profile.html`
- Modify: `webapp/templates/workspace_detail.html`
- Create: `webapp/templates/walkthroughs.html`
- Modify: `webapp/api/views.py`

**Interfaces:**
- Consumes: `WALKTHROUGH_LAUNCH_CONTEXTS` (Task 1),
  `list_walkthrough_statuses` (Ticket 1, unchanged),
  `window.Onboarding.appendReplayParamToLinks` (Task 2).
- Produces: `data-onboarding-autotrigger` and `data-onboarding-valid-
  replay` attributes on the four pages; the Dashboard's replay-choice
  prompt; `GET /walkthroughs`.

- [ ] **Step 1: Add the block mechanism and Help nav link to base.html**

```html
<body{% block onboarding_autotrigger %}{% endblock %}{% block onboarding_valid_replay %}{% endblock %}>
```

Add to the nav, after "Evidence Profile":

```html
<a href="/how-it-works">How it works</a><a href="/search-workspaces">Manage searches</a><a href="/profile">Evidence Profile</a><a href="/walkthroughs">Help</a>
```

- [ ] **Step 2: Wire dashboard.html**

At the top, after `{% extends %}`/`{% block title %}`:

```html
{% block onboarding_autotrigger %} data-onboarding-autotrigger="dashboard_intro"{% endblock %}
{% block onboarding_valid_replay %} data-onboarding-valid-replay="dashboard_intro"{% endblock %}
```

Add the "choose a job" prompt right after the existing hero section (this
must render conditionally based on the `onboarding_replay` query param,
which is a request-time value — pass it from the view route, see Step 6):

```html
{% if pending_workspace_replay %}<div class="onboarding-replay-prompt" role="status">
  {% if workspaces %}Choose a job below to replay this walkthrough.
  {% else %}This walkthrough becomes available once you have a job to work with. <a href="/new-job">Add a job</a> to get started.{% endif %}
</div>{% endif %}
```

Add `data-onboarding-replay-target` to the workspace table wrapper so the
JS helper can scope its link-augmentation:

```html
<div class="table-wrap" data-onboarding-replay-target><table>
```

Add a small inline script at the bottom of the content block (after the
existing table markup, before `{% endblock %}`) to call the helper on
load:

```html
<script>
  document.addEventListener("DOMContentLoaded", () => {
    if (window.Onboarding && window.Onboarding.appendReplayParamToLinks) {
      window.Onboarding.appendReplayParamToLinks('[data-onboarding-replay-target] a.row-link');
    }
  });
</script>
```

This inline script only calls an already-defined, already-safe public
function — it performs no state mutation itself and is scoped to link
augmentation only, matching "keep this light" for onboarding surfacing.

- [ ] **Step 3: Wire profile.html (unchanged from the original plan)**

```html
{% block onboarding_autotrigger %}{% if not setup_required %} data-onboarding-autotrigger="candidate_profile_intro"{% endif %}{% endblock %}
{% block onboarding_valid_replay %} data-onboarding-valid-replay="candidate_profile_intro"{% endblock %}
```

- [ ] **Step 4: Wire workspace_detail.html**

```html
{% block onboarding_autotrigger %} data-onboarding-autotrigger="job_workflow_intro"{% endblock %}
{% block onboarding_valid_replay %} data-onboarding-valid-replay="{{ onboarding_replay_expected or 'job_workflow_intro' }}"{% endblock %}
```

Why the conditional: this page is the destination for *both*
`job_workflow_intro` (auto-trigger's own id) *and*
`document_workflow_intro` (forwarded here by the Dashboard when a
document-workflow replay was requested). The view route (Step 6) computes
`onboarding_replay_expected` from the incoming `onboarding_replay` query
param when it matches either of this page's two known walkthrough ids,
defaulting to `job_workflow_intro` otherwise so the auto-trigger's own
implicit validity is preserved when no replay is in flight.

- [ ] **Step 5: Create the Help page template**

```html
{% extends "base.html" %}
{% block title %}Help · Walkthroughs · Job Search Workspace{% endblock %}
{% block content %}
<section class="hero compact"><div><p class="eyebrow">Help</p><h1>Walkthroughs</h1>
<p>Short guided tours for each part of JobSearch. Replay any of them whenever you want a refresher -- each one runs on the real page it teaches.</p></div></section>

<div class="table-wrap"><table>
  <thead><tr><th>Walkthrough</th><th>Status</th><th></th></tr></thead>
  <tbody>
  {% for item in walkthrough_statuses %}<tr>
    <td><strong>{{ item.title }}</strong><small>{{ item.step_count }} step{{ 's' if item.step_count != 1 else '' }}</small></td>
    <td>{% if item.status == 'completed' %}<span class="badge complete">Completed</span>
      {% elif item.status == 'in_progress' %}<span class="badge review">In progress</span>
      {% elif item.status == 'skipped' %}<span class="badge neutral">Skipped</span>
      {% else %}<span class="badge neutral">Not started</span>{% endif %}</td>
    <td><a class="button button-small secondary" href="{{ replay_links[item.walkthrough_id] }}">{% if item.status in ('completed', 'skipped') %}Replay{% elif item.status == 'in_progress' %}Resume{% else %}Start{% endif %}</a></td>
  </tr>{% endfor %}
  </tbody>
</table></div>
{% if not walkthrough_statuses %}<section class="empty-state"><h2>No walkthroughs available yet</h2></section>{% endif %}
{% endblock %}
```

Note: Replay controls are real `<a href>` navigation links, not
JS-triggered buttons -- this is the concrete expression of "Help is a
launcher, not an execution surface." Clicking one performs a normal page
navigation to the walkthrough's real destination with
`?onboarding_replay=<id>` attached; Task 2's bootstrap does the rest once
that page loads.

- [ ] **Step 6: Add the routes and view-model wiring**

In `webapp/api/views.py`, add the import:

```python
from product.onboarding_walkthroughs import WALKTHROUGH_LAUNCH_CONTEXTS
from webapp.services.onboarding import list_walkthrough_statuses
```

Add the Help route:

```python
@router.get("/walkthroughs", response_class=HTMLResponse)
def walkthroughs_page(
    request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    statuses = list_walkthrough_statuses(conn, account_id=scope.account_id)
    replay_links = {}
    for item in statuses:
        launch = WALKTHROUGH_LAUNCH_CONTEXTS.get(item["walkthrough_id"])
        if launch is None:
            continue
        if launch["context"] == "page":
            replay_links[item["walkthrough_id"]] = (
                f"{launch['path']}?onboarding_replay={item['walkthrough_id']}"
            )
        else:
            replay_links[item["walkthrough_id"]] = (
                f"/?onboarding_replay={item['walkthrough_id']}"
            )
    return request.app.state.templates.TemplateResponse(
        request, "walkthroughs.html", {
            "walkthrough_statuses": statuses,
            "replay_links": replay_links,
            **_search_context(conn, scope.account_id),
        }
    )
```

Modify the existing `dashboard` route to compute
`pending_workspace_replay` from the incoming query parameter:

```python
@router.get("/", response_class=HTMLResponse)
def dashboard(
    request: Request, filter: str = "active",
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    if filter not in {"all", "active", "drafted", "applied", "interview", "offer", "final"}:
        filter = "active"
    view = build_dashboard_view_model(
        conn, filter_name=filter,
        extensions_dir=request.app.state.settings.extensions_dir,
        account_id=scope.account_id,
    )
    pending_replay = request.query_params.get("onboarding_replay")
    return request.app.state.templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            **view,
            "pending_workspace_replay": (
                pending_replay
                in ("job_workflow_intro", "document_workflow_intro")
            ),
            **_search_context(conn, scope.account_id),
        },
    )
```

Modify `workspace_detail_page` to compute `onboarding_replay_expected`:

```python
@router.get("/workspaces/{workspace_id}", response_class=HTMLResponse)
def workspace_detail_page(
    workspace_id: str, request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    try:
        view = build_workspace_view_model(
            conn, workspace_id,
            extensions_dir=request.app.state.settings.extensions_dir,
            account_id=scope.account_id,
        )
    except JobWorkspaceNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    pending_replay = request.query_params.get("onboarding_replay")
    onboarding_replay_expected = (
        pending_replay
        if pending_replay in ("job_workflow_intro", "document_workflow_intro")
        else None
    )
    return request.app.state.templates.TemplateResponse(
        request, "workspace_detail.html",
        {
            **view,
            "onboarding_replay_expected": onboarding_replay_expected,
            **_search_context(conn, scope.account_id),
        }
    )
```

Read the current, real bodies of these two routes in
`webapp/api/views.py` before editing -- this plan reproduces them from
Ticket 3/4's known-good state, but confirm no drift occurred since, and
merge these additions into whatever the current bodies actually are
rather than blindly overwriting.

- [ ] **Step 7: Manually verify all pages render correctly together**

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

    dashboard = client.get('/')
    assert 'data-onboarding-autotrigger=\"dashboard_intro\"' in dashboard.text
    assert 'href=\"/walkthroughs\"' in dashboard.text

    dashboard_no_jobs_replay = client.get('/?onboarding_replay=job_workflow_intro')
    assert 'Choose a job below' in dashboard_no_jobs_replay.text or 'becomes available once you have a job' in dashboard_no_jobs_replay.text

    ws = client.get(f'/workspaces/{workspace[\"id\"]}')
    assert 'data-onboarding-autotrigger=\"job_workflow_intro\"' in ws.text

    ws_doc_replay = client.get(f'/workspaces/{workspace[\"id\"]}?onboarding_replay=document_workflow_intro')
    assert 'data-onboarding-valid-replay=\"document_workflow_intro\"' in ws_doc_replay.text

    help_page = client.get('/walkthroughs')
    assert help_page.status_code == 200
    assert 'onboarding_replay=dashboard_intro' in help_page.text
    assert 'onboarding_replay=job_workflow_intro' in help_page.text
    print('ok')
"
```
Expected: prints `ok`

- [ ] **Step 8: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 2's commit, status shows the
new Help template and all modified templates/views. Stop on drift.

- [ ] **Step 9: Commit**

```bash
git add webapp/templates/base.html webapp/templates/dashboard.html \
  webapp/templates/profile.html webapp/templates/workspace_detail.html \
  webapp/templates/walkthroughs.html webapp/api/views.py
git commit -m "feat(onboarding): add Help launcher page and workspace-context replay forwarding"
```

---

### Task 4: First-use trigger and explicit-replay acceptance

**Files:**
- Create: `tests/webapp/test_onboarding_first_use_triggers_browser_smoke.py`
- Create: `tests/webapp/test_onboarding_help_replay_browser_smoke.py`

**Interfaces:**
- Consumes: everything from Tasks 1-3, through real pages only.

- [ ] **Step 1: Write first-use trigger tests**

```python
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

    page.get_by_role("button", name="Finish", exact=False).click()
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
```

- [ ] **Step 2: Write the explicit-replay acceptance tests**

```python
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
    # First complete it so Help shows "Replay" rather than "Start".
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
    # Explicit replay is not an auto-trigger -- no disclosure shown.
    assert page.locator(".onboarding-why-seeing-this").count() == 0
    # The query parameter must be gone from the visible URL.
    assert "onboarding_replay" not in page.url


def test_candidate_profile_replay_navigates_and_starts_against_real_targets(live_server, page):
    # Candidate Profile only auto-triggers once a profile exists; force a
    # completed state first via direct API calls is unnecessary here --
    # confirm replay works even from not_started, since explicit replay
    # must work regardless of status per the corrected design (though a
    # not_started walkthrough replaying is functionally begin()).
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
    # No fake workspace was created.
    assert page.locator(".onboarding-popover").count() == 0


def test_selecting_a_workspace_carries_replay_intent_and_starts_job_workflow_tour(live_server_with_job, page):
    page.goto(
        f"{live_server_with_job.base_url}/?onboarding_replay=job_workflow_intro",
        wait_until="networkidle",
    )
    assert page.get_by_text("Choose a job below", exact=False).is_visible()
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("a.row-link").first.click()
    assert "onboarding_replay=job_workflow_intro" in page.url
    page.wait_for_timeout(300)
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
    # candidate_profile_intro requested on the Dashboard, which only
    # accepts dashboard_intro -- must fail closed, not start the wrong
    # walkthrough with mismatched real targets.
    page.goto(
        live_server.base_url + "/?onboarding_replay=candidate_profile_intro",
        wait_until="networkidle",
    )
    page.wait_for_timeout(500)
    assert page.locator(".onboarding-popover").count() == 0
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/webapp/test_onboarding_first_use_triggers_browser_smoke.py tests/webapp/test_onboarding_help_replay_browser_smoke.py -v`
Expected: FAIL if run before Tasks 1-3 land; PASS-confirming run if run
after (same allowance as prior tickets' plans).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/webapp/test_onboarding_first_use_triggers_browser_smoke.py tests/webapp/test_onboarding_help_replay_browser_smoke.py -v`
Expected: PASS (all 15 tests). If
`test_candidate_profile_replay_navigates_and_starts_against_real_targets`'s
direct `/api/profile/setup/basic` call doesn't match the real endpoint's
exact body shape, read `webapp/api/profile.py` to confirm the actual
contract and adjust rather than guessing further.

- [ ] **Step 5: Run the flake-check loop**

Run four times: `pytest tests/webapp/test_onboarding_first_use_triggers_browser_smoke.py tests/webapp/test_onboarding_help_replay_browser_smoke.py -q`
Expected: PASS all four runs, 15/15 each time.

- [ ] **Step 6: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 3's commit, status shows only
the two new test files. Stop on drift.

- [ ] **Step 7: Commit**

```bash
git add tests/webapp/test_onboarding_first_use_triggers_browser_smoke.py \
  tests/webapp/test_onboarding_help_replay_browser_smoke.py
git commit -m "test(onboarding): add first-use trigger and explicit-replay acceptance coverage"
```

---

### Task 5: Accessibility and responsive acceptance

**Files:**
- Create: `tests/webapp/test_onboarding_accessibility_responsive_browser_smoke.py`

**Interfaces:**
- Consumes: the overlay mechanism from Ticket 2 (unchanged) plus Task 2's
  "Why am I seeing this?" disclosure, exercised against a real
  auto-triggered walkthrough rather than Ticket 2's synthetic one.

- [ ] **Step 1: Write the accessibility and responsive tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/test_onboarding_accessibility_responsive_browser_smoke.py -v`
Expected: FAIL if run before Task 2's disclosure lands; PASS-confirming
run if run after.

- [ ] **Step 3: Run tests to verify they pass**

Run: `pytest tests/webapp/test_onboarding_accessibility_responsive_browser_smoke.py -v`
Expected: PASS (all 5 tests)

- [ ] **Step 4: Run the flake-check loop**

Run four times: `pytest tests/webapp/test_onboarding_accessibility_responsive_browser_smoke.py -q`
Expected: PASS all four runs, 5/5 each time. If the keyboard-journey
test's bounded Tab loop flakes, tighten the retry bound rather than
adding a longer sleep.

- [ ] **Step 5: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 4's commit, status shows only
the new test file. Stop on drift.

- [ ] **Step 6: Commit**

```bash
git add tests/webapp/test_onboarding_accessibility_responsive_browser_smoke.py
git commit -m "test(onboarding): add accessibility and responsive acceptance coverage"
```

---

### Task 6: Cumulative full-system acceptance and mutation-guard sweep

**Files:**
- Create: `tests/webapp/test_onboarding_full_acceptance_browser_smoke.py`

**Interfaces:**
- Consumes: everything built across Tickets 1-4, Bundle A, and this
  bundle's Tasks 1-5.

- [ ] **Step 1: Write the cumulative acceptance and mutation-guard sweep**

```python
"""Cumulative Bundle B acceptance: the complete onboarding system proven
end-to-end via the corrected launcher/replay model, plus the full-list
mutation-guard sweep."""
from __future__ import annotations

from tests.webapp.test_browser_smoke import (
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

    # Job workflow: launch from Help, choose the one real workspace.
    page.goto(live_server.base_url + "/walkthroughs", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("table tbody tr", has_text="Working a job through JobSearch").get_by_role(
            "link"
        ).click()
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("a.row-link").first.click()
    page.wait_for_timeout(300)
    if page.locator(".onboarding-popover").count():
        page.get_by_role("button", name="Skip").click()
        page.wait_for_selector(".onboarding-popover", state="detached")

    # Document workflow: same launcher path.
    page.goto(live_server.base_url + "/walkthroughs", wait_until="networkidle")
    with page.expect_navigation(wait_until="networkidle"):
        page.locator("table tbody tr", has_text="Your CV and cover letter").get_by_role(
            "link"
        ).click()
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
    assert page.locator('button:has-text("Submit")').count() == 0


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
    with page.expect_navigation(wait_until="networkidle"):
        page.get_by_role("button", name="Mark applied — I submitted externally").click()
    assert page.get_by_text("applied", exact=False).first.is_visible()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/test_onboarding_full_acceptance_browser_smoke.py -v`
Expected: FAIL before Tasks 1-3 land; PASS-confirming run after.

- [ ] **Step 3: Run tests to verify they pass**

Run: `pytest tests/webapp/test_onboarding_full_acceptance_browser_smoke.py -v`
Expected: PASS (both tests). If the final status-text assertion is
fragile against the real rendered markup, inspect
`workspace_detail.html`'s current status-section text directly and
adjust rather than guessing further.

- [ ] **Step 4: Run the flake-check loop**

Run four times: `pytest tests/webapp/test_onboarding_full_acceptance_browser_smoke.py -q`
Expected: PASS all four runs, 2/2 each time.

- [ ] **Step 5: Run the complete relevant regression set**

Run: `pytest tests/webapp/test_browser_smoke.py tests/webapp/test_full_journey_acceptance.py tests/webapp/test_onboarding_overlay_browser_smoke.py tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py tests/webapp/test_onboarding_document_walkthrough_browser_smoke.py tests/webapp/test_onboarding_first_use_triggers_browser_smoke.py tests/webapp/test_onboarding_help_replay_browser_smoke.py tests/webapp/test_onboarding_accessibility_responsive_browser_smoke.py tests/webapp/api/test_onboarding_routes.py tests/webapp/services/test_onboarding_service.py tests/webapp/persistence/test_onboarding.py -v`
Expected: PASS across all files -- the first time every onboarding test
file from Tickets 1-4, Bundle A, and Bundle B run together in one
process, which is where a global-state leak between test modules (e.g.
`WALKTHROUGH_REGISTRY` accumulating test-only entries registered by
earlier tickets' test fixtures) would first surface. If any test fails
only in this combined run and not in isolation, isolate and report it
distinctly rather than reordering or skipping tests to make it pass.

- [ ] **Step 6: Run the full webapp and product regression suites**

Run: `pytest tests/webapp -q` and `pytest tests -q --ignore=tests/webapp`
Expected: PASS across both.

- [ ] **Step 7: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 5's commit (six commits total
ahead of `6589f58` across this bundle), status shows only the new test
file. Stop on drift.

- [ ] **Step 8: Commit**

```bash
git add tests/webapp/test_onboarding_full_acceptance_browser_smoke.py
git commit -m "test(onboarding): add cumulative full-system acceptance and mutation-guard sweep"
```

---

## Post-Bundle-B Report Checklist

Before reporting Bundle B complete, confirm:
- [ ] Six commits on `feature/contextual-onboarding`, each corresponding
  to one task above, all ahead of Bundle A's final commit `6589f58`.
- [ ] `git log --oneline 6589f58..HEAD` shows exactly these six commits,
  nothing else.
- [ ] `git status --short` clean.
- [ ] Full test suite passes (`pytest -q`).
- [ ] `git diff --check` clean.
- [ ] No file outside `product/onboarding_walkthroughs.py`,
  `webapp/static/onboarding.js`, `webapp/static/onboarding.css`,
  `webapp/templates/base.html`, `webapp/templates/dashboard.html`,
  `webapp/templates/profile.html`, `webapp/templates/workspace_detail.html`,
  `webapp/templates/walkthroughs.html`, `webapp/api/views.py`, and the
  five new test files was touched.
- [ ] Exactly four walkthroughs auto-trigger; Document workflow remains
  manual-only on the shared workspace page.
- [ ] Help → Walkthroughs is a launcher only -- no walkthrough is ever
  started while the browser is on `/walkthroughs` itself; every replay
  link navigates to the walkthrough's real page first.
- [ ] Workspace-context replay (Job workflow, Document workflow) never
  guesses or auto-selects a workspace; with none available it shows a
  plain explanatory message and creates nothing.
- [ ] Selecting a workspace after a pending replay intent correctly
  forwards that intent to the workspace-detail page and starts the
  correct tour there.
- [ ] Invalid and mismatched `onboarding_replay` values fail closed --
  proven by dedicated tests -- and the parameter is always stripped from
  the visible URL after being read, whether valid or not.
- [ ] Explicit replay works on a `completed`/`skipped` walkthrough and
  never resets `times_completed`.
- [ ] A completed or skipped walkthrough never auto-reopens on a later
  visit; an interrupted (navigated-away-from) walkthrough is never marked
  complete and never auto-reopens.
- [ ] "Why am I seeing this?" appears only for genuine auto-triggered
  opens, never for manual "Take the tour" clicks or explicit replay.
- [ ] A full keyboard-only journey completes a real walkthrough; a
  constrained mobile viewport renders and remains operable; ARIA wiring
  verified against a real popover instance.
- [ ] The cumulative mutation-guard sweep proves driving every
  walkthrough via its real launcher flow in one session causes zero
  mutation across the complete forbidden-action list.
- [ ] Existing Dashboard, Candidate Profile, job workflow,
  document-finalization, and full-journey acceptance suites remain green,
  run together with every onboarding test file in one process.
- [ ] Any genuine pre-existing product/infrastructure defect discovered
  during this bundle is isolated and reported distinctly.
- [ ] The application-handoff/extension walkthrough remains deferred --
  no first-use wiring, no Help-page entry, no new UI added for it.
- [ ] Nothing pushed; `master` untouched; no other worktree touched.
- [ ] Stop here and report back before beginning Bundle C (final
  cumulative verification and integration gate).
