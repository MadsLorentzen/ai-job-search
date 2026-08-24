# Explainability: "How it works" + contextual blocked-state explanations

**Status:** Approved direction — proceeding to implementation plan.
**Scope:** Presentation/UX only. No changes to Job Fit, Application Intelligence, or Gate 4 semantics.

## Background

Acceptance testing of release candidate `485c997` confirmed the product's staleness
and completion logic is correct end to end (Evidence Profile change → Job Fit stale →
rerun → Application Intelligence stale → review → Gate 4 re-evaluates the regenerated
pack from scratch). The gap is that the UI states requiring this understanding —
`Stale` badges, a disabled "Create reviewed pack" button, silently-vanished completion
reasons — assume the viewer already knows the internal pipeline (artifacts, dependency
fingerprints, the completion contract). See memory `project_ux_explainability_gap` for
the original finding, including one concrete bug-shaped issue in the completion-reason
panel (see Finding 1 below).

This spec covers presentation and copy only. It does not change `check_staleness`,
`application_material_completion`, `COMPLETION_CONTRACT_VERSION`, or any Gate 4 status
transition rule in `webapp/persistence/workflow.py`.

## Goals

- Every stale badge explains **causally** what changed and what sequence restores
  it — not just a nicer synonym for "stale."
- Gate 4's blocked reason always reflects the **current** attempted pack, and is
  always visible when the gate is blocked, regardless of whether a historical
  confirmed pack artifact already exists for the workspace.
- Historical pack availability and current pack readiness are explicitly
  distinguished wherever both are true at once, so the two never read as
  contradictory.
- Excluded/unsupported content shows a friendly reason and preserves the full
  technical reason underneath — never discarded.
- A permanent "How it works" page documents the full pipeline and defines the
  status vocabulary (Current, Stale, Needs review, Blocked/Incomplete, Ready,
  Historical pack, Drafted, Applied) for a first-time or confused user.
- A lightweight "Getting Started" dashboard workflow card ships in this ticket
  (not deferred), linking to "How it works."
- Empty states name a concrete next action instead of just stating absence.

