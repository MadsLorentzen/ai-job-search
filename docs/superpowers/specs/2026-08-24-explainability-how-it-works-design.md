# Explainability: "How it works" + contextual blocked-state explanations

**Status:** Draft for review
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

- Every stale badge explains what changed and what to do next.
- Gate 4's blocked reason is always visible when the gate is blocked, regardless of
  whether an older pack artifact already exists for the workspace.
- Excluded/unsupported content is explained in plain language, not raw contract codes.
- A permanent "How it works" page documents the full pipeline for a first-time or
  confused user.
- Empty states name a concrete next action instead of just stating absence.

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

### 2a. Stale badges (stepper + stage panels + dashboard table)

Today: a stage panel shows badge text `Stale` (from `STAGE_STATE_LABELS`) with no
detail unless the viewer expands nothing — `stale["reasons"]` is computed
(`check_staleness`) but never rendered in `workspace_detail.html` at all currently.

Proposed: under each stale badge, one short sentence naming the upstream cause in
plain language, plus the existing rerun button (already present) as the action.
Because `reasons` strings are already worded as `"X changed"` / `"X is itself
stale"` / `"required upstream artifact X is missing"`, they map cleanly to a small
translation table keyed by artifact-type substring — no parsing of arbitrary
strings, just a lookup dict from the known `DEPENDENCY_TYPES` vocabulary (~12 fixed
type names) to friendly nouns, with the raw reason kept underneath in the existing
`<details class="technical-details">` pattern for anyone who wants it.

Example:
- Raw reason: `"profile_snapshot changed (used 'abc', current is 'def')"`
- Friendly line: **"Your Evidence Profile changed since this was last run."**
- Raw reason: `"job_fit_result is itself stale: resolved_job_evidence changed..."`
- Friendly line: **"Job Fit needs to be rerun first — this depends on it."**

The rerun button text already says "Rerun Job Fit" / "Rerun Application
Intelligence" etc., so the friendly line plus existing button reads as a complete
instruction without new buttons.

### 2b. Gate 4 blocked reason (fixes Finding 1 + adds explanation)

Always show, whenever `controls.can_confirm_pack` is false and Application
Intelligence has produced a result:

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

### 2c. Unsupported/excluded content (plain-language reasons)

Today: `_build_evidence_items` labels these `"Unsupported — excluded from
application material"` with the raw reason (e.g. provider text like `"no rendering
template is registered for assertion_type 'responsibility'"`) shown verbatim in
`<details class="technical-details">`.

Proposed: keep the raw reason in the technical-details block (audit trail,
untouched), but add one friendly sentence above it. Because the raw reasons come
from multiple sources (`unsupported_claims` from Job Fit and Application
Intelligence, `review_record.exclusions` from the pack), a full translation table
for arbitrary provider text isn't reliable. Scope this to what's tractable without
touching generation: a small set of *known, structural* reason patterns already
produced by this codebase's own renderer/contract code (e.g. "no rendering template
registered for assertion_type X", "profile evidence id not found") get friendly
sentences; anything else falls back to a generic but still helpful frame: **"This
wording couldn't be verified against your Evidence Profile, so it was left out of
your application material automatically."** This fallback is honest (doesn't invent
specifics it doesn't have) and still better than raw text with no framing.

### 2d. "How it works" page (new, permanent)

New static route + template, linked from `base.html` nav (e.g. between `Dashboard`
and `Evidence Profile`). Content: the pipeline stages in order — Evidence Profile →
Find/Add Job → Job Understanding → Job Fit → Application Intelligence → Review →
Application Pack (Gate 4) → Download → Apply → Track outcome — each with three short
answers: *What is this stage? Why does it matter? What do I do here?* Static content
(no view-model dependency, no DB query) so it's cheap and can't drift from a
particular workspace's state. Reuses `base.html` nav/shell only.

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

A "Getting Started" dashboard card for new users is listed in the memory note as a
"consider" item, not a requirement — recommend deferring it; the "How it works" page
plus tightened empty states cover the same need without adding dashboard-state
complexity (a dismissible/first-visit card would need its own persistence, which is
out of proportion for this ticket). Flag this trade-off explicitly for your decision.

---

## 3. Minimal backend/view-model changes required

All additions are pure functions/lookups layered on top of *already-computed* data —
no new DB reads, no new artifact fields, no change to any function's return contract
used by existing callers (JSON API routes reuse the same `build_workspace_view_model`;
adding keys to the returned dict is additive and safe for `webapp/api/workspaces.py`
consumers, which read specific keys, not the whole dict shape).

