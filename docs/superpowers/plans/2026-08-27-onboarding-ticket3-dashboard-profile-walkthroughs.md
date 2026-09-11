# Onboarding Ticket 3: Dashboard and Candidate Profile Walkthroughs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first two real, contextual walkthroughs — Dashboard and
Candidate Profile — as pure data registered against the Ticket 1 engine and
rendered by the Ticket 2 overlay. No new UI mechanism, no redesign of
either page, no data mutation from walking through either tour.

**Architecture:** A new `product/onboarding_walkthroughs.py` module holds
the two `WalkthroughDefinition`s as static data (this is the first content
in that slot the Ticket 1/2 design anticipated: "feature-specific
walkthroughs are primarily configuration/data, not individually
hard-coded modal implementations"). `webapp/app.py`'s `create_app` lifespan
calls a new `register_default_walkthroughs()` at startup — this is also
new: Ticket 1 built the registry mechanism but nothing before this ticket
ever populated it outside tests. `dashboard.html` and `profile.html` gain
`data-onboarding-target` attributes on real, already-existing elements
(no new DOM, no redesign). A small "Take the tour" trigger button is added
to each page so the walkthroughs are reachable now, ahead of Ticket 7's
first-use triggers and Help → Walkthroughs entry point — Ticket 7 will
replace or supplement this trigger, not this ticket.

**Tech Stack:** Same as Tickets 1-2 — Python/FastAPI/Jinja2, vanilla JS,
pytest + pytest-playwright for acceptance.

**Spec:** The Ticket 3 section of the contextual-onboarding stream brief
(conversation-supplied). Builds on
`docs/superpowers/plans/2026-08-27-onboarding-ticket1-state-engine.md` and
`docs/superpowers/plans/2026-08-27-onboarding-ticket2-overlay.md`.

## Global Constraints

- Frozen baseline commit: `12224eeb6d401209ed0da6fe1360fc90a722bc98`. Work
  happens only on branch `feature/contextual-onboarding` in worktree
  `C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`.
  Never touch `master` or any other worktree.
- Ticket 2 is accepted at `62f873dfbf274f0fb97274ce952b00a69102b765`
  (`HEAD` at the start of this ticket). It provides: `window.Onboarding`
  overlay controller (`webapp/static/onboarding.js`), overlay stylesheet
  (`webapp/static/onboarding.css`), and the full `/api/onboarding/*`
  surface including `.../definition` (Ticket 1 + Ticket 2 combined).
- Keep this concise. No long mandatory tour on login — each walkthrough
  is 3-5 steps, one concept per step, always skippable.
- Candidate Profile walkthrough must explicitly state that JobSearch does
  not invent unsupported qualifications or experience — this is a required
  line of copy, not implied.
- Must not mutate profile/job/application data. The only network calls a
  running walkthrough makes are to `/api/onboarding/*` (progress
  bookkeeping, already proven safe in Ticket 2). No walkthrough content or
  script in this ticket may call any other API route.
- Real UI only. Every `data-onboarding-target` in this ticket must land on
  an element that already exists in `dashboard.html` or `profile.html` for
  its own reason — never an element invented to give onboarding something
  to point at.
- A step whose target is conditionally absent (e.g. Candidate Profile
  targets that only render once a profile exists) must fail gracefully
  per Ticket 2's existing mechanism — this is expected, tested behavior,
  not a defect to work around by inventing always-present markup.
- Follow existing repo conventions: Jinja2 templates, `webapp/static/
  onboarding.js`'s existing IIFE (only additive changes, if any), pytest +
  pytest-playwright acceptance tests following
  `tests/webapp/test_onboarding_overlay_browser_smoke.py`'s pattern.
- Before the first write in this worktree, and again before every commit,
  verify: `git rev-parse --show-toplevel`, `git branch --show-current`,
  `git rev-parse HEAD`, `git status --short`. Expected: this worktree path,
  branch `feature/contextual-onboarding`, HEAD `62f873d` (until Task 1's
  commit) then advancing one commit per task, clean status. Stop on drift.
- Do not push. Do not merge.

---

## File Structure

- **Create:** `product/onboarding_walkthroughs.py` — the two
  `WalkthroughDefinition`s as data, plus `register_default_walkthroughs()`.
- **Modify:** `webapp/app.py` — call `register_default_walkthroughs()` in
  `create_app`'s lifespan, before `init_db` runs (registration is
  in-memory only and doesn't depend on the database).
- **Modify:** `webapp/templates/dashboard.html` — add
  `data-onboarding-target` attributes to the hero, the "How this works"
  getting-started card, the filters nav, and the workspaces table (or
  empty-state, when there are no workspaces yet); add a small "Take the
  tour" trigger.
- **Modify:** `webapp/templates/profile.html` — add
  `data-onboarding-target` attributes to the source-management panel, the
  canonical-profile-entries panel, the "Add profile information"
  `<details>`, and the generated-evidence-claims panel; add a small "Take
  the tour" trigger.
- **Test:** `tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py`
  — Playwright acceptance proving real target resolution, correct step
  content, and (critically) that running either walkthrough end-to-end
  causes zero mutation to profile/job/application data.

No changes to `product/onboarding.py`, `webapp/services/onboarding.py`,
`webapp/persistence/onboarding.py`, `webapp/api/onboarding.py`, or
`webapp/static/onboarding.js`/`onboarding.css` — Ticket 3 is walkthrough
*content* plus the minimal startup-registration and trigger-button wiring
needed to reach that content; it does not touch the engine or overlay
mechanism built in Tickets 1-2.

---

## Walkthrough content

### Dashboard (`walkthrough_id="dashboard_intro"`)

Four steps, targeting elements that already exist in
`webapp/templates/dashboard.html`:

1. `data-onboarding-target="dashboard-hero"` (the `<section class="hero
   compact">`) — "This is your pipeline." / "JobSearch tracks every job
   you're considering, in one place, from first look to final decision."
2. `data-onboarding-target="dashboard-getting-started"` (the
   `<section class="panel getting-started-card">`) — "The stages, at a
   glance." / "Evidence Profile, then a job, then Job Fit, Intelligence,
   Review, Pack, Download, Apply — each stage is explained where it
   happens."
3. `data-onboarding-target="dashboard-filters"` (the `<nav class="filters">`)
   — "Filter by where things stand." / "Switch between Active, Drafted,
   Applied, and other stages to focus on what needs attention."
4. `data-onboarding-target="dashboard-add-job"` (already exists —
   `data-onboarding-target="add-job-button"` from Ticket 2; this ticket
   reuses that exact anchor as the walkthrough's final step rather than
   adding a duplicate attribute) — "Start with a job." / "Add a job
   posting to begin — JobSearch builds everything else, evidence-backed,
   from there."

### Candidate Profile (`walkthrough_id="candidate_profile_intro"`)

Four steps, targeting elements in `webapp/templates/profile.html` (all
inside the `{% else %}` branch, i.e. only rendered once a profile exists —
see Global Constraints on conditional targets):

1. `data-onboarding-target="profile-sources-panel"` (the "Evidence
   sources" `<section class="panel">`) — "Your evidence, one source at a
   time." / "The Candidate Profile is the one editable source. Supplemental
   sources like your CV add evidence too, but stay read-only here."
2. `data-onboarding-target="profile-entries-panel"` (the "Editable profile
   entries" `<section class="panel">`) — "Add or correct what JobSearch
   knows." / "Every entry here is something you've confirmed yourself.
   JobSearch never invents a qualification, a job title, or a skill you
   haven't entered."
3. `data-onboarding-target="profile-add-details"` (the `<details
   class="profile-add">`) — "Add new evidence here." / "Open this to add
   education, experience, skills, or certifications — one confirmed fact
   per entry."
4. `data-onboarding-target="profile-claims-panel"` (the "Generated
   evidence claims" `<section class="panel">`, only present when
   `profile` is truthy) — "This is what later stages will use." / "Job
   Fit and document generation cite these claims directly, so what you
   confirm here is what shows up in your CV and cover letter."

Both walkthroughs are 4 steps — short enough to respect "keep this
concise," long enough to cover the ticket's required talking points.

---

### Task 1: Walkthrough content module and startup registration

**Files:**
- Create: `product/onboarding_walkthroughs.py`
- Modify: `webapp/app.py`
- Test: `tests/test_onboarding_walkthroughs_content.py`

**Interfaces:**
- Consumes: `product.onboarding.{WalkthroughDefinition, WalkthroughStep,
  register_walkthrough}` (Ticket 1).
- Produces (for Task 2's template work and Task 3's acceptance tests):
  - `DASHBOARD_WALKTHROUGH: WalkthroughDefinition` (`walkthrough_id =
    "dashboard_intro"`)
  - `CANDIDATE_PROFILE_WALKTHROUGH: WalkthroughDefinition`
    (`walkthrough_id = "candidate_profile_intro"`)
  - `register_default_walkthroughs() -> None` — idempotent; calls
    `register_walkthrough` for both definitions above. Idempotent because
    `register_walkthrough` itself is a dict assignment
    (`WALKTHROUGH_REGISTRY[definition.walkthrough_id] = definition`) —
    calling it twice with the same definition is a no-op in effect, so
    `register_default_walkthroughs()` can be called from `create_app`
    every time an app is constructed (as existing tests already do
    repeatedly per-test) without needing its own guard.

- [ ] **Step 1: Write the failing content test**

```python
# tests/test_onboarding_walkthroughs_content.py
from __future__ import annotations

from product.onboarding import get_walkthrough
from product.onboarding_walkthroughs import (
    CANDIDATE_PROFILE_WALKTHROUGH,
    DASHBOARD_WALKTHROUGH,
    register_default_walkthroughs,
)


def test_dashboard_walkthrough_has_four_steps_targeting_real_dashboard_elements():
    assert DASHBOARD_WALKTHROUGH.walkthrough_id == "dashboard_intro"
    assert len(DASHBOARD_WALKTHROUGH.steps) == 4
    targets = [step.target for step in DASHBOARD_WALKTHROUGH.steps]
    assert targets == [
        '[data-onboarding-target="dashboard-hero"]',
        '[data-onboarding-target="dashboard-getting-started"]',
        '[data-onboarding-target="dashboard-filters"]',
        '[data-onboarding-target="add-job-button"]',
    ]


def test_candidate_profile_walkthrough_states_no_invented_qualifications():
    assert CANDIDATE_PROFILE_WALKTHROUGH.walkthrough_id == "candidate_profile_intro"
    bodies = " ".join(step.body for step in CANDIDATE_PROFILE_WALKTHROUGH.steps)
    assert "never invents" in bodies or "never invent" in bodies


def test_candidate_profile_walkthrough_has_four_steps_targeting_real_profile_elements():
    targets = [step.target for step in CANDIDATE_PROFILE_WALKTHROUGH.steps]
    assert targets == [
        '[data-onboarding-target="profile-sources-panel"]',
        '[data-onboarding-target="profile-entries-panel"]',
        '[data-onboarding-target="profile-add-details"]',
        '[data-onboarding-target="profile-claims-panel"]',
    ]


def test_register_default_walkthroughs_makes_both_resolvable():
    register_default_walkthroughs()
    assert get_walkthrough("dashboard_intro") is DASHBOARD_WALKTHROUGH
    assert get_walkthrough("candidate_profile_intro") is CANDIDATE_PROFILE_WALKTHROUGH


def test_register_default_walkthroughs_is_idempotent():
    register_default_walkthroughs()
    register_default_walkthroughs()
    assert get_walkthrough("dashboard_intro") is DASHBOARD_WALKTHROUGH
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_onboarding_walkthroughs_content.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'product.onboarding_walkthroughs'`

- [ ] **Step 3: Implement the content module**

```python
# product/onboarding_walkthroughs.py
from __future__ import annotations

from product.onboarding import (
    WalkthroughDefinition,
    WalkthroughStep,
    register_walkthrough,
)


DASHBOARD_WALKTHROUGH = WalkthroughDefinition(
    walkthrough_id="dashboard_intro",
    version=1,
    title="Your JobSearch dashboard",
    steps=(
        WalkthroughStep(
            step_id="hero",
            target='[data-onboarding-target="dashboard-hero"]',
            title="This is your pipeline.",
            body=(
                "JobSearch tracks every job you're considering, in one "
                "place, from first look to final decision."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="getting_started",
            target='[data-onboarding-target="dashboard-getting-started"]',
            title="The stages, at a glance.",
            body=(
                "Evidence Profile, then a job, then Job Fit, Intelligence, "
                "Review, Pack, Download, Apply -- each stage is explained "
                "where it happens."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="filters",
            target='[data-onboarding-target="dashboard-filters"]',
            title="Filter by where things stand.",
            body=(
                "Switch between Active, Drafted, Applied, and other "
                "stages to focus on what needs attention."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="add_job",
            target='[data-onboarding-target="add-job-button"]',
            title="Start with a job.",
            body=(
                "Add a job posting to begin -- JobSearch builds "
                "everything else, evidence-backed, from there."
            ),
            placement="bottom",
        ),
    ),
    trigger="first_visit:dashboard",
)


CANDIDATE_PROFILE_WALKTHROUGH = WalkthroughDefinition(
    walkthrough_id="candidate_profile_intro",
    version=1,
    title="Your Candidate Profile",
    steps=(
        WalkthroughStep(
            step_id="sources",
            target='[data-onboarding-target="profile-sources-panel"]',
            title="Your evidence, one source at a time.",
            body=(
                "The Candidate Profile is the one editable source. "
                "Supplemental sources like your CV add evidence too, but "
                "stay read-only here."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="entries",
            target='[data-onboarding-target="profile-entries-panel"]',
            title="Add or correct what JobSearch knows.",
            body=(
                "Every entry here is something you've confirmed "
                "yourself. JobSearch never invents a qualification, a "
                "job title, or a skill you haven't entered."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="add_details",
            target='[data-onboarding-target="profile-add-details"]',
            title="Add new evidence here.",
            body=(
                "Open this to add education, experience, skills, or "
                "certifications -- one confirmed fact per entry."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="claims",
            target='[data-onboarding-target="profile-claims-panel"]',
            title="This is what later stages will use.",
            body=(
                "Job Fit and document generation cite these claims "
                "directly, so what you confirm here is what shows up in "
                "your CV and cover letter."
            ),
            placement="top",
        ),
    ),
    trigger="first_visit:profile",
)


def register_default_walkthroughs() -> None:
    register_walkthrough(DASHBOARD_WALKTHROUGH)
    register_walkthrough(CANDIDATE_PROFILE_WALKTHROUGH)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_onboarding_walkthroughs_content.py -v`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Wire registration into app startup**

In `webapp/app.py`, add the import:

```python
from product.onboarding_walkthroughs import register_default_walkthroughs
```

Inside `create_app`'s `lifespan`, call it before `init_db`:

```python
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        register_default_walkthroughs()
        init_db(settings.db_path)
        yield
```

- [ ] **Step 6: Add a test proving the walkthroughs are registered when the app starts**

Add to `tests/test_onboarding_walkthroughs_content.py`:

```python
def test_creating_the_app_registers_both_default_walkthroughs(tmp_path):
    from fastapi.testclient import TestClient

    from webapp.app import create_app
    from webapp.config import Settings

    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", documents_root=tmp_path / "documents",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.get("/api/onboarding/walkthroughs")
        assert response.status_code == 200, response.text
        ids = {row["walkthrough_id"] for row in response.json()}
        assert "dashboard_intro" in ids
        assert "candidate_profile_intro" in ids
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest tests/test_onboarding_walkthroughs_content.py -v`
Expected: PASS (all 6 tests)

- [ ] **Step 8: Run relevant regression tests**

Run: `pytest tests -q --ignore=tests/webapp` and `pytest tests/webapp/test_app_factory.py tests/webapp/api/test_onboarding_routes.py -v`
Expected: PASS (no regressions in app-factory or onboarding API behavior)

- [ ] **Step 9: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: worktree
`C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`,
branch `feature/contextual-onboarding`, HEAD still `62f873d` (no commits
yet on this ticket), status shows only the new content module, the new
test file, and modified `webapp/app.py`. Stop on drift.

- [ ] **Step 10: Commit**

```bash
git add product/onboarding_walkthroughs.py webapp/app.py tests/test_onboarding_walkthroughs_content.py
git commit -m "feat(onboarding): add Dashboard and Candidate Profile walkthrough content"
```

---

### Task 2: Real target attributes and trigger buttons in the templates

**Files:**
- Modify: `webapp/templates/dashboard.html`
- Modify: `webapp/templates/profile.html`

**Interfaces:**
- Consumes: the exact `data-onboarding-target` selector strings defined
  in Task 1's `DASHBOARD_WALKTHROUGH`/`CANDIDATE_PROFILE_WALKTHROUGH` —
  this task's markup changes must match those selectors exactly, or the
  walkthrough will fail-gracefully on every step (proven in Task 3's
  acceptance tests).
- Produces: real DOM anchor points, plus one visible trigger button per
  page (`data-onboarding-start="dashboard_intro"` and
  `data-onboarding-start="candidate_profile_intro"`), and a tiny addition
  to `webapp/static/onboarding.js` making that attribute clickable — this
  is the one small, additive change to the overlay file this ticket
  makes, and it is generic (works for any walkthrough id via the data
  attribute), not Dashboard/Profile-specific code.

- [ ] **Step 1: Add target attributes and a trigger button to dashboard.html**

Modify `webapp/templates/dashboard.html`. Add
`data-onboarding-target="dashboard-hero"` to the hero section, a
trigger button beside the existing "Add a job" link, and the remaining
target attributes:

```html
<section class="hero compact" data-onboarding-target="dashboard-hero">
  <div><p class="eyebrow">Application command centre</p><h1>Your job pipeline</h1>
  <p>Evidence, decisions, and real-world status remain separate and traceable.</p></div>
  <div class="hero-actions">
    <button type="button" class="button secondary button-small" data-onboarding-start="dashboard_intro">Take the tour</button>
    <a class="button" href="/new-job">Add a job</a>
  </div>
</section>
<section class="panel getting-started-card" data-onboarding-target="dashboard-getting-started"><h2>How this works</h2><ol class="getting-started-steps">
<li>Evidence Profile</li><li>Find/Add Job</li><li>Job Fit</li><li>Intelligence</li><li>Review</li><li>Pack</li><li>Download</li><li>Apply</li>
</ol><a class="button secondary button-small" href="/how-it-works">See the full walkthrough</a></section>
```

Add `data-onboarding-target="dashboard-filters"` to the filters nav:

```html
<nav class="filters" aria-label="Application filters" data-onboarding-target="dashboard-filters">
```

Note: the "Add job" button already carries
`data-onboarding-target="add-job-button"` from Ticket 2 — do not add a
second, conflicting attribute to it.

- [ ] **Step 2: Add a `.hero-actions` style so the new button doesn't break the existing hero layout**

The hero section's `<div>` for actions previously held only the single
"Add a job" link. Add a small rule to `webapp/static/onboarding.css` (this
file, not `app.css`, since it's specific to the onboarding trigger
button's layout, not a general app style):

```css
.hero-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
```

- [ ] **Step 3: Add target attributes and a trigger button to profile.html**

Modify `webapp/templates/profile.html`. Add a trigger button next to the
existing "Refresh snapshot" button (only rendered when `not
setup_required`, matching where the profile manager itself is rendered):

```html
{% if not setup_required %}<div class="hero-actions"><button class="button secondary" data-action="refresh-profile">Refresh snapshot from included sources</button><button type="button" class="button secondary button-small" data-onboarding-start="candidate_profile_intro">Take the tour</button></div>{% endif %}
```

Add `data-onboarding-target="profile-sources-panel"` to the "Evidence
sources" panel:

```html
<section class="panel" data-onboarding-target="profile-sources-panel"><div class="panel-heading"><div><p class="eyebrow">Source management</p><h2>Evidence sources</h2><p>The Candidate Profile is the only editable source. Supplemental sources contribute evidence but remain read-only.</p></div></div>
```

Add `data-onboarding-target="profile-entries-panel"` to the "Editable
profile entries" panel:

```html
<section class="panel" data-onboarding-target="profile-entries-panel"><div class="panel-heading"><div><p class="eyebrow">Canonical Candidate Profile</p><h2>Editable profile entries</h2><p>Add, edit, or remove source entries. Derived claims, corroborations, and conflicts are not edited here.</p></div></div>
```

Add `data-onboarding-target="profile-add-details"` to the `<details>`:

```html
<details class="profile-add" data-onboarding-target="profile-add-details"><summary>Add profile information</summary>
```

Add `data-onboarding-target="profile-claims-panel"` to the generated
evidence claims panel:

```html
{% if profile %}<section class="panel" data-onboarding-target="profile-claims-panel"><div class="panel-heading"><div><h2>Generated evidence claims</h2><p>These are immutable outputs of the current snapshot builder, not editable profile records.</p></div></div>
```

- [ ] **Step 4: Wire the generic trigger-button click handler into onboarding.js**

Add to `webapp/static/onboarding.js`, inside the existing IIFE (near the
other `document.addEventListener("click", ...)` blocks, after the
`return {start};` line is too late — place it just before that line,
alongside the existing click listeners):

```javascript
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-onboarding-start]");
    if (!trigger) return;
    start(trigger.dataset.onboardingStart);
  });
```

This is generic: it dispatches on the `data-onboarding-start` attribute's
value, so any future walkthrough (Tickets 4-6) reuses it without further
JS changes -- only new template markup.

- [ ] **Step 5: Manually verify template rendering with no Jinja errors**

Run:
```
python -c "
from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.db import connect
from webapp.persistence.workspaces import ensure_profile_workspace
from fastapi.testclient import TestClient
import tempfile, pathlib
d = pathlib.Path(tempfile.mkdtemp())
settings = Settings(db_path=d/'t.sqlite3', documents_root=d/'documents')
app = create_app(settings)
with TestClient(app) as client:
    conn = connect(settings.db_path)
    ensure_profile_workspace(conn)
    conn.close()
    r1 = client.get('/')
    r2 = client.get('/profile')
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert 'data-onboarding-target=\"dashboard-hero\"' in r1.text
    print('ok')
"
```
Expected: prints `ok`

- [ ] **Step 6: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 1's commit, status shows only
the two modified templates, `webapp/static/onboarding.js`, and
`webapp/static/onboarding.css`. Stop on drift.

- [ ] **Step 7: Commit**

```bash
git add webapp/templates/dashboard.html webapp/templates/profile.html \
  webapp/static/onboarding.js webapp/static/onboarding.css
git commit -m "feat(onboarding): wire real target attributes and trigger buttons for Dashboard and Candidate Profile tours"
```

---

### Task 3: Acceptance — real target resolution and no unintended mutation

**Files:**
- Create: `tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py`

**Interfaces:**
- Consumes: `window.Onboarding.start(walkthroughId)` (Ticket 2),
  `[data-onboarding-start]` trigger buttons (Task 2 of this ticket),
  `product.onboarding_walkthroughs.register_default_walkthroughs` (Task 1
  of this ticket, though registration happens automatically via
  `create_app`'s lifespan — the test does not need to call it directly).
- Produces: nothing consumed by a later task — this is the ticket's final
  acceptance gate.

- [ ] **Step 1: Write the acceptance tests**

```python
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
from webapp.persistence.workspaces import ensure_profile_workspace, list_workspaces


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


@pytest.fixture
def live_server(tmp_path):
    profile_root = tmp_path / "profile"
    _write_profile_root(profile_root)
    port = _free_port()
    settings = Settings(
        db_path=tmp_path / "onboarding-tour.sqlite3", host="127.0.0.1", port=port,
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
        raise RuntimeError("Uvicorn onboarding tour fixture did not start")
    yield SimpleNamespace(base_url=f"http://127.0.0.1:{port}", db_path=settings.db_path)
    server.should_exit = True
    thread.join(timeout=10)


def test_dashboard_tour_button_walks_all_four_real_targets(live_server, page):
    page.goto(live_server.base_url + "/", wait_until="networkidle")
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
    page.get_by_role("button", name="Refresh snapshot from included sources").click()
    page.wait_for_load_state("networkidle")

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
    page.get_by_role("button", name="Refresh snapshot from included sources").click()
    page.wait_for_load_state("networkidle")
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
        raise RuntimeError("Uvicorn no-profile fixture did not start")
    yield SimpleNamespace(base_url=f"http://127.0.0.1:{port}")
    server.should_exit = True
    thread.join(timeout=10)


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

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py -v`
Expected: FAIL — "Take the tour" button doesn't exist yet on either page
(no `data-onboarding-start` trigger, and Task 1/2's registration and
markup haven't landed if run before those tasks; if run after Tasks 1-2
are already implemented, this step instead confirms the suite already
passes, in which case skip re-deriving failure and proceed to Step 3 as a
verification run).

- [ ] **Step 3: Run tests to verify they pass**

Run: `pytest tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py -v`
Expected: PASS (all 5 tests)

- [ ] **Step 4: Run the flake-check loop (matches Ticket 2's verification discipline)**

Run four times: `pytest tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py -q`
Expected: PASS all four runs, 5/5 each time — confirms no timing flake
before trusting this suite as ticket-closing evidence.

- [ ] **Step 5: Run the full relevant regression set**

Run: `pytest tests/webapp/test_browser_smoke.py tests/webapp/test_onboarding_overlay_browser_smoke.py tests/webapp/api/test_onboarding_routes.py tests/webapp/services/test_onboarding_service.py tests/webapp/persistence/test_onboarding.py -v`
Expected: PASS (no regressions in existing browser smoke, overlay
mechanism, or onboarding persistence/service/API layers)

- [ ] **Step 6: Run the full webapp and product regression suites**

Run: `pytest tests/webapp -q` and `pytest tests -q --ignore=tests/webapp`
Expected: PASS across both. If a pre-existing failure surfaces that is
unrelated to onboarding, stop and report it distinctly rather than
folding a fix into this ticket's diff (matching the precedent set in
Tickets 1-2, where two genuine pre-existing/self-introduced defects were
each fixed in their own clearly-labeled commit rather than silently).

- [ ] **Step 7: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 2's commit (three commits
total ahead of `62f873d` across this ticket), status shows only the new
test file. Stop on drift.

- [ ] **Step 8: Commit**

```bash
git add tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py
git commit -m "test(onboarding): add Dashboard and Candidate Profile tour acceptance coverage"
```

---

## Post-Ticket-3 Report Checklist

Before reporting Ticket 3 complete, confirm:
- [ ] Three commits on `feature/contextual-onboarding`, each corresponding
  to one task above, all ahead of Ticket 2's final commit `62f873d`.
- [ ] `git log --oneline 62f873d..HEAD` shows exactly these three commits,
  nothing else.
- [ ] `git status --short` clean.
- [ ] Full test suite passes (`pytest -q`).
- [ ] `git diff --check` clean.
- [ ] No file outside `product/onboarding_walkthroughs.py`,
  `webapp/app.py`, `webapp/templates/dashboard.html`,
  `webapp/templates/profile.html`, `webapp/static/onboarding.js`
  (one small, generic trigger-click handler),
  `webapp/static/onboarding.css` (one small `.hero-actions` rule),
  `tests/test_onboarding_walkthroughs_content.py`, and
  `tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py`
  was touched.
- [ ] Neither template was redesigned — only `data-onboarding-target`
  attributes and one trigger button were added to each page's existing
  markup.
- [ ] No walkthrough content or script mutates profile/job/application
  data — proven by the revision/workspace-list assertions in Task 3's
  acceptance tests.
- [ ] The Candidate Profile walkthrough explicitly states JobSearch does
  not invent unsupported qualifications or experience.
- [ ] Nothing pushed; `master` untouched; no other worktree touched.
- [ ] Stop here and report back before beginning Ticket 4 (job workflow
  walkthrough), per the stream's explicit sequencing.