**Tone for all new copy** (established now; exact wording finalized at the
implementation-plan stage): plain English, short, action-oriented, no internal
architecture jargon (no "artifact," "fingerprint," "contract version," "stage
state" in user-facing text — those stay in the technical-details blocks).

## Non-goals

- No change to when a stage is stale, blocked, or complete.
- No change to `application_material_completion`'s thresholds or issue codes.
- No new scoring, ranking, or generation behavior.
- No change to what data reaches a template — only how already-passed data is
  worded and laid out. (One exception, called out explicitly in Finding 1: a
  template *condition* bug that hides existing data. Fixing it changes visibility
  of already-computed data, not the data or the gate logic itself.)

---

## 1. Current state: screens and components inspected

Read directly (see file list below) rather than assumed:

- `webapp/services/workspace_view.py` — `build_workspace_view_model` computes
  `stages`, `stale`, `review_completion`, `readiness_answer`/`readiness_problem`,
  `controls`. This is the one view-model function behind the workspace detail page.
- `webapp/services/staleness.py` — `check_staleness` returns
  `{"stale": bool, "reasons": [str, ...]}`. `reasons` are already human-readable-ish
  strings like `"profile_snapshot changed (used 'abc', current is 'def')"` — technical
  but not fabricated; upstream artifact type names leak through.
- `webapp/application_material.py` / `product/application_material_contract.py` —
  `application_material_completion` returns `{"status", "issues": [code, ...],
  "qualifying_cv_unit_count", "cv_word_count", "qualifying_cover_letter_paragraph_count",
  "cover_letter_word_count"}`. `issues` are opaque codes (`insufficient_cv_units`,
  `missing_cv_bullet`, `insufficient_cv_words`, `insufficient_cover_letter_paragraphs`,
  `insufficient_cover_letter_words`) — counts and thresholds are already computed and
  present in the same dict, just not surfaced next to the codes in the template.
- `webapp/persistence/workflow.py` — `record_status_change`, the actual Gate 4 rule
  (`drafted` requires a pack bound to the workspace, current completion contract
  version, and `status == "READY"`).
- `webapp/templates/workspace_detail.html` — the single template rendering the
  stepper, all five stage panels, review queue, and Gate 4 (`.gate-four` block).
- `webapp/templates/dashboard.html` — table of workspaces with `stage_state_label`
  and `next_action`; one empty state (`No {{ filter }} applications`).
- `webapp/templates/base.html` — nav bar (`Dashboard`, discovery/search links,
  `Evidence Profile`, `Add job`) — this is where a new "How it works" nav link goes.
- `webapp/static/app.css` — badge/state color conventions already exist:
  `.badge.stale` (red), `.badge.review`/`.needs_review` (amber), `.badge.complete`
  (green), `.review-surface`, `.blocked-note`, `.trust-callout`, `.technical-details`
  (used as a `<details>` wrapper pattern throughout for "raw data behind a friendly
  summary" — this pattern already exists and should be reused, not reinvented).
- `webapp/api/views.py` — routes that build and pass these view models to templates;
  a new "How it works" page needs one new static route here.
- `tests/webapp/test_browser_smoke.py` — the only browser-level test file; uses
  `pytest-playwright`'s `page` fixture against a real `uvicorn` server started by the
  `live_server` fixture. New acceptance scenarios extend this file with the same
  pattern (`_click_reload`, `_refresh_profile`, `_run_to_intelligence`).

### Finding 1 — the concrete bug-shaped issue (in scope to fix)

`workspace_detail.html` line 55:

```
{% if stages.application_intelligence.artifact and not stages.review.artifact %}
<p>Application material: <span class="badge ...">{{ review_completion_status }}</span></p>
{% if review_completion.issues %}...{% endif %}
{% endif %}
```

The completion-reason panel is wrapped in `not stages.review.artifact` — it only
renders when no `application_pack` artifact exists yet for this workspace. Once a
pack has ever been created (even a stale/historical one, e.g. after a rerun on an
already-`drafted`/`applied` workspace), `stages.review.artifact` is truthy and this
panel disappears — even though `review_completion` / `review_completion_status` are
*already computed fresh* every request in `build_workspace_view_model` (lines
426-442) regardless of whether a pack artifact exists. The confirm button
(`.confirm-pack`, line 55) stays correctly disabled via `controls.can_confirm_pack`,
but the reason is now invisible. This is a template visibility condition, not a
data or gate-logic bug — `review_completion` was already right; we just stop hiding it.

**Fix:** decouple the completion-reason panel's visibility from
`stages.review.artifact` entirely. Show it whenever `review_completion_status !=
"READY"` and Application Intelligence has run, independent of pack history.

---

## 2. Proposed user-facing states and messages

### 2a. Stale badges (stepper + stage panels + dashboard table) — causal, not descriptive

Today: a stage panel shows badge text `Stale` (from `STAGE_STATE_LABELS`) with no
detail unless the viewer expands nothing — `stale["reasons"]` is computed
(`check_staleness`) but never rendered in `workspace_detail.html` at all currently.

**The requirement is causal, not just friendlier wording.** A stale message must
name (a) what upstream thing changed or was rerun, (b) that it invalidated *this*
stage specifically, and (c) the exact next action — and when staleness is
multi-hop (e.g. profile changed → Fit stale → Intelligence stale), each affected
stage gets its own causally-accurate sentence naming its *immediate* cause, not a
generic "something upstream changed." `check_staleness`'s recursive reasons
(`_check_staleness_recursive` in `staleness.py`) already distinguish a direct
mismatch (`"X changed (used ..., current is ...)"`) from a transitive one (`"X is
itself stale: ..."`) — this distinction maps directly onto "root cause" vs.
"depends on a stage that's also stale," so the translation preserves it rather than
collapsing both into one phrasing:

- Root cause (direct mismatch on `profile_snapshot`), shown on the **Job Fit**
  stage: **"Your Evidence Profile changed after this Job Fit was created. Rerun
  Job Fit."**
- Transitive (Job Fit stage is itself stale), shown on the **Application
  Intelligence** stage: **"Job Fit was updated after this Intelligence result was
  created. Rerun Application Intelligence."**

This means the friendly-reason helper must know which stage it's rendering for
(to name "this Job Fit" / "this Intelligence result" correctly) and must walk one
level of the reason structure to distinguish direct-cause from
depends-on-a-stale-stage, rather than a flat string→sentence lookup. Still built
from the same closed `DEPENDENCY_TYPES` vocabulary (~12 fixed type names) — no
free-text parsing — with the raw reason kept underneath in the existing `<details
class="technical-details">` pattern for anyone who wants it.

The rerun button text already says "Rerun Job Fit" / "Rerun Application
Intelligence" etc., so the causal sentence plus existing button reads as a complete
instruction without new buttons.

### 2b. Gate 4 blocked reason (fixes Finding 1 + adds explanation)

Always show, whenever `controls.can_confirm_pack` is false and Application
Intelligence has produced a result — and this must reflect the **current attempted
pack's** completion state, computed fresh every request from the current
`review_completion`, never from whatever a historical `application_pack` artifact
happened to contain. `review_completion` in `workspace_view.py` already is
computed this way (lines 426-442, independent of pack history) — the fix is purely
that the template must stop hiding it (Finding 1), not that the computation
changes:

- A one-line plain-English status ("2 of 2 required CV bullets found, but your cover
  letter is 24 words — it needs at least 40.") built from the counts already in
  `review_completion` (`qualifying_cv_unit_count`, `cv_word_count`,
  `qualifying_cover_letter_paragraph_count`, `cover_letter_word_count`) compared
  against the constants in `product/application_material_contract.py`
  (`MIN_CV_UNITS`, `MIN_CV_WORDS`, `MIN_COVER_LETTER_PARAGRAPHS`,
  `MIN_COVER_LETTER_WORDS`), which are already imported into
  `application_material_contract.py`'s public surface.
- One friendly sentence per issue code, via a fixed dict keyed by the five known
  issue-code constants (`INSUFFICIENT_CV_UNITS`, `MISSING_CV_BULLET`, etc.) — these
  are closed enums already defined in `product/application_material_contract.py`,
  so the mapping is exhaustive and can't silently miss a new code without a test
  failing.
- If blocked for a *different* reason (outstanding review decisions, stale
  dependency, no Application Intelligence result yet), reuse the existing
  `readiness_problem` computed in `workspace_view.py` (already plain-language:
  "Resolve 2 remaining review decisions.", "Rerun the stale stage before relying on
  this application material.") — this already exists and is already good; it's
  only the *completion-issue* sub-case (Finding 1) that's currently hidden.

### 2b-2. Historical pack availability vs. current pack readiness (explicit distinction)

This is a state the app can legitimately be in — a confirmed pack exists and its
downloads are still valid, *and* the freshly regenerated material is not currently
good enough to create a *replacement* pack — but nothing today tells the viewer
these are two different facts. Left unexplained, "here are your downloads" sitting
next to "you can't create a pack" reads as a contradiction.

**Rule: whenever `stages.review.artifact` exists (a pack was confirmed at some
point) AND the current `review_completion_status != 'READY'`, show both facts
side by side, explicitly labeled as separate:**

- Historical fact (existing pack, unaffected by current material state):
  **"Your previously confirmed application pack is still available to
  download."** — keeps the existing `.pack-downloads` block exactly as-is
  (unchanged behavior; only adds a labeling sentence above it if this dual-state
  applies).
- Current fact (the completion-reason panel from §2b, now always visible per the
  Finding 1 fix): **"Your newly regenerated material is not ready to create a
  replacement pack: [current completion issues]."**

Critically, the reviewed-CV/cover-letter content shown in the readiness panel at
the top of the page (`reviewed_cv_content` / `reviewed_cover_letter_content`) must
never be presented as if it were the current in-progress material when it is in
fact sourced from the historical pack — `workspace_view.py` already sources these
correctly from `artifacts["pack"]["payload"]` when a pack exists (lines 450-452),
so the copy change is to make the panel's heading say **"Reviewed CV content (from
your confirmed pack)"** rather than an unqualified "Reviewed CV content" whenever
`review_completion_status != 'READY'` for the *current* material — i.e. whenever
the historical/current split from this section applies. This prevents the
newly-regenerated-but-incomplete material from ever being implied to be "the
reviewed" content when it hasn't actually passed review.

### 2c. Unsupported/excluded content (plain-language reasons)

Today: `_build_evidence_items` labels these `"Unsupported — excluded from
application material"` with the raw reason (e.g. provider text like `"no rendering
template is registered for assertion_type 'responsibility'"`) shown verbatim in
`<details class="technical-details">`.

Proposed: keep the raw reason in the technical-details block (audit trail,
untouched, never discarded), but add one friendly sentence above it. Because the
raw reasons come from multiple sources (`unsupported_claims` from Job Fit and
Application Intelligence, `review_record.exclusions` from the pack), a full
translation table for arbitrary provider text isn't reliable. Scope this to what's
tractable without touching generation: a small set of *known, structural* reason
patterns already produced by this codebase's own renderer/contract code (e.g. "no
rendering template registered for assertion_type X", "profile evidence id not
found") get friendly sentences close to **"This suggestion was excluded because
the system could not safely convert it into approved CV wording."**; anything else
falls back to a generic but still honest frame: **"This wording couldn't be
verified against your Evidence Profile, so it was left out of your application
material automatically."** Both the specific and fallback sentences sit directly
above the existing `<details class="technical-details">` block, which continues to
expose the exact underlying technical reason string unchanged — the friendly
sentence is additive framing, never a replacement for the audit-trail text.

### 2d. "How it works" page (new, permanent) — pipeline + status glossary

New static route + template, linked from `base.html` nav (e.g. between `Dashboard`
and `Evidence Profile`). Two sections:

**Pipeline walkthrough.** The stages in order — Evidence Profile → Find/Add Job →
Job Understanding → Job Fit → Application Intelligence → Review → Application Pack
(Gate 4) → Download → Apply → Track outcome — each with three short answers: *What
is this stage? Why does it matter? What do I do here?*

**Status glossary.** A small reference table explaining every status word the UI
uses, since badges and labels alone ("Stale," "Blocked") are exactly the terms
generating "why is this red?" confusion. Covers, at minimum:

| Status | Plain-English meaning |
|---|---|
| Current | Ready to run — nothing is blocking this stage. |
| Stale / needs updating | Something it depended on changed since this result was created; it needs to be rerun before it can be trusted. |
| Needs review | The system generated something but wants your explicit decision before it's used. |
| Blocked / incomplete | This stage can't proceed yet — an earlier requirement (a decision, a rerun, a minimum amount of content) isn't satisfied. |
| Ready | This meets every requirement to move forward. |
| Historical pack | A CV/cover letter you confirmed previously. It stays downloadable even after later changes make new material stale or incomplete — confirming a new pack never happens automatically. |
| Drafted | You've confirmed a reviewed application pack (Gate 4), but haven't told the app you actually submitted it yet. |
| Applied | You've told the app you submitted this application outside the tool. |

This table exists specifically to make the historical-pack-vs-current-readiness
distinction (§2b-2) something the user can look up, not just infer from context.

Static content (no view-model dependency beyond `_search_context` for nav
consistency, no DB query) so it's cheap and can't drift from a particular
workspace's state.

### 2e. Empty states with concrete next actions

Two identified today:
- Dashboard: `No {{ filter }} applications` / `Add a saved posting or choose another
  filter.` → already names an action reasonably well; minor tightening only (make
  the button text and paragraph consistent — "Add your first job" already exists).
- Workspace detail, reviewed-output panels: `No CV wording has been approved yet.` /
  `No cover-letter wording has been approved yet.` → add the concrete next step,
  e.g. **"No CV wording has been approved yet. Resolve the decisions below, or run
  Application Intelligence if you haven't yet."** — conditionally worded based on
  whether `stages.application_intelligence.artifact` exists, using data already in
  the view model.
- Understanding/Fit/Application Intelligence "not run yet" states (`<p>Extract
  cited requirements...</p>` etc.) already double as both empty-state copy and stage
  description; leave these as-is unless review surfaces a specific confusion — out
  of scope unless the user flags one during review.

### 2f. "Getting Started" dashboard workflow card (included, not deferred)

A static, always-visible card at the top of `dashboard.html` (above the filters
nav, below the existing hero), showing the eight-step workflow as a simple
horizontal or wrapped list of labels, **not** a fresh interactive stepper and
**not** tied to any workspace's state — it's orientation, not status:

**Evidence Profile → Find/Add Job → Job Fit → Intelligence → Review → Pack →
Download → Apply**

(Job Understanding is folded implicitly into "Find/Add Job → Job Fit" for this
condensed card, since the full six-stage-plus-status breakdown already exists in
the per-workspace stepper — this card's job is orientation at a glance, not a
duplicate of the stepper. The full, unabridged pipeline order stays in "How it
works," §2d.)

Ends with a link/button to the "How it works" page for the full explanation. No
dismiss state, no first-visit-only logic, no new persistence — a static card that
always renders is simpler to build, simpler to test, and (per the repeated finding
that users need this) arguably better shown every time rather than only once.
This directly satisfies goal item 1: ship it in this ticket, not deferred.

---

## 3. Minimal backend/view-model changes required

All additions are pure functions/lookups layered on top of *already-computed* data —
no new DB reads, no new artifact fields, no change to any function's return contract
used by existing callers (JSON API routes reuse the same `build_workspace_view_model`;
adding keys to the returned dict is additive and safe for `webapp/api/workspaces.py`
consumers, which read specific keys, not the whole dict shape).

1. **`webapp/services/workspace_view.py`**
   - Add a pure helper `_causal_staleness_message(stage_key: str, stale: dict) ->
     str | None` that, per stage, distinguishes a direct-cause reason (an upstream
     artifact type changed) from a transitive one (an upstream stage is itself
     stale) using the existing distinction already present in `stale["reasons"]`
     phrasing (`"X changed"` vs. `"X is itself stale"`), and produces the
     stage-appropriate causal sentence (see §2a examples). Takes `stage_key` (not
     just the raw `stale` dict) because the sentence must name *this* stage
     correctly ("this Job Fit," "this Intelligence result"). Attach as
     `stage["causal_reason"]` alongside existing `stage["staleness"]` in the
     `stages` dict.
   - Add `_friendly_completion_issues(review_completion: dict) -> list[str]` mapping
     each code in `review_completion["issues"]` to a sentence, interpolating the
     actual counts/thresholds already present in `review_completion` and the
     contract constants. Attach as `review_completion["friendly_issues"]` (or a
     sibling key) in the returned dict — do not remove or rename `issues`, only add.
   - Add `_friendly_exclusion_reason(raw_reason: str) -> str` for the
     evidence/exclusion items built in `_build_evidence_items`, attached as a new
     `friendly_reason` field per item.
   - Add a computed boolean `has_historical_pack_with_incomplete_current_material`
     (or attach as a field on the existing `readiness_*` pair) —
     `bool(stages["review"]["artifact"]) and review_completion_status != "READY"` —
     so the template doesn't need to re-derive the §2b-2 dual-state condition
     itself from raw pieces.
   - No change to any existing key's value or type — additive keys only.

2. **`webapp/templates/workspace_detail.html`**
   - Fix Finding 1: remove the `not stages.review.artifact` condition around the
     completion-reason panel; gate on `review_completion_status != 'READY'` and
     `stages.application_intelligence.artifact` instead.
   - Render the new causal/friendly strings above the existing `<details
     class="technical-details">` blocks (pattern already established site-wide).
   - Add the historical-pack-vs-current-readiness dual-state copy (§2b-2) and the
     "(from your confirmed pack)" heading qualifier, gated on the new
     `has_historical_pack_with_incomplete_current_material` flag.
   - Tighten the two reviewed-output empty-state `<p>` strings.

3. **`webapp/templates/dashboard.html`**
   - Add the static Getting Started workflow card (§2f) — no new view-model data
     required; it's static markup plus a link to `/how-it-works`.
   - Minor empty-state copy tightening only.

4. **`webapp/templates/base.html`**
   - Add one nav `<a href="/how-it-works">How it works</a>`.

5. **New: `webapp/templates/how_it_works.html`**
   - Static content template (pipeline walkthrough + status glossary table, §2d),
     no view model beyond `_search_context` (for nav consistency with every other
     page).

6. **`webapp/api/views.py`**
   - Add `GET /how-it-works` route rendering `how_it_works.html` with just
     `_search_context(conn, scope.account_id)` — matches the pattern used by
     `new_job_page`.

No changes to: `webapp/persistence/workflow.py`, `webapp/services/staleness.py`,
`webapp/application_material.py`, `product/application_material_contract.py`,
`webapp/services/http_api.py`, any `webapp/api/*.py` mutation route, any provider,
any schema file, any policy JSON. Every one of those stays byte-for-byte unchanged.

---

## 4. Playwright acceptance scenarios

Extend `tests/webapp/test_browser_smoke.py` using its existing fixtures
(`live_server`, `_refresh_profile`, `_run_to_intelligence`, `_click_reload`) rather
than a new test file, per the repo's established single-file convention for browser
journeys.

**Copy-assertion discipline (applies to every scenario below):** Playwright
assertions target the *semantic phrase or action* — a distinctive fragment proving
the right cause/action/distinction is present (e.g. `"Evidence Profile changed"`,
`"Rerun Job Fit"`, `"still available to download"`, `"not ready to create a
replacement"`) — never a full paragraph or exact-match on entire copy blocks.
Exhaustive correctness of the friendly/causal-text mappings (every enum value maps
to *something*, and every issue code produces the right numbers) belongs in
**unit tests** against the pure helpers in `workspace_view.py`, where asserting
exact strings is cheap and appropriate. This split means a future copy edit changes
a unit-test literal, not a five-minute Playwright suite re-recording.

1. **Stale reason is causal, not just present.**
   Reuse `test_stale_and_review_negative_paths_are_enforced_in_rendered_ui`'s
   profile-edit-then-reload flow (already edits the candidate profile and reloads
   the workspace to assert `.badge.stale`). Add assertions that (a) the Job Fit
   panel shows a phrase naming the Evidence Profile as the cause and Job Fit as the
   action (e.g. contains both "Evidence Profile" and "Rerun Job Fit"), and (b)
   after rerunning Job Fit but before rerunning Intelligence, the Intelligence
   panel's phrase names *Job Fit* (not the profile) as the cause — proving the
   per-stage causal chain, not a single generic message reused everywhere.

2. **Gate 4 reason survives an existing pack (regression test for Finding 1).**
   New scenario: run to a `READY` pack, confirm it (`drafted`), then force the
   *current* material back to incomplete (e.g. omit content via review actions on a
   rerun, mirroring the existing omit-path in
   `test_stale_and_review_negative_paths_are_enforced_in_rendered_ui`) while a pack
   artifact still exists from history. Assert the completion-reason panel and
   friendly issue phrase are visible and the confirm button is disabled — proving
   the panel no longer disappears once a pack has ever existed.

3. **Friendly completion issue counts.**
   In the existing "omit everything" branch of
   `test_stale_and_review_negative_paths_are_enforced_in_rendered_ui` (already
   asserts `INCOMPLETE` badge), add an assertion for a phrase containing the actual
   counts, e.g. text matching "0" and "2" and "CV" near each other, or a single
   `data-*` attribute carrying the count for a stable, non-prose assertion hook if
   preferred over prose matching.

4. **How it works page renders, links from nav, and includes the status glossary.**
   New scenario: `page.goto(base_url)`, click the "How it works" nav link, assert
   the heading and all pipeline stage names appear (Evidence Profile, Job
   Understanding, Job Fit, Application Intelligence, Review, Application Pack), and
   assert each glossary term (Current, Stale, Needs review, Blocked, Ready,
   Historical pack, Drafted, Applied) appears as a term/row, without asserting the
   definition prose verbatim. Also assert `_assert_no_private_browser_content`
   (existing helper) passes, since this page shares `base.html`/nav context.

5. **Empty-state next action on reviewed-output panel.**
   Early in `_run_to_intelligence` (after Application Intelligence has run, before
   any review decision is made), assert the reviewed-CV-content empty state names
   a concrete next action (contains "Resolve" or "Application Intelligence")
   rather than just stating absence.

6. **Getting Started card appears on the dashboard and links to How it works.**
   `page.goto(base_url)`, assert the workflow card is visible with all eight step
   labels present (as a list of short label assertions, not one paragraph match),
   and that its link navigates to `/how-it-works`.

7. **Combined confusing-state regression — historical pack + current incomplete
   material, all at once.** This is the exact scenario the original finding was
   about, and is worth its own end-to-end assertion rather than only covered
   piecewise by scenarios 1-3: build a workspace to a confirmed `drafted` pack
   (reusing the existing full-journey helpers), then edit the profile so the
   workspace goes stale, rerun Job Fit and Application Intelligence, and — instead
   of resolving all outstanding review decisions to `READY` — leave the fresh
   material below the completion thresholds (e.g. omit enough content that
   `review_completion_status` stays `INCOMPLETE`). Assert, all in the same
   rendered page:
   - the historical pack's download links (CV and cover letter) are still present
     and enabled;
   - a phrase distinguishing this as the *previous/confirmed* pack accompanies
     those download links (not just bare links with no framing);
   - a separate phrase says the current/replacement material is not ready,
     containing the actual current completion issue(s);
   - the confirm-pack button is disabled;
   - the reviewed-content panel heading (if showing the historical pack's content)
     is qualified as being from the confirmed pack, not presented as if it were the
     current unreviewed material.
   This scenario is the direct acceptance test for goal item 4 (§2b-2) and would
   have caught Finding 1 on its own.

All seven extend existing fixtures; none require new server-side test doubles.

---

## 5. Files likely to change

```
webapp/services/workspace_view.py       (add pure helpers + additive dict keys)
webapp/templates/workspace_detail.html  (Finding 1 fix + friendly copy + empty states)
webapp/templates/dashboard.html         (empty-state copy tightening)
webapp/templates/base.html              (nav link)
webapp/templates/how_it_works.html      (new)
webapp/api/views.py                     (new GET /how-it-works route)
webapp/static/app.css                   (small additions only if new copy needs
                                          a distinct style, e.g. a "friendly-reason"
                                          class — likely reuses existing .blocked-note/
                                          .review-surface patterns instead)
tests/webapp/test_browser_smoke.py      (7 new/extended scenarios, see §4)
tests/webapp/services/test_workspace_view.py
                                         (new unit tests: exhaustive enum-mapping
                                          coverage for causal staleness, completion
                                          issues, and exclusion-reason fallback)
```

Not expected to change: anything under `product/`, `webapp/persistence/`,
`webapp/services/staleness.py`, `webapp/services/http_api.py`,
`webapp/application_material.py`, any `webapp/api/*.py` other than `views.py`, any
JSON policy/contract/schema file.

---

## 6. Risk of accidentally changing business logic

- **Low overall** — every proposed change either (a) adds a new dict key derived
  from data already computed by unchanged functions, or (b) changes a template
  `{% if %}` condition that controls *visibility*, not the underlying
  `controls.can_confirm_pack` / `stage["state"]` values that actually gate button
  `disabled` attributes and API-level enforcement.
- **The one condition change (Finding 1 fix)** is the highest-scrutiny item: it
  changes what renders, not what's allowed. `controls.can_confirm_pack` (computed
  independently, `webapp/services/workspace_view.py:555`) already correctly
  disables the button regardless of pack history — this fix only stops *hiding the
  reason* for a state that was already correctly blocked. Verified by re-reading
  the `can_confirm_pack` computation: `review_state == "current" and
  has_reviewed_usable_material`, unaffected by this change.
  Test scenario 2 above exists specifically to pin this.
- **Friendly-text lookup tables must be exhaustive over closed enums, not
  free-text parsing of arbitrary strings**, to avoid ever silently mis-describing a
  state. Concretely: the causal-staleness mapping keys off the fixed
  `DEPENDENCY_TYPES` artifact-type vocabulary (~12 names, closed set in
  `staleness.py`) crossed with the small set of stage keys in `STAGE_ORDER`, and
  the completion-issue mapping keys off the five named constants in
  `application_material_contract.py` (also closed). Both get a unit test asserting
  every enum value (and, for staleness, every stage key it can legitimately apply
  to) has a mapping entry, so a future new issue code or dependency type fails
  loudly (a missing mapping) rather than silently showing nothing or something
  wrong. This is also where exact-string assertions belong (per the Playwright
  copy-assertion discipline in §4) — unit tests are the right layer for
  literal-text correctness, not the browser suite.
- **The historical-pack-vs-current-readiness distinction (§2b-2) must never let
  the two states blur into one.** The new `has_historical_pack_with_incomplete_current_material`
  flag and its template branch are additive read-only presentation — they do not
  change `controls.can_confirm_pack`, do not change what `stages["review"]["artifact"]`
  contains, and do not change which pack a download link points to
  (`/api/workspaces/{id}/application-pack/render/*` already renders whatever
  `application_pack` artifact is current, unchanged). Regression-pinned by
  acceptance scenario 7 in §4.
- **The exclusion-reason mapping (§2c) is the one place free-text matching is used**
  (provider-generated reason strings aren't a closed enum) — mitigated by using a
  generic-but-honest fallback sentence rather than guessing, and by never altering
  the underlying `evidence.detail` payload itself (raw text stays in
  `technical-details` unchanged).
- **No JSON API response shape changes** — API routes in `webapp/api/*.py` other
  than `views.py` are untouched, so anything consuming the JSON endpoints
  (`/api/workspaces/...`) is unaffected; only server-rendered HTML templates change.

---

## Decisions from review

- Getting Started card: **included in this ticket**, static (no dismiss/persistence
  state) — §2f.
- Staleness messages: **causal**, per-stage, distinguishing direct cause from
  depends-on-a-stale-stage — §2a.
- Finding 1 fix: confirmed as specified — completion reasons must reflect the
  current attempted pack regardless of historical pack existence — §2b.
- Historical pack availability and current pack readiness: **explicitly
  distinguished** wherever both apply at once, including the reviewed-content
  panel heading — §2b-2 (new section).
- Excluded content: friendly reason **plus** preserved technical detail, never
  discarded — §2c.
- "How it works" page: **includes a status glossary**, not just the pipeline
  walkthrough — §2d.
- Playwright scenarios: **7** (added the combined historical-pack +
  incomplete-current-material regression, §4 item 7); assertions target semantic
  phrases/actions, not full paragraphs — exact-string correctness moves to new
  unit tests against the pure helpers.
- Tone: plain English, short, action-oriented, no internal architecture jargon —
  established now; exact copy finalized at the implementation-plan stage.

## Open questions for the implementation plan

1. Exact wording for each causal/friendly sentence — tone is set (see Goals), but
   final copy is drafted during implementation, not fixed here.
2. Whether "How it works" should be a single long page or a page with anchored
   sections per stage (single page recommended — matches the existing
   single-scroll `workspace_detail.html` pattern and needs no new nav depth).
3. Exact placement/visual treatment of the Getting Started card relative to the
   existing hero and "Set up your Evidence Profile" conditional panel on
   `dashboard.html` (both render above the filters nav today — order between the
   three needs a small layout decision, not a scope decision).