1. **`webapp/services/workspace_view.py`**
   - Add a pure helper `_friendly_staleness_reason(stale: dict) -> str | None` that
     maps `stale["reasons"]` (via substring match against the fixed
     `DEPENDENCY_TYPES` vocabulary imported from `staleness.py`) to one friendly
     sentence. Attach as `stage["friendly_reason"]` alongside existing
     `stage["staleness"]` in the `stages` dict.
   - Add `_friendly_completion_issues(review_completion: dict) -> list[str]` mapping
     each code in `review_completion["issues"]` to a sentence, interpolating the
     actual counts/thresholds already present in `review_completion` and the
     contract constants. Attach as `review_completion["friendly_issues"]` (or a
     sibling key) in the returned dict — do not remove or rename `issues`, only add.
   - Add `_friendly_exclusion_reason(raw_reason: str) -> str` for the
     evidence/exclusion items built in `_build_evidence_items`, attached as a new
     `friendly_reason` field per item.
   - No change to any existing key's value or type — additive keys only.

2. **`webapp/templates/workspace_detail.html`**
   - Fix Finding 1: remove the `not stages.review.artifact` condition around the
     completion-reason panel; gate on `review_completion_status != 'READY'` and
     `stages.application_intelligence.artifact` instead.
   - Render the new friendly strings above the existing `<details
     class="technical-details">` blocks (pattern already established site-wide).
   - Tighten the two reviewed-output empty-state `<p>` strings.

3. **`webapp/templates/dashboard.html`**
   - Minor empty-state copy tightening only.

4. **`webapp/templates/base.html`**
   - Add one nav `<a href="/how-it-works">How it works</a>`.

5. **New: `webapp/templates/how_it_works.html`**
   - Static content template, no view model beyond `_search_context` (for nav
     consistency with every other page).

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

1. **Stale reason is human-readable.**
   Reuse `test_stale_and_review_negative_paths_are_enforced_in_rendered_ui`'s
   profile-edit-then-reload flow (already edits the candidate profile and reloads
   the workspace to assert `.badge.stale`). Add an assertion that the panel also
   shows a sentence containing "Evidence Profile changed" (or the chosen exact
   copy) — not just the badge.

2. **Gate 4 reason survives an existing pack (regression test for Finding 1).**
   New scenario: run to a `READY` pack, confirm it (`drafted`), then force the
   *current* material back to incomplete (e.g. omit content via review actions on a
   rerun, mirroring the existing omit-path in
   `test_stale_and_review_negative_paths_are_enforced_in_rendered_ui`) while a pack
   artifact still exists from history. Assert the completion-reason panel and
   friendly issue sentences are visible and the confirm button is disabled — proving
   the panel no longer disappears once a pack has ever existed.

3. **Friendly completion issue counts.**
   In the existing "omit everything" branch of
   `test_stale_and_review_negative_paths_are_enforced_in_rendered_ui` (already
   asserts `INCOMPLETE` badge), add an assertion for a friendly sentence containing
   the actual counts, e.g. "0 of 2 required CV bullets".

4. **How it works page renders and is linked from nav.**
   New scenario: `page.goto(base_url)`, click the "How it works" nav link, assert
   the heading and all pipeline stage names appear (Evidence Profile, Job
   Understanding, Job Fit, Application Intelligence, Review, Application Pack).
   Also assert `_assert_no_private_browser_content` (existing helper) passes, since
   this page shares `base.html`/nav context.

5. **Empty-state next action on reviewed-output panel.**
   Early in `_run_to_intelligence` (after Application Intelligence has run, before
   any review decision is made), assert the reviewed-CV-content empty state names
   "Resolve the decisions below" rather than just stating absence.

All five extend existing fixtures; none require new server-side test doubles.

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
tests/webapp/test_browser_smoke.py      (5 new/extended scenarios, see §4)
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
  state. Concretely: the staleness-reason mapping keys off the fixed
  `DEPENDENCY_TYPES` artifact-type vocabulary (~12 names, closed set in
  `staleness.py`), and the completion-issue mapping keys off the five named
  constants in `application_material_contract.py` (also closed). Both should have a
  unit test asserting every enum value has a mapping entry, so a future new issue
  code or dependency type fails loudly (a missing mapping) rather than silently
  showing nothing or something wrong.
- **The exclusion-reason mapping (§2c) is the one place free-text matching is used**
  (provider-generated reason strings aren't a closed enum) — mitigated by using a
  generic-but-honest fallback sentence rather than guessing, and by never altering
  the underlying `evidence.detail` payload itself (raw text stays in
  `technical-details` unchanged).
- **No JSON API response shape changes** — API routes in `webapp/api/*.py` other
  than `views.py` are untouched, so anything consuming the JSON endpoints
  (`/api/workspaces/...`) is unaffected; only server-rendered HTML templates change.

---

## Open questions for review

1. Exact wording for each friendly sentence — drafted above as examples; final copy
   worth a pass together rather than treating my phrasing as final.
2. Whether "How it works" should be a single long page or a page with anchored
   sections per stage (single page recommended — matches the existing
   single-scroll `workspace_detail.html` pattern and needs no new nav depth).
3. Whether to defer the "Getting Started" dismissible dashboard card (recommended:
   yes, defer — see §2e).
