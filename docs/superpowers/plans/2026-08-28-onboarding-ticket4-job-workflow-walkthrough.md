# Onboarding Ticket 4: Job Workflow Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the third contextual walkthrough — the job workflow, on the
workspace detail page — as pure data registered against the Ticket 1
engine and rendered by the Ticket 2 overlay, following the pattern Ticket
3 established. No new job-analysis behavior, no workspace-detail redesign,
no data mutation from walking through the tour.

**Architecture:** `product/onboarding_walkthroughs.py` (created in Ticket
3) gains one more `WalkthroughDefinition`,
`JOB_WORKFLOW_WALKTHROUGH`, registered by the same
`register_default_walkthroughs()` this ticket extends rather than
duplicates. `webapp/templates/workspace_detail.html` gains
`data-onboarding-target` attributes — on exactly one *new* anchor (the
stepper, which currently has no attribute) and reuses four `id`s the page
already has for its own reason (`#job-posting`, `#job-fit`,
`#application-intelligence`, `.readiness-panel`) — plus one "Take the
tour" trigger button in the workspace header, matching Ticket 3's
established button pattern exactly.

**Guidance, not tooltips:** this walkthrough is five steps, one per real
stage of the actual journey (orient via the stepper, source, evidence +
why, confident proposals awaiting review, what's left before sending) —
not a tooltip parked on every button on the page. It deliberately skips
Understanding (folded into the Job Fit step's explanation, since
Understanding's own reasoning is already visible inline via that stage's
own `causal_reason` block) and Review/Status (folded into the readiness
panel, which is the UI's own single-place answer to "what's left"). Each
step's copy references what the panel *already shows* (the `causal_reason`
blocked-note, the evidence grid, the recommendation banner, the readiness
answer) rather than restating page content as decoration.

**Tech Stack:** Same as Tickets 1-3 — Python/FastAPI/Jinja2, vanilla JS,
pytest + pytest-playwright for acceptance.

**Spec:** The Ticket 4 section of the contextual-onboarding stream brief
(conversation-supplied). Builds on
`docs/superpowers/plans/2026-08-27-onboarding-ticket1-state-engine.md`,
`...-ticket2-overlay.md`, and
`...-ticket3-dashboard-profile-walkthroughs.md`.

## Global Constraints

- Frozen baseline commit: `12224eeb6d401209ed0da6fe1360fc90a722bc98`. Work
  happens only on branch `feature/contextual-onboarding` in worktree
  `C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`.
  Never touch `master` or any other worktree.
- Ticket 3 is accepted at `044ac1ac050313fb79dc41ef0c4e3f51c05c9f59`
  (`HEAD` at the start of this ticket). It provides:
  `product/onboarding_walkthroughs.py` with
  `register_default_walkthroughs()` already wired into `create_app`'s
  lifespan, and the `[data-onboarding-start]` generic trigger-click
  handler already present in `webapp/static/onboarding.js`.
- Do not invent new job-analysis behavior for the sake of the walkthrough.
  Every fact the walkthrough states (evidence comparison, recommendation
  reasoning, completion status) must already be computed and rendered by
  the existing `build_workspace_view_model` — this ticket adds zero
  business logic.
- Do not redesign the job workflow to make the tour easier. Only one new
  `data-onboarding-target` attribute (on the stepper) is added; four steps
  reuse `id`s/classes that already exist for their own reason.
- Explain *why* JobSearch reached a conclusion only where the UI already
  exposes that reasoning (the `causal_reason` blocked-note, the
  `recommendation_reason` sentence, the `readiness_problem` sentence) —
  never invent an explanation the page doesn't already give the user.
- Must not mutate job/application/profile data. The only network calls a
  running walkthrough makes are to `/api/onboarding/*` (already proven
  safe in Tickets 2-3). No walkthrough content or script in this ticket
  may call any other API route.
- A step whose target is conditionally absent (e.g. the readiness panel
  targets an element that is always rendered per
  `workspace_detail.html:13`, so this concern does not actually arise for
  this ticket's chosen targets — verified in Task 1 before committing to
  them) must fail gracefully per Ticket 2's existing mechanism if it ever
  does.
- Follow existing repo conventions: Jinja2 templates, the existing
  `[data-onboarding-start]` click handler in `webapp/static/onboarding.js`
  (no changes needed to that file this ticket — it is already generic),
  pytest + pytest-playwright acceptance tests following
  `tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py`'s
  pattern (including its `page.expect_navigation()` fix for
  reload-triggering actions and its exact `cv/main_example.tex` fixture
  requirement).
- Before the first write in this worktree, and again before every commit,
  verify: `git rev-parse --show-toplevel`, `git branch --show-current`,
  `git rev-parse HEAD`, `git status --short`. Expected: this worktree path,
  branch `feature/contextual-onboarding`, HEAD `044ac1a` (until Task 1's
  commit) then advancing one commit per task, clean status. Stop on drift.
- Do not push. Do not merge.

---

## File Structure

- **Modify:** `product/onboarding_walkthroughs.py` — add
  `JOB_WORKFLOW_WALKTHROUGH` and register it from
  `register_default_walkthroughs()`.
- **Modify:** `webapp/templates/workspace_detail.html` — add
  `data-onboarding-target="workspace-stepper"` to the `<ol class="stepper">`
  (the one new attribute this ticket adds); add a "Take the tour" trigger
  button in the workspace header, matching Ticket 3's button pattern.
- **Test:** `tests/test_onboarding_walkthroughs_content.py` (extended, not
  replaced) — content assertions for the new definition.
- **Test:** `tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py`
  — Playwright acceptance proving real target resolution across the
  actual job journey, graceful failure on a missing target, zero
  mutation of job/application/profile state, and that existing
  job-analysis behavior (Understanding/Fit/Intelligence stage outputs)
  is bit-for-bit unchanged by having walked through the tour.

No changes to `product/onboarding.py`, `webapp/services/onboarding.py`,
`webapp/persistence/onboarding.py`, `webapp/api/onboarding.py`,
`webapp/static/onboarding.js`, or `webapp/static/onboarding.css` — the
generic trigger/overlay mechanism built in Ticket 2 and reused unchanged
in Ticket 3 needs no changes to carry Ticket 4's content.

---

## Walkthrough content

### Job workflow (`walkthrough_id="job_workflow_intro"`)

Five steps, targeting elements in `webapp/templates/workspace_detail.html`:

1. `data-onboarding-target="workspace-stepper"` (the `<ol class="stepper">`,
   new attribute) — "This is where the job stands." / "Each stage lights
   up as you complete it. Nothing here implies an application was
   submitted — that's tracked separately, at the end."
2. `#job-posting` (existing `id`, the "Job posting" panel) — "Start with
   exactly what was posted." / "JobSearch preserves the source text
   as-is. Understanding and Job Fit only ever cite this preserved
   record — never anything invented."
3. `#job-fit` (existing `id`, the "Job Fit" panel) — "See the evidence
   behind the verdict." / "Job Fit compares your accepted evidence
   against what the job asks for. If a result looks stale, the panel
   tells you exactly why -- open Technical details to see every match
   and every gap."
4. `#application-intelligence` (existing `id`, the "Application
   Intelligence" panel) — "What's confident enough to propose." /
   "JobSearch only proposes content it can tie back to accepted evidence.
   The recommendation reasoning is right here -- and nothing generated
   here is used until you review it below."
5. `.readiness-panel` (existing class, the "Is this application ready to
   send?" panel) — "This answers the one question that matters." /
   "Yes, No, or Not yet -- and why, in plain language. Resolve what it
   names, and the answer updates on its own."

Five steps mirrors Ticket 3's "keep this concise" precedent while
covering every required talking point: adding/opening a job (implicitly
covered — the walkthrough begins once a job is already open; adding one
is already taught by the Dashboard walkthrough's final step, which is
the deliberate handoff point between the two tours), understanding the
job (step 2), fit/evidence analysis (step 3), evidence-backed reasoning
and what has enough evidence (steps 3-4), what still needs user input
(step 5), and where the user goes next (step 5's plain-language answer
names the next unresolved decision).

---

### Task 1: Walkthrough content, target verification, and registration

**Files:**
- Modify: `product/onboarding_walkthroughs.py`
- Test: `tests/test_onboarding_walkthroughs_content.py` (extended)

**Interfaces:**
- Consumes: `product.onboarding.{WalkthroughDefinition, WalkthroughStep}`
  (Ticket 1); the existing `register_default_walkthroughs()` function
  body (Ticket 3) — this task adds one more `register_walkthrough(...)`
  call inside it, not a new registration function.
- Produces (for Task 2's template work and Task 3's acceptance tests):
  - `JOB_WORKFLOW_WALKTHROUGH: WalkthroughDefinition` (`walkthrough_id =
    "job_workflow_intro"`)

- [ ] **Step 1: Verify the readiness panel's conditional rendering before committing to it as a target**

Before writing any code, confirm the concern raised in Global Constraints
(a target that is conditionally absent must fail gracefully, not break
the walkthrough) does not apply to `.readiness-panel`. Read
`webapp/templates/workspace_detail.html:13` — the readiness panel's
`<section class="panel readiness-panel" ...>` opening tag has no `{% if
%}` guard around it; it always renders once a workspace exists, though
its *content* (`readiness_answer`, `readiness_problem`) varies. This
confirms the target itself (the section, not its content) is
unconditional for the Task 3 acceptance tests to exercise. No code
change in this step — this is a verification gate before Task 1's Step 3.

- [ ] **Step 2: Write the failing content test**

Add to `tests/test_onboarding_walkthroughs_content.py`:

```python
def test_job_workflow_walkthrough_has_five_steps_targeting_real_workspace_elements():
    from product.onboarding_walkthroughs import JOB_WORKFLOW_WALKTHROUGH

    assert JOB_WORKFLOW_WALKTHROUGH.walkthrough_id == "job_workflow_intro"
    assert len(JOB_WORKFLOW_WALKTHROUGH.steps) == 5
    targets = [step.target for step in JOB_WORKFLOW_WALKTHROUGH.steps]
    assert targets == [
        '[data-onboarding-target="workspace-stepper"]',
        '#job-posting',
        '#job-fit',
        '#application-intelligence',
        '.readiness-panel',
    ]


def test_job_workflow_walkthrough_mentions_evidence_and_review_not_submission():
    from product.onboarding_walkthroughs import JOB_WORKFLOW_WALKTHROUGH

    bodies = " ".join(step.body for step in JOB_WORKFLOW_WALKTHROUGH.steps)
    assert "evidence" in bodies.lower()
    assert "review" in bodies.lower()
    # Ticket 4 must never claim or imply the walkthrough itself submits
    # anything -- final submission stays manual per the stream's core
    # invariants.
    assert "submit" not in bodies.lower() or "submitted" in bodies.lower()


def test_register_default_walkthroughs_also_registers_job_workflow():
    from product.onboarding import get_walkthrough
    from product.onboarding_walkthroughs import (
        JOB_WORKFLOW_WALKTHROUGH,
        register_default_walkthroughs,
    )

    register_default_walkthroughs()
    assert get_walkthrough("job_workflow_intro") is JOB_WORKFLOW_WALKTHROUGH
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_onboarding_walkthroughs_content.py -v -k job_workflow`
Expected: FAIL — `ImportError: cannot import name 'JOB_WORKFLOW_WALKTHROUGH'`

- [ ] **Step 4: Add the walkthrough definition**

In `product/onboarding_walkthroughs.py`, add after
`CANDIDATE_PROFILE_WALKTHROUGH`:

```python
JOB_WORKFLOW_WALKTHROUGH = WalkthroughDefinition(
    walkthrough_id="job_workflow_intro",
    version=1,
    title="Working a job through JobSearch",
    steps=(
        WalkthroughStep(
            step_id="stepper",
            target='[data-onboarding-target="workspace-stepper"]',
            title="This is where the job stands.",
            body=(
                "Each stage lights up as you complete it. Nothing here "
                "implies an application was submitted -- that's tracked "
                "separately, at the end."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="job_posting",
            target='#job-posting',
            title="Start with exactly what was posted.",
            body=(
                "JobSearch preserves the source text as-is. Understanding "
                "and Job Fit only ever cite this preserved record -- "
                "never anything invented."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="job_fit",
            target='#job-fit',
            title="See the evidence behind the verdict.",
            body=(
                "Job Fit compares your accepted evidence against what "
                "the job asks for. If a result looks stale, the panel "
                "tells you exactly why -- open Technical details to see "
                "every match and every gap."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="application_intelligence",
            target='#application-intelligence',
            title="What's confident enough to propose.",
            body=(
                "JobSearch only proposes content it can tie back to "
                "accepted evidence. The recommendation reasoning is "
                "right here -- and nothing generated here is used until "
                "you review it below."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="readiness",
            target='.readiness-panel',
            title="This answers the one question that matters.",
            body=(
                "Yes, No, or Not yet -- and why, in plain language. "
                "Resolve what it names, and the answer updates on its "
                "own."
            ),
            placement="bottom",
        ),
    ),
    trigger="first_visit:job_workflow",
)
```

Update `register_default_walkthroughs()` to also register it:

```python
def register_default_walkthroughs() -> None:
    register_walkthrough(DASHBOARD_WALKTHROUGH)
    register_walkthrough(CANDIDATE_PROFILE_WALKTHROUGH)
    register_walkthrough(JOB_WORKFLOW_WALKTHROUGH)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_onboarding_walkthroughs_content.py -v`
Expected: PASS (all tests, old and new)

- [ ] **Step 6: Run relevant regression tests**

Run: `pytest tests/webapp/test_app_factory.py tests/webapp/api/test_onboarding_routes.py -v`
Expected: PASS (registering one more walkthrough doesn't change any
existing route's behavior — `list_walkthroughs` returning one more row is
not asserted against an exact-length list anywhere in the existing
suite; confirm this by reading `test_list_walkthroughs_includes_registered_not_started`
before running, which only checks membership, not exhaustiveness).

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
branch `feature/contextual-onboarding`, HEAD still `044ac1a` (no commits
yet on this ticket), status shows only the modified content module and
test file. Stop on drift.

- [ ] **Step 8: Commit**

```bash
git add product/onboarding_walkthroughs.py tests/test_onboarding_walkthroughs_content.py
git commit -m "feat(onboarding): add job workflow walkthrough content"
```

---

### Task 2: Real target attribute and trigger button on the workspace detail page

**Files:**
- Modify: `webapp/templates/workspace_detail.html`

**Interfaces:**
- Consumes: the exact `data-onboarding-target` selector string and the
  four reused `id`/class selectors from Task 1's `JOB_WORKFLOW_WALKTHROUGH`
  — this task's one markup change must match exactly, or the first step
  will fail-gracefully (proven in Task 3's acceptance tests).
- Produces: one real DOM anchor point (the stepper), one visible trigger
  button (`data-onboarding-start="job_workflow_intro"`), reusing the
  generic click handler already shipped in Ticket 2/3 — no JS changes in
  this task.

- [ ] **Step 1: Add the stepper's target attribute**

In `webapp/templates/workspace_detail.html`, modify the stepper:

```html
<ol class="stepper" aria-label="Product workflow" data-onboarding-target="workspace-stepper">
```

- [ ] **Step 2: Add the trigger button to the workspace header**

The header currently reads:

```html
<section class="workspace-header"><div><a class="back-link" href="/">← Applications</a><p class="eyebrow">{{ workspace.company }}</p><h1>{{ workspace.title }}</h1>
<p>Workflow status: <strong>{{ workspace.workflow_status or "Active — not drafted or submitted" }}</strong></p></div>
<div class="trust-callout"><strong>Evidence first</strong><span>Generating or reviewing material never means it was submitted.</span></div></section>
```

Add the trigger inside the existing left `<div>`, after the workflow
status paragraph, using the same `.hero-actions` wrapper class Ticket 3
introduced (already styled in `onboarding.css` — no new CSS needed):

```html
<section class="workspace-header"><div><a class="back-link" href="/">← Applications</a><p class="eyebrow">{{ workspace.company }}</p><h1>{{ workspace.title }}</h1>
<p>Workflow status: <strong>{{ workspace.workflow_status or "Active — not drafted or submitted" }}</strong></p>
<div class="hero-actions"><button type="button" class="button secondary button-small" data-onboarding-start="job_workflow_intro">Take the tour</button></div></div>
<div class="trust-callout"><strong>Evidence first</strong><span>Generating or reviewing material never means it was submitted.</span></div></section>
```

- [ ] **Step 3: Manually verify template rendering with no Jinja errors**

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
    assert 'data-onboarding-target=\"workspace-stepper\"' in r.text
    assert 'data-onboarding-start=\"job_workflow_intro\"' in r.text
    print('ok')
"
```
Expected: prints `ok`

- [ ] **Step 4: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 1's commit, status shows only
the modified template. Stop on drift.

- [ ] **Step 5: Commit**

```bash
git add webapp/templates/workspace_detail.html
git commit -m "feat(onboarding): wire real target attribute and trigger button for job workflow tour"
```

---

### Task 3: Acceptance — real target resolution, graceful failure, no mutation, unchanged analysis

**Files:**
- Create: `tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py`

**Interfaces:**
- Consumes: `window.Onboarding.start('job_workflow_intro')` (Ticket 2),
  the `[data-onboarding-start]` trigger button (Task 2 of this ticket),
  `product.onboarding_walkthroughs.register_default_walkthroughs`
  (registration happens automatically via `create_app`'s lifespan).
- Produces: nothing consumed by a later task — this is the ticket's final
  acceptance gate.

- [ ] **Step 1: Write the acceptance tests**

```python
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
    # create_job_from_source_record (not the bare persistence-layer
    # create_workspace) is the real service path that both creates the
    # workspace row AND saves its one job_posting_snapshot artifact --
    # exactly what happens when a user submits the real /new-job form.
    # Using the bare persistence helper here would leave #job-posting
    # rendering its "No posting snapshot." empty state, which is not what
    # this ticket's walkthrough describes in its step 2 copy.
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


def test_job_workflow_tour_walks_all_five_real_targets_in_journey_order(live_server, page):
    page.goto(
        f"{live_server.base_url}/workspaces/{live_server.workspace_id}",
        wait_until="networkidle",
    )
    page.get_by_role("button", name="Take the tour").click()
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

    page.get_by_role("button", name="Take the tour").click()
    page.wait_for_selector(".onboarding-popover")
    for _ in range(4):
        page.get_by_role("button", name="Next").click()
        page.wait_for_timeout(150)
    page.get_by_role("button", name="Finish").click()
    page.wait_for_selector(".onboarding-popover", state="detached")

    conn = connect(live_server.db_path)
    workspace_after = get_workspace(conn, live_server.workspace_id)
    # No Understanding/Fit/Intelligence artifact tables gain rows: the
    # workspace row's own updated_at is the simplest single proof that
    # nothing wrote through this workspace as a side effect of the tour.
    artifact_count = conn.execute(
        "SELECT COUNT(*) FROM artifacts WHERE workspace_id = ?",
        (live_server.workspace_id,),
    ).fetchone()[0]
    conn.close()
    assert workspace_after["updated_at"] == workspace_before["updated_at"]
    # Exactly the one job_posting_snapshot artifact created at workspace
    # creation -- Understanding/Fit/Intelligence never ran.
    assert artifact_count == 1


def test_job_workflow_tour_fails_gracefully_on_a_missing_target(live_server, page):
    page.goto(
        f"{live_server.base_url}/workspaces/{live_server.workspace_id}",
        wait_until="networkidle",
    )
    # Simulate a rerendered/stale page by removing the second step's real
    # target before advancing to it -- proves the mechanism against this
    # ticket's actual content, not a synthetic walkthrough.
    page.get_by_role("button", name="Take the tour").click()
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py -v`
Expected: FAIL — "Take the tour" button doesn't exist yet on the
workspace detail page (if run before Tasks 1-2 land); if run after Tasks
1-2 are already implemented, this step instead confirms the suite already
passes, in which case skip re-deriving failure and proceed to Step 3 as a
verification run (same allowance as Ticket 3's plan).

- [ ] **Step 3: Run tests to verify they pass**

Run: `pytest tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py -v`
Expected: PASS (all 4 tests)

- [ ] **Step 4: Run the flake-check loop**

Run six times: `pytest tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py -q`
Expected: PASS all six runs, 4/4 each time. If any run flakes, diagnose
before proceeding -- Ticket 3 hit exactly one flake class (a reload-race
after a fetch-triggering click) and fixed it with `page.expect_navigation()`;
check for that same pattern first if a flake appears here, since this
ticket's fixture and page also contain reload-triggering actions
(`stage-action` buttons), even though this ticket's own tests do not
click any of them.

- [ ] **Step 5: Run the full relevant regression set**

Run: `pytest tests/webapp/test_browser_smoke.py tests/webapp/test_onboarding_overlay_browser_smoke.py tests/webapp/test_onboarding_dashboard_profile_walkthroughs_browser_smoke.py tests/webapp/api/test_onboarding_routes.py tests/webapp/services/test_onboarding_service.py tests/webapp/persistence/test_onboarding.py -v`
Expected: PASS (no regressions in existing browser smoke -- including the
full job-analysis journey exercised in `test_browser_smoke.py`, which
proves Understanding/Fit/Intelligence still behave identically -- or in
the overlay/Ticket-3 walkthrough suites)

- [ ] **Step 6: Run the full webapp and product regression suites**

Run: `pytest tests/webapp -q` and `pytest tests -q --ignore=tests/webapp`
Expected: PASS across both. If a pre-existing failure surfaces that is
unrelated to onboarding, stop and report it distinctly rather than
folding a fix into this ticket's diff (matching the precedent from
Tickets 1-3).

- [ ] **Step 7: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now one commit ahead of Task 2's commit (three commits
total ahead of `044ac1a` across this ticket), status shows only the new
test file. Stop on drift.

- [ ] **Step 8: Commit**

```bash
git add tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py
git commit -m "test(onboarding): add job workflow tour acceptance coverage"
```

---

## Post-Ticket-4 Report Checklist

Before reporting Ticket 4 complete, confirm:
- [ ] Three commits on `feature/contextual-onboarding`, each corresponding
  to one task above, all ahead of Ticket 3's final commit `044ac1a`.
- [ ] `git log --oneline 044ac1a..HEAD` shows exactly these three commits,
  nothing else.
- [ ] `git status --short` clean.
- [ ] Full test suite passes (`pytest -q`).
- [ ] `git diff --check` clean.
- [ ] No file outside `product/onboarding_walkthroughs.py`,
  `webapp/templates/workspace_detail.html`,
  `tests/test_onboarding_walkthroughs_content.py`, and
  `tests/webapp/test_onboarding_job_workflow_walkthrough_browser_smoke.py`
  was touched.
- [ ] The workspace detail page was not redesigned — only one new
  `data-onboarding-target` attribute and one trigger button were added.
- [ ] No walkthrough content or script mutates job/application/profile
  data — proven by the artifact-count and `updated_at` assertions in
  Task 3's acceptance tests.
- [ ] Existing job-analysis behavior (Understanding/Fit/Intelligence
  stage rendering and controls) is unchanged — proven by the dedicated
  regression test and by the full `test_browser_smoke.py` suite passing
  unmodified.
- [ ] The walkthrough explains *why* only where the UI already exposes
  that reasoning (`causal_reason`, `recommendation_reason`,
  `readiness_problem`) — no invented job-analysis explanation was added.
- [ ] Five steps, each tied to a real stage of the actual journey — not a
  tooltip on every control on the page.
- [ ] Nothing pushed; `master` untouched; no other worktree touched.
- [ ] Stop here and report back before beginning Ticket 5 (CV and
  cover-letter walkthrough), per the stream's explicit sequencing.
