# Explainability: "How it works" + contextual blocked-state explanations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing (correct, unchanged) staleness and Gate 4 completion logic self-explanatory: causal stale messages, an always-visible Gate 4 completion reason (fixing a real visibility bug), an explicit historical-pack-vs-current-readiness distinction, plain-language exclusion reasons, a permanent "How it works" page with a status glossary, and an in-ticket "Getting Started" dashboard card.

**Architecture:** Every change is additive view-model data (new dict keys on the object `build_workspace_view_model` already returns) plus template copy/visibility changes. No function in `product/`, `webapp/persistence/`, `webapp/services/staleness.py`, or `webapp/application_material.py` changes signature, return shape, or behavior.

**Tech Stack:** Python 3, FastAPI, Jinja2 templates, `sqlite3`, `pytest`, `pytest-playwright` (existing `page` + `live_server` fixtures in `tests/webapp/test_browser_smoke.py`).

**Spec:** `docs/superpowers/specs/2026-08-24-explainability-how-it-works-design.md`

## Global Constraints

- **No behavior change** to `check_staleness`/`_check_staleness_recursive` (`webapp/services/staleness.py`), `application_material_completion`/`application_material_is_completion_ready` (`webapp/application_material.py`), `COMPLETION_CONTRACT_VERSION` or any constant in `product/application_material_contract.py`, or any Gate 4 transition rule in `webapp/persistence/workflow.py` (`record_status_change`). These files are read, never modified, by this plan.
- **No change to any existing dict key's value or type** returned by `build_workspace_view_model`, `build_dashboard_view_model`, or `build_profile_view_model` in `webapp/services/workspace_view.py`. New keys are additive only.
- **No JSON API response shape changes.** `webapp/api/*.py` files other than `webapp/api/views.py` are untouched.
- **Tone for all new user-facing copy:** plain English, short, action-oriented, no internal architecture jargon ("artifact," "fingerprint," "contract version," "stage state" stay inside `<details class="technical-details">` blocks, never in the primary sentence).
- **Friendly-text lookup tables must be exhaustive over closed enums** — every `DEPENDENCY_TYPES` type name, every `STAGE_ORDER` key it can apply to, and every completion issue code must have a mapping entry, verified by a dedicated exhaustiveness unit test per table.
- **Playwright assertions target semantic phrases/actions**, never full paragraphs or exact-match on entire copy blocks — literal-string correctness lives in unit tests against the pure helpers, not the browser suite.
- **Historical pack downloads must never be affected by these changes** — `/api/workspaces/{id}/application-pack/render/*` routes are not touched by this plan.
- **This implementation is pinned to baseline commit `485c997`, not symbolic `master`.** Work happens in an isolated worktree/branch created in Task 0. Every "no changes to X" verification (Task 13) diffs against `485c997...HEAD`, not `master`. `master` is never moved by this ticket.

---

## File Structure

```
webapp/services/workspace_view.py        Modify — new pure helper functions + additive view-model keys
webapp/templates/workspace_detail.html   Modify — Finding-1 fix, causal/friendly copy, historical/current split
webapp/templates/dashboard.html          Modify — Getting Started card, empty-state copy
webapp/templates/base.html               Modify — "How it works" nav link
webapp/templates/how_it_works.html       Create — pipeline walkthrough + status glossary
webapp/api/views.py                      Modify — new GET /how-it-works route
tests/webapp/services/test_workspace_view.py   Modify — new unit tests (exhaustiveness, causal messages, dual-state, exclusion fallback)
tests/webapp/test_browser_smoke.py       Modify — 7 new/extended Playwright scenarios
```

No new files under `product/`, `webapp/persistence/`, or any `webapp/api/*.py` other than `views.py`.

---

# Part 0 — Baseline pin

### Task 0: Create an isolated worktree/branch pinned to the accepted baseline commit

**Why:** this repo has an unexplained-commit incident on record (see memory `incident_unexplained_autocommit`) and a busy set of parallel feature/integration branches. To guarantee this ticket's diffs are measured against exactly the code that was accepted, not against whatever `master` happens to point to when a verification command runs later, this implementation pins to the specific commit the spec was written against (`485c997`, "test: cover account-scoped pack rendering integration") rather than the symbolic ref `master`. This ticket's work must never move `master` directly.

**Files:** none modified — environment setup only.

- [ ] **Step 1: Confirm the baseline commit exists and is the intended one**

Run:

```bash
git log -1 --format="%H %s" 485c997
```

Expected output: `485c997<full sha continuation> test: cover account-scoped pack rendering integration`

- [ ] **Step 2: Create an isolated worktree branched from that exact commit**

Run:

```bash
git worktree add ../ai-job-search-explainability 485c997 -b feature/explainability-how-it-works
```

This creates a new working directory at `../ai-job-search-explainability` on a new branch `feature/explainability-how-it-works`, branched from `485c997` — not from `master`'s current tip. All subsequent tasks in this plan run inside that worktree directory, never in the original working directory, and never touch `master`.

- [ ] **Step 3: Record the baseline SHA for later verification steps**

Run (from inside the new worktree):

```bash
git rev-parse HEAD
```

Expected: prints the full SHA for `485c997...`. Record this as `BASE_SHA=485c997` — every boundary-diff command later in this plan (Task 13) uses `git diff 485c997...HEAD`, never `git diff master`, so that another session moving `master` underneath this work cannot silently change what "no changes to X" means.

- [ ] **Step 4: Confirm the working tree is clean and matches the baseline exactly**

Run:

```bash
git status --short
git diff 485c997 --stat
```

Expected: `git status --short` prints nothing (clean tree); `git diff 485c997 --stat` prints nothing (HEAD equals the baseline exactly, since no commits have been made yet in this worktree).

- [ ] **Step 5: No commit for this task**

Task 0 only establishes the environment — there is nothing to commit yet. Proceed to Task 1 inside this worktree.

---

# Part 1 — View-model additions

### Task 1: Causal stale-cause messaging helper

**Files:**
- Modify: `webapp/services/workspace_view.py` (add helper near top, after `STAGE_ANCHORS`/`RUN_ACTION_LABELS` constants around line 45; wire into `build_workspace_view_model` around line 491-498 where `stages` dict is assembled)
- Test: `tests/webapp/services/test_workspace_view.py`

**Interfaces:**
- Consumes: `webapp.services.staleness.DEPENDENCY_TYPES` (dict[str, tuple[str, ...]]); a `stale` dict shaped `{"stale": bool, "reasons": list[str]}` as returned by `check_staleness`/`_check_staleness_recursive`; `STAGE_ORDER` (existing tuple in `workspace_view.py`).
- Produces: `_causal_staleness_message(stage_key: str, stale: dict[str, Any]) -> str | None` — returns `None` when `stale["stale"]` is `False`, otherwise a single causal sentence. Attached to the view model as `stages[stage_key]["causal_reason"]` for every stage in `stale` (`understanding`, `fit`, `application_intelligence`, `review`).

**Design (from spec §2a):** `check_staleness`'s reasons already distinguish a direct mismatch (`"X changed (used '...', current is '...')"`) from a transitive one (`"X is itself stale: ..."`). Traced directly against `_check_staleness_recursive` (confirmed by running the exact `_seed_evidence` + profile-change fixture and printing real output — see verification note below), **a stage whose immediate dependency list includes `profile_snapshot` directly (e.g. `application_intelligence_result`, which depends on `profile_snapshot`, `job_fit_result`, and `application_intelligence_request` per `DEPENDENCY_TYPES`) gets BOTH a direct `"profile_snapshot changed"` reason AND a transitive `"job_fit_result is itself stale: ..."` reason in the same `reasons` list, direct-mismatch entries first.** Naively taking `reasons[0]` would make the Application Intelligence stage say "Your Evidence Profile changed" — technically true, but not what the spec's example asks for (spec: "Job Fit was updated after this Intelligence result was created. Rerun Application Intelligence."). The helper must therefore **prefer the transitive ("is itself stale") reason when one exists**, since it names the nearer, more actionable cause — only falling back to a direct-cause reason when no transitive one is present. The helper:
1. Scan `stale["reasons"]` for the first entry containing `" is itself stale"`. If found, use it (transitive case) regardless of position in the list.
2. Otherwise, use `stale["reasons"][0]` (direct case — this only happens on the stage immediately downstream of the actual change, e.g. Job Fit when the profile changes, since Job Fit's only reasons are direct-mismatch entries with no transitive ones beneath it).
3. For the transitive case, extract the upstream type name (text before `" is itself stale"`) and produce a sentence naming the **stage** that upstream type belongs to (via `_ARTIFACT_TYPE_TO_STAGE`).
4. For the direct case, extract the upstream type name and produce a direct-cause sentence naming the noun (via `_ARTIFACT_TYPE_NOUNS`).
5. Map artifact-type names to user-facing nouns via a closed dict (`_ARTIFACT_TYPE_NOUNS`) and artifact-type names to the stage that owns them via a closed dict (`_ARTIFACT_TYPE_TO_STAGE`), both built from the literal type strings already used as dict values in `DEPENDENCY_TYPES` (`webapp/services/staleness.py:15-31`) plus `STAGE_ORDER`.
6. Every entry across `DEPENDENCY_TYPES`'s value tuples must have a noun entry. Confirmed by direct inspection (`{t for deps in DEPENDENCY_TYPES.values() for t in deps}`), the exact closed set is 16 strings: `application_intelligence_request`, `application_intelligence_result`, `job_fit_request`, `job_fit_result`, `job_posting_snapshot`, `job_understanding_request`, `job_understanding_result`, `profile_snapshot`, `resolved_job_evidence`, `server:active_extensions`, `server:application_intelligence_generation_contract`, `server:application_intelligence_policy`, `server:evaluation_policy`, `server:semantic_fit_policy`, `server:semantic_proposals`, `server:semantic_proposer_policy`. (Note: `application_intelligence_result` and `job_understanding_result`/`job_fit_result` are present as dependency *values* even though they're also stage-result artifact types in their own right — a "changed" reason for one of these means a downstream stage's own upstream fingerprint moved, distinct from the "is itself stale" transitive case for the same type name.)

**Verification note:** ran two exact scenarios against the real codebase while writing this plan (not simulated — actually executed against `check_staleness`).

Scenario A — profile changes, nothing rerun yet:
```
FIT REASONS:
 - profile_snapshot changed (used 'profile_A', current is 'profile_B')
 - job_fit_request is itself stale: profile_snapshot changed (...)
AI REASONS:
 - profile_snapshot changed (used 'profile_A', current is 'profile_B')
 - job_fit_result is itself stale: profile_snapshot changed (...); job_fit_request is itself stale: (...)
 - application_intelligence_request is itself stale: (...)
```

Scenario B — profile changed AND Job Fit has already been rerun against the new profile (Job Fit is now fresh, Application Intelligence is not):
```
AI REASONS:
 - profile_snapshot changed (used 'profile_A', current is 'profile_B')
 - job_fit_result changed (used 'fit_A', current is 'fit_B')
 - application_intelligence_request is itself stale: profile_snapshot changed (...); job_fit_result changed (...)
```

Scenario B is the important one and it breaks a naive "prefer the first transitive reason" rule: the only `"is itself stale"` entry here is on `application_intelligence_request` (the *request* artifact, not a `STAGE_ORDER`-owned result type), and picking it would produce a wrong or fallback-generic sentence, not "Job Fit was updated." The correct immediate cause in Scenario B is the second reason, `job_fit_result changed` — a **direct** mismatch entry, but on an artifact type (`job_fit_result`) that IS a `STAGE_ORDER`-owned result type via `_ARTIFACT_TYPE_TO_STAGE`.

**Corrected selection rule:** rather than preferring by reason *kind* (transitive vs. direct), prefer by whether the extracted upstream type maps to a `STAGE_ORDER` stage at all:
1. Walk `stale["reasons"]` in order. For each reason, extract its upstream type (transitive extraction if `" is itself stale"` is present, direct extraction otherwise — same parsing as before).
2. Take the **first reason whose extracted upstream type is a key in `_ARTIFACT_TYPE_TO_STAGE`** (i.e., names another pipeline stage's result, not a request/policy artifact) — regardless of whether that reason was itself direct or transitive in form. Use `_ARTIFACT_TYPE_TO_STAGE`/`_STAGE_DISPLAY_NAMES` to name it as "Job Fit" / "Application Intelligence" / etc., with the "was updated" phrasing (works correctly whether the underlying reason said "changed" or "is itself stale" — both mean "this stage's result moved").
3. If no reason's upstream type maps to a stage (e.g. only `profile_snapshot` or a `server:...` policy changed, with no intermediate stage result in between — this is Scenario A's Job Fit case), fall back to `stale["reasons"][0]` and name it directly via `_ARTIFACT_TYPE_NOUNS`, with the "changed" phrasing.
This single rule produces the correct output for both verified scenarios: Scenario A's Job Fit reasons have no stage-mapped upstream type (only `profile_snapshot`), so step 3 applies → "Your Evidence Profile changed... Rerun Job Fit." Scenario A's and B's Application Intelligence reasons both contain a `job_fit_result`-rooted entry (`"is itself stale"` in A, `"changed"` in B) which IS stage-mapped, so step 2 applies in both → "Job Fit was updated... Rerun Application Intelligence," regardless of which reason form carried it.

- [ ] **Step 1: Write the failing exhaustiveness test**

Add to `tests/webapp/services/test_workspace_view.py`:

```python
def test_causal_staleness_noun_map_covers_every_dependency_type():
    from webapp.services.staleness import DEPENDENCY_TYPES
    from webapp.services.workspace_view import _ARTIFACT_TYPE_NOUNS

    all_types = {t for deps in DEPENDENCY_TYPES.values() for t in deps}
    missing = all_types - set(_ARTIFACT_TYPE_NOUNS)
    assert missing == set(), f"missing friendly nouns for: {missing}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py::test_causal_staleness_noun_map_covers_every_dependency_type -v`
Expected: FAIL with `ImportError: cannot import name '_ARTIFACT_TYPE_NOUNS'`

- [ ] **Step 3: Write the noun/stage maps and the helper**

Add to `webapp/services/workspace_view.py` after the existing `RUN_ACTION_LABELS` dict (around line 45):

```python
_ARTIFACT_TYPE_NOUNS: dict[str, str] = {
    "job_posting_snapshot": "the saved job posting",
    "job_understanding_request": "the Understanding request",
    "job_understanding_result": "the Understanding result",
    "resolved_job_evidence": "the accepted job evidence",
    "profile_snapshot": "your Evidence Profile",
    "job_fit_request": "the Job Fit request",
    "job_fit_result": "Job Fit",
    "application_intelligence_request": "the Application Intelligence request",
    "application_intelligence_result": "Application Intelligence",
    "server:active_extensions": "your active professional-knowledge extensions",
    "server:evaluation_policy": "the evaluation policy",
    "server:semantic_fit_policy": "the fit-matching policy",
    "server:semantic_proposer_policy": "the fit-matching provider policy",
    "server:semantic_proposals": "the fit-matching proposals",
    "server:application_intelligence_policy": "the Application Intelligence policy",
    "server:application_intelligence_generation_contract": "the Application Intelligence generation rules",
}

# Which STAGE_ORDER key a given upstream artifact type "belongs to" for the
# purposes of a transitive staleness sentence ("Job Fit was updated after
# this Intelligence result was created").
_ARTIFACT_TYPE_TO_STAGE: dict[str, str] = {
    "job_understanding_result": "understanding",
    "job_fit_result": "fit",
    "application_intelligence_result": "application_intelligence",
    "application_pack": "review",
}

_STAGE_DISPLAY_NAMES: dict[str, str] = {
    "understanding": "Understanding",
    "fit": "Job Fit",
    "application_intelligence": "Application Intelligence",
    "review": "the reviewed pack",
}

# Distinct from _STAGE_DISPLAY_NAMES: used only inside the "this X result was
# created" clause, where "review" needs a noun phrase ("this reviewed pack")
# rather than the definite-article form used standalone ("the reviewed
# pack was updated..."). Reusing _STAGE_DISPLAY_NAMES here for "review"
# would produce the ungrammatical "this the reviewed pack result was
# created" (the leading "the" collides with the preceding "this").
_STAGE_RESULT_NOUNS: dict[str, str] = {
    "understanding": "Understanding",
    "fit": "Job Fit",
    "application_intelligence": "Application Intelligence",
    "review": "reviewed pack",
}

_RERUN_LABELS: dict[str, str] = {
    "understanding": "Rerun Understanding.",
    "fit": "Rerun Job Fit.",
    "application_intelligence": "Rerun Application Intelligence.",
    "review": "Create the reviewed pack again.",
}


def _extract_upstream_type(reason: str) -> str | None:
    """Pull the artifact-type name out of one check_staleness reason string.

    "required fingerprint 'X' is missing" and "required upstream artifact 'X'
    is missing" both use repr()-quoting (single quotes) around the type name;
    " is itself stale", " changed (", and " cannot be resolved" have the bare
    type name as a prefix with no quoting. Quoted forms are checked first
    since they would otherwise false-match on a later bare marker.
    """
    if "required fingerprint '" in reason:
        return reason.split("required fingerprint '", 1)[1].split("'", 1)[0]
    if "required upstream artifact '" in reason:
        return reason.split("required upstream artifact '", 1)[1].split("'", 1)[0]
    for marker in (" is itself stale", " changed (", " cannot be resolved"):
        if marker in reason:
            return reason.split(marker, 1)[0]
    return None


def _causal_staleness_message(stage_key: str, stale: dict[str, Any]) -> str | None:
    if not stale.get("stale") or not stale.get("reasons"):
        return None
    # _STAGE_RESULT_NOUNS (not _STAGE_DISPLAY_NAMES) — this variable only ever
    # appears inside "this {this_stage_name} result was created", and the
    # "review" stage needs a bare noun phrase there ("this reviewed pack
    # result"), not the definite-article display form ("this the reviewed
    # pack result", which is ungrammatical).
    this_stage_name = _STAGE_RESULT_NOUNS.get(stage_key, stage_key)
    rerun = _RERUN_LABELS.get(stage_key, "Rerun this stage.")

    # Prefer the first reason whose upstream artifact type is itself another
    # pipeline stage's result (job_understanding_result / job_fit_result /
    # application_intelligence_result / application_pack) — this is the
    # nearer, more actionable cause, and it is correct whether that reason
    # happened to be phrased as "X changed" (X is now fresh again after being
    # rerun, but this stage hasn't caught up yet) or "X is itself stale" (X
    # hasn't been rerun yet either). Falling back to reasons[0] only happens
    # when nothing in the chain names another stage's result at all — e.g.
    # Job Fit when only the Evidence Profile or a policy changed, with no
    # intermediate stage result in between.
    for reason in stale["reasons"]:
        upstream_type = _extract_upstream_type(reason)
        upstream_stage = _ARTIFACT_TYPE_TO_STAGE.get(upstream_type)
        if upstream_stage is not None:
            upstream_name = _STAGE_DISPLAY_NAMES.get(upstream_stage, upstream_stage)
            return f"{upstream_name} was updated after this {this_stage_name} result was created. {rerun}"

    upstream_type = _extract_upstream_type(stale["reasons"][0])
    upstream_name = _ARTIFACT_TYPE_NOUNS.get(upstream_type, "something this depends on")
    # Sentence-case only the first character — .capitalize() would lowercase
    # the deliberate internal capitals in nouns like "your Evidence Profile".
    sentence_cased = upstream_name[:1].upper() + upstream_name[1:]
    return f"{sentence_cased} changed after this {this_stage_name} result was created. {rerun}"
```

- [ ] **Step 4: Run exhaustiveness test to verify it passes**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py::test_causal_staleness_noun_map_covers_every_dependency_type -v`
Expected: PASS

- [ ] **Step 5: Write a behavioral test for the two spec examples**

Add to `tests/webapp/services/test_workspace_view.py`:

```python
def test_causal_staleness_message_names_direct_cause_on_fit(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    save_artifact(
        conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
        payload={"claims": [], "conflicts": []}, content_id="profile_B",
    )
    view = build_workspace_view_model(conn, workspace_id)
    message = view["stages"]["fit"]["causal_reason"]
    assert "Evidence Profile" in message
    assert "Rerun Job Fit" in message


def test_causal_staleness_message_names_job_fit_as_cause_on_intelligence(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    save_artifact(
        conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
        payload={"claims": [], "conflicts": []}, content_id="profile_B",
    )
    view = build_workspace_view_model(conn, workspace_id)
    message = view["stages"]["application_intelligence"]["causal_reason"]
    assert "Job Fit" in message
    assert "Rerun Application Intelligence" in message
```

Add the needed import at top of the test file: `from webapp.persistence.artifacts import save_artifact` is already imported; `PROFILE_WORKSPACE_ID` is already imported; `build_workspace_view_model` is already imported. No new imports needed.

- [ ] **Step 5b: Write the parser-contract test covering every `check_staleness` reason-string form**

Because `_extract_upstream_type` parses `check_staleness`'s internal reason strings — a coupling this plan deliberately accepts rather than modifying `staleness.py` — that parsing needs its own direct unit coverage independent of the two full-pipeline scenarios above, so a future wording change inside `_check_staleness_recursive` breaks a fast, obvious unit test instead of only a slower integration test. Add to `tests/webapp/services/test_workspace_view.py`:

```python
def test_extract_upstream_type_handles_every_check_staleness_reason_form():
    from webapp.services.workspace_view import _extract_upstream_type

    # Verified directly against webapp/services/staleness.py's actual
    # f-string templates (_check_staleness_recursive and
    # _server_input_identity), not guessed — see plan Task 1's Design section
    # for the traced scenarios these forms come from.
    cases = [
        # "X changed (used '...', current is '...')" — direct mismatch
        ("profile_snapshot changed (used 'profile_A', current is 'profile_B')", "profile_snapshot"),
        # "X is itself stale: ..." — transitive
        ("job_fit_result is itself stale: profile_snapshot changed (...)", "job_fit_result"),
        # "required fingerprint 'X' is missing" — repr()-quoted
        ("required fingerprint 'job_posting_snapshot' is missing", "job_posting_snapshot"),
        # "required upstream artifact 'X' is missing" — repr()-quoted
        ("required upstream artifact 'job_understanding_result' is missing", "job_understanding_result"),
        # "X cannot be resolved: <exception text>" — server: input resolution failure
        ("server:evaluation_policy cannot be resolved: ValueError('boom')", "server:evaluation_policy"),
        # Unknown/unparseable text — must return None, not raise, so the
        # caller's honest fallback ("something this depends on") is reached
        # instead of crashing the whole workspace page.
        ("some completely unrecognized future reason format", None),
    ]
    for reason, expected in cases:
        assert _extract_upstream_type(reason) == expected, f"failed for: {reason!r}"


def test_causal_staleness_message_falls_back_honestly_for_unparseable_reason():
    from webapp.services.workspace_view import _causal_staleness_message

    message = _causal_staleness_message(
        "fit", {"stale": True, "reasons": ["some completely unrecognized future reason format"]},
    )
    assert message is not None
    assert "something this depends on" in message
    assert "Rerun Job Fit" in message
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -k "causal_staleness or extract_upstream_type" -v`
Expected: `test_causal_staleness_message_names_direct_cause_on_fit` and `test_causal_staleness_message_names_job_fit_as_cause_on_intelligence` FAIL with `KeyError: 'causal_reason'` (not wired into `stages` yet). `test_extract_upstream_type_handles_every_check_staleness_reason_form` and `test_causal_staleness_message_falls_back_honestly_for_unparseable_reason` PASS immediately — they call the pure helpers directly (no view-model wiring needed) and both helpers already exist and behave correctly from Step 3.

- [ ] **Step 7: Wire the helper into `build_workspace_view_model`**

In `webapp/services/workspace_view.py`, find the `stages` dict assembly (currently lines 491-498):

```python
    stages = {
        "job": {"label": "Job", "state": job_state, "artifact": artifacts["job"]},
        "understanding": {"label": "Understanding", "state": understanding_state, "artifact": artifacts["understanding"], "staleness": stale["understanding"]},
        "fit": {"label": "Job Fit", "state": fit_state, "artifact": artifacts["fit"], "staleness": stale["fit"]},
        "application_intelligence": {"label": "Application Intelligence", "state": intelligence_state, "artifact": artifacts["intelligence"], "staleness": stale["application_intelligence"]},
        "review": {"label": "Review", "state": review_state, "artifact": artifacts["pack"], "staleness": stale["review"]},
        "status": {"label": "Status", "state": status_state, "artifact": None},
    }
```

Replace with (adds `causal_reason` key to the four staleness-checked stages only):

```python
    stages = {
        "job": {"label": "Job", "state": job_state, "artifact": artifacts["job"]},
        "understanding": {"label": "Understanding", "state": understanding_state, "artifact": artifacts["understanding"], "staleness": stale["understanding"], "causal_reason": _causal_staleness_message("understanding", stale["understanding"])},
        "fit": {"label": "Job Fit", "state": fit_state, "artifact": artifacts["fit"], "staleness": stale["fit"], "causal_reason": _causal_staleness_message("fit", stale["fit"])},
        "application_intelligence": {"label": "Application Intelligence", "state": intelligence_state, "artifact": artifacts["intelligence"], "staleness": stale["application_intelligence"], "causal_reason": _causal_staleness_message("application_intelligence", stale["application_intelligence"])},
        "review": {"label": "Review", "state": review_state, "artifact": artifacts["pack"], "staleness": stale["review"], "causal_reason": _causal_staleness_message("review", stale["review"])},
        "status": {"label": "Status", "state": status_state, "artifact": None},
    }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -k "causal_staleness or extract_upstream_type" -v`
Expected: PASS (all 4 tests)

- [ ] **Step 9: Run the full existing workspace_view test file to check for regressions**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -v`
Expected: All existing tests still PASS (additive key only, no existing assertion touches `causal_reason`)

- [ ] **Step 10: Commit**

```bash
git add webapp/services/workspace_view.py tests/webapp/services/test_workspace_view.py
git commit -m "feat: add causal stale-cause messaging to workspace view model"
```

---

### Task 2: Gate 4 friendly completion-issue mapping

**Files:**
- Modify: `webapp/services/workspace_view.py` (add helper + wire into `build_workspace_view_model` around line 426-442 where `review_completion` is computed)
- Test: `tests/webapp/services/test_workspace_view.py`

**Interfaces:**
- Consumes: `product.application_material_contract.{INSUFFICIENT_CV_UNITS, MISSING_CV_BULLET, INSUFFICIENT_CV_WORDS, INSUFFICIENT_COVER_LETTER_PARAGRAPHS, INSUFFICIENT_COVER_LETTER_WORDS, MIN_CV_UNITS, MIN_CV_WORDS, MIN_COVER_LETTER_PARAGRAPHS, MIN_COVER_LETTER_WORDS}`; `review_completion` dict as returned by `webapp.application_material.application_material_completion` (has `issues`, `qualifying_cv_unit_count`, `cv_word_count`, `qualifying_cover_letter_paragraph_count`, `cover_letter_word_count`).
- Produces: `_friendly_completion_issues(review_completion: dict[str, Any]) -> list[str]` — one sentence per code in `review_completion["issues"]`, in the same order. Attached to the view model as `view["review_completion_friendly_issues"]` (sibling key to existing `review_completion_status`, does not replace or rename `review_completion["issues"]`).

- [ ] **Step 1: Write the failing exhaustiveness test**

```python
def test_completion_issue_message_map_covers_every_issue_code():
    from product.application_material_contract import (
        INSUFFICIENT_CV_UNITS, MISSING_CV_BULLET, INSUFFICIENT_CV_WORDS,
        INSUFFICIENT_COVER_LETTER_PARAGRAPHS, INSUFFICIENT_COVER_LETTER_WORDS,
    )
    from webapp.services.workspace_view import _COMPLETION_ISSUE_MESSAGES

    all_codes = {
        INSUFFICIENT_CV_UNITS, MISSING_CV_BULLET, INSUFFICIENT_CV_WORDS,
        INSUFFICIENT_COVER_LETTER_PARAGRAPHS, INSUFFICIENT_COVER_LETTER_WORDS,
    }
    assert set(_COMPLETION_ISSUE_MESSAGES) == all_codes
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py::test_completion_issue_message_map_covers_every_issue_code -v`
Expected: FAIL with `ImportError: cannot import name '_COMPLETION_ISSUE_MESSAGES'`

- [ ] **Step 3: Write the message map and helper**

Add to `webapp/services/workspace_view.py`, near the top imports section add:

```python
from product.application_material_contract import (
    INSUFFICIENT_CV_UNITS, MISSING_CV_BULLET, INSUFFICIENT_CV_WORDS,
    INSUFFICIENT_COVER_LETTER_PARAGRAPHS, INSUFFICIENT_COVER_LETTER_WORDS,
    MIN_CV_UNITS, MIN_CV_WORDS, MIN_COVER_LETTER_PARAGRAPHS, MIN_COVER_LETTER_WORDS,
)
```

Then add the map and helper (near `_ARTIFACT_TYPE_NOUNS` from Task 1):

```python
_COMPLETION_ISSUE_MESSAGES: dict[str, Any] = {
    INSUFFICIENT_CV_UNITS: lambda rc: (
        f"{rc['qualifying_cv_unit_count']} of {MIN_CV_UNITS} required CV bullets/summary "
        f"lines found."
    ),
    MISSING_CV_BULLET: lambda rc: "At least one approved CV bullet is required.",
    INSUFFICIENT_CV_WORDS: lambda rc: (
        f"Your approved CV wording is {rc['cv_word_count']} words — it needs at least "
        f"{MIN_CV_WORDS}."
    ),
    INSUFFICIENT_COVER_LETTER_PARAGRAPHS: lambda rc: (
        f"{rc['qualifying_cover_letter_paragraph_count']} of "
        f"{MIN_COVER_LETTER_PARAGRAPHS} required cover-letter paragraphs found."
    ),
    INSUFFICIENT_COVER_LETTER_WORDS: lambda rc: (
        f"Your approved cover letter is {rc['cover_letter_word_count']} words — it needs "
        f"at least {MIN_COVER_LETTER_WORDS}."
    ),
}


def _friendly_completion_issues(review_completion: dict[str, Any]) -> list[str]:
    # No `if code in _COMPLETION_ISSUE_MESSAGES` filter: this plan's own
    # exhaustiveness requirement (Global Constraints) is that a closed-enum
    # code with no mapping entry must fail loudly, not disappear silently
    # from the user-facing list. A KeyError here — surfaced as a 500 in
    # manual/Playwright testing — is the intended signal that a new issue
    # code was added to application_material_contract.py without updating
    # this map, not a bug to swallow with a filter.
    return [
        _COMPLETION_ISSUE_MESSAGES[code](review_completion)
        for code in review_completion.get("issues", [])
    ]
```

- [ ] **Step 4: Run exhaustiveness test to verify it passes**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py::test_completion_issue_message_map_covers_every_issue_code -v`
Expected: PASS

- [ ] **Step 5: Write a behavioral test for exact counts**

```python
def test_friendly_completion_issues_report_exact_counts(tmp_path, monkeypatch):
    from webapp.services import workspace_view

    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    monkeypatch.setattr(
        workspace_view, "_build_review_items",
        lambda *args, **kwargs: [{
            "review_item_type": "content_unit", "domain_item_id": "unit_ready",
            "source_artifact_id": "ai_A", "item": {"text": "Reviewed material"},
            "decision": {"disposition": "omit_from_positioning"},
        }],
    )
    view = workspace_view.build_workspace_view_model(conn, workspace_id)
    friendly = view["review_completion_friendly_issues"]
    assert any("0 of 2 required CV bullets" in message for message in friendly)


def test_unmapped_completion_issue_code_fails_loudly_instead_of_disappearing():
    from webapp.services.workspace_view import _friendly_completion_issues

    review_completion = {
        "issues": ["some_future_issue_code_not_yet_mapped"],
        "qualifying_cv_unit_count": 0, "cv_word_count": 0,
        "qualifying_cover_letter_paragraph_count": 0, "cover_letter_word_count": 0,
    }
    try:
        _friendly_completion_issues(review_completion)
    except KeyError:
        pass
    else:
        raise AssertionError(
            "an unmapped issue code was silently dropped instead of raising — "
            "this defeats the exhaustiveness guarantee"
        )
```

- [ ] **Step 6: Run both new tests**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -k "friendly_completion_issues or unmapped_completion_issue" -v`
Expected: `test_friendly_completion_issues_report_exact_counts` FAILs with `KeyError: 'review_completion_friendly_issues'` — the helper exists (from Step 3) but isn't wired into the view model's return dict yet. `test_unmapped_completion_issue_code_fails_loudly_instead_of_disappearing` PASSes immediately — it calls `_friendly_completion_issues` directly (no view-model wiring needed) and the helper written in Step 3 already raises `KeyError` on an unmapped code by construction (no silent-filter branch was written). If this second test does NOT pass, it means Step 3 was implemented with a silent filter — go back and remove it.

- [ ] **Step 7: Wire the helper into the return dict**

In `webapp/services/workspace_view.py`, find the `return` statement of `build_workspace_view_model` (currently around line 525-557). Add one new key to the dict, next to the existing `"review_completion": review_completion,` line:

```python
        "review_completion": review_completion,
        "review_completion_friendly_issues": _friendly_completion_issues(review_completion),
```

- [ ] **Step 8: Run test to verify it passes**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py::test_friendly_completion_issues_report_exact_counts -v`
Expected: PASS

- [ ] **Step 9: Run the full workspace_view test file**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -v`
Expected: All PASS

- [ ] **Step 10: Commit**

```bash
git add webapp/services/workspace_view.py tests/webapp/services/test_workspace_view.py
git commit -m "feat: add friendly Gate 4 completion-issue messages with exact counts"
```

---

### Task 3: Historical-pack-vs-current-readiness presentation flag

**Files:**
- Modify: `webapp/services/workspace_view.py`
- Test: `tests/webapp/services/test_workspace_view.py`

**Interfaces:**
- Consumes: `stages["review"]["artifact"]` (truthy iff a pack artifact exists for the workspace, from `artifacts["pack"]`); `review_completion_status` (already computed local variable in `build_workspace_view_model`).
- Produces: `view["has_historical_pack_with_incomplete_current_material"]` — `bool`. `True` iff `stages["review"]["artifact"]` is truthy AND `review_completion_status != "READY"`.

- [ ] **Step 1: Write the failing test**

```python
def test_historical_pack_with_incomplete_current_material_flag_true_when_both_hold(
    tmp_path, monkeypatch,
):
    from webapp.services import workspace_view

    conn, workspace_id = _workspace(tmp_path)
    _, fit, intelligence = _seed_evidence(conn, workspace_id)
    pack = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_pack",
        payload={"source_artifacts": {}, **completion_ready_pack_payload("hist")},
        content_id="pack_hist",
    )
    record_dependency_fingerprint(conn, artifact_id=pack["id"], upstream_artifact_type="job_fit_result", upstream_content_id=fit["content_id"])
    record_dependency_fingerprint(conn, artifact_id=pack["id"], upstream_artifact_type="application_intelligence_result", upstream_content_id=intelligence["content_id"])
    record_status_change(
        conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-20",
        submitted_pack_artifact_id=pack["id"], _allow_drafted=True,
    )
    monkeypatch.setattr(
        workspace_view, "_build_review_items",
        lambda *args, **kwargs: [{
            "review_item_type": "content_unit", "domain_item_id": "unit_ready",
            "source_artifact_id": intelligence["id"], "item": {"text": "New material"},
            "decision": {"disposition": "omit_from_positioning"},
        }],
    )

    view = workspace_view.build_workspace_view_model(conn, workspace_id)

    assert view["has_historical_pack_with_incomplete_current_material"] is True


def test_historical_pack_flag_false_when_no_pack_exists(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    view = build_workspace_view_model(conn, workspace_id)
    assert view["has_historical_pack_with_incomplete_current_material"] is False


def test_historical_pack_flag_false_when_current_material_is_ready(tmp_path, monkeypatch):
    from webapp.services import workspace_view

    conn, workspace_id = _workspace(tmp_path)
    _, fit, intelligence = _seed_evidence(conn, workspace_id)
    pack = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_pack",
        payload={"source_artifacts": {}, **completion_ready_pack_payload("hist2")},
        content_id="pack_hist2",
    )
    record_dependency_fingerprint(conn, artifact_id=pack["id"], upstream_artifact_type="job_fit_result", upstream_content_id=fit["content_id"])
    record_dependency_fingerprint(conn, artifact_id=pack["id"], upstream_artifact_type="application_intelligence_result", upstream_content_id=intelligence["content_id"])

    # Deterministically force the CURRENT (post-pack) material to satisfy
    # every completion threshold, rather than relying on whatever
    # _seed_evidence's two review items happen to sum to — MIN_CV_UNITS=2
    # (one must be a cv_bullet), MIN_CV_WORDS=20, MIN_COVER_LETTER_PARAGRAPHS=1,
    # MIN_COVER_LETTER_WORDS=40. Words below are padded well past each
    # threshold so this stays true even if the thresholds are tuned later.
    cv_bullet_text = " ".join(f"bulletword{i}" for i in range(15))
    cv_summary_text = " ".join(f"summaryword{i}" for i in range(15))
    cover_paragraph_text = " ".join(f"coverword{i}" for i in range(50))
    # NOTE: application_material_completion's _acknowledged_content_unit_ids
    # requires decision["domain_item_id"] (and reads review_item_type too) —
    # verified directly against webapp/application_material.py: a decision
    # dict with only {"disposition": ...} and no domain_item_id yields an
    # EMPTY acknowledged set, so nothing would qualify and the fixture would
    # silently produce INCOMPLETE instead of the intended READY. Every
    # decision below must carry domain_item_id + review_item_type to match
    # the real shape _latest_decisions produces from actual DB rows.
    ready_items = [
        {
            "review_item_type": "content_unit", "domain_item_id": "unit_ready_cv_bullet",
            "source_artifact_id": intelligence["id"],
            "item": {
                "unit_id": "unit_ready_cv_bullet", "unit_type": "cv_bullet",
                "status": "READY", "text": cv_bullet_text,
                "profile_evidence_ids": ["clm_direct"],
            },
            "decision": {
                "domain_item_id": "unit_ready_cv_bullet", "review_item_type": "content_unit",
                "disposition": "acknowledged_and_proceed",
            },
        },
        {
            "review_item_type": "content_unit", "domain_item_id": "unit_ready_cv_summary",
            "source_artifact_id": intelligence["id"],
            "item": {
                "unit_id": "unit_ready_cv_summary", "unit_type": "cv_summary_line",
                "status": "READY", "text": cv_summary_text,
                "profile_evidence_ids": ["clm_functional"],
            },
            "decision": {
                "domain_item_id": "unit_ready_cv_summary", "review_item_type": "content_unit",
                "disposition": "acknowledged_and_proceed",
            },
        },
        {
            "review_item_type": "content_unit", "domain_item_id": "unit_ready_cover",
            "source_artifact_id": intelligence["id"],
            "item": {
                "unit_id": "unit_ready_cover", "unit_type": "cover_letter_paragraph",
                "status": "READY", "text": cover_paragraph_text,
                "profile_evidence_ids": ["clm_transfer"],
            },
            "decision": {
                "domain_item_id": "unit_ready_cover", "review_item_type": "content_unit",
                "disposition": "acknowledged_and_proceed",
            },
        },
    ]
    monkeypatch.setattr(
        workspace_view, "_build_review_items", lambda *args, **kwargs: ready_items,
    )

    view = workspace_view.build_workspace_view_model(conn, workspace_id)

    # Assert unconditionally: this fixture is deterministically READY, so the
    # flag must be False, not merely "False if it happens to be READY."
    assert view["review_completion_status"] == "READY"
    assert view["has_historical_pack_with_incomplete_current_material"] is False
```

Needed imports already present in the test file (`save_artifact`, `record_dependency_fingerprint`, `record_status_change`, `completion_ready_pack_payload`, `build_workspace_view_model`). The third test additionally needs `from webapp.services import workspace_view` (for `monkeypatch.setattr`), matching the same local-import pattern already used by `test_omitting_all_usable_material_keeps_gate_four_incomplete` elsewhere in this file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -k historical_pack -v`
Expected: FAIL — `KeyError: 'has_historical_pack_with_incomplete_current_material'` on all three tests.

- [ ] **Step 3: Wire the flag into the return dict**

In `webapp/services/workspace_view.py`, immediately before the final `return` statement of `build_workspace_view_model`, add:

```python
    has_historical_pack_with_incomplete_current_material = bool(
        stages["review"]["artifact"]
    ) and review_completion_status != "READY"
```

Then add the key to the returned dict, next to `"review_completion_friendly_issues"`:

```python
        "has_historical_pack_with_incomplete_current_material": has_historical_pack_with_incomplete_current_material,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -k historical_pack -v`
Expected: PASS (all 3 tests). All three assertions are unconditional: `test_historical_pack_flag_false_when_current_material_is_ready` was constructed with a monkeypatched fixture verified independently (against `application_material_completion` directly) to always produce `review_completion_status == "READY"` — the test asserts that fact explicitly before asserting the flag, so a future regression that breaks the READY guarantee fails loudly at the first assertion rather than the test silently degrading to a no-op.

- [ ] **Step 5: Run full workspace_view test suite**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add webapp/services/workspace_view.py tests/webapp/services/test_workspace_view.py
git commit -m "feat: add historical-pack-vs-current-readiness presentation flag"
```

---

### Task 4: Friendly exclusion-reason mapping with honest fallback

**Files:**
- Modify: `webapp/services/workspace_view.py` (extend `_build_evidence_items`, currently lines 163-217)
- Test: `tests/webapp/services/test_workspace_view.py`

**Interfaces:**
- Consumes: existing evidence-item dicts built in `_build_evidence_items` (each has `label`, `source`, `detail`).
- Produces: `_friendly_exclusion_reason(raw_reason: str) -> str` — pure function. Every evidence item whose `label == "Unsupported — excluded from application material"` gains a `friendly_reason` key.

- [ ] **Step 1: Write the failing test for the known-pattern case and the fallback case**

```python
def test_friendly_exclusion_reason_recognizes_known_rendering_template_pattern():
    from webapp.services.workspace_view import _friendly_exclusion_reason

    raw = "no rendering template is registered for assertion_type 'responsibility'"
    friendly = _friendly_exclusion_reason(raw)
    assert friendly == (
        "This suggestion was excluded because the system could not safely "
        "convert it into approved CV wording."
    )


def test_friendly_exclusion_reason_falls_back_honestly_for_unknown_text():
    from webapp.services.workspace_view import _friendly_exclusion_reason

    friendly = _friendly_exclusion_reason("some future provider-specific reason string")
    assert friendly == (
        "This wording couldn't be verified against your Evidence Profile, so it "
        "was left out of your application material automatically."
    )


def test_evidence_items_carry_friendly_reason_for_unsupported_claims(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_evidence(conn, workspace_id)
    view = build_workspace_view_model(conn, workspace_id)
    unsupported = [
        item for item in view["evidence_items"]
        if item["label"] == "Unsupported — excluded from application material"
    ]
    assert unsupported
    assert all("friendly_reason" in item for item in unsupported)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -k friendly_exclusion -v`
Expected: FAIL — `ImportError: cannot import name '_friendly_exclusion_reason'`

- [ ] **Step 3: Write the helper**

Add to `webapp/services/workspace_view.py` above `_build_evidence_items` (currently line 163):

```python
_KNOWN_EXCLUSION_REASON_PATTERNS: tuple[tuple[str, str], ...] = (
    (
        "no rendering template is registered",
        "This suggestion was excluded because the system could not safely "
        "convert it into approved CV wording.",
    ),
    (
        "profile evidence id not found",
        "This suggestion was excluded because it referenced Evidence Profile "
        "information that no longer exists.",
    ),
)

_EXCLUSION_REASON_FALLBACK = (
    "This wording couldn't be verified against your Evidence Profile, so it "
    "was left out of your application material automatically."
)


def _friendly_exclusion_reason(raw_reason: str) -> str:
    lowered = raw_reason.casefold()
    for pattern, friendly in _KNOWN_EXCLUSION_REASON_PATTERNS:
        if pattern in lowered:
            return friendly
    return _EXCLUSION_REASON_FALLBACK
```

- [ ] **Step 4: Run the two pure-function tests to verify they pass**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -k "friendly_exclusion_reason" -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the helper into `_build_evidence_items`**

In `webapp/services/workspace_view.py`, find the three call sites in `_build_evidence_items` that produce `"Unsupported — excluded from application material"` items (currently lines 198-207 for `unsupported_claims`, and lines 211-216 for `review_exclusion`):

```python
    for claim in fit_payload.get("unsupported_claims", []):
        items.append({
            "label": "Unsupported — excluded from application material",
            "source": "job_fit_unsupported_claims", "detail": claim,
        })
    for claim in intelligence_payload.get("unsupported_claims", []):
        items.append({
            "label": "Unsupported — excluded from application material",
            "source": "application_intelligence_unsupported_claims", "detail": claim,
        })
```

Replace with:

```python
    for claim in fit_payload.get("unsupported_claims", []):
        items.append({
            "label": "Unsupported — excluded from application material",
            "source": "job_fit_unsupported_claims", "detail": claim,
            "friendly_reason": _friendly_exclusion_reason(str(claim.get("reason", ""))),
        })
    for claim in intelligence_payload.get("unsupported_claims", []):
        items.append({
            "label": "Unsupported — excluded from application material",
            "source": "application_intelligence_unsupported_claims", "detail": claim,
            "friendly_reason": _friendly_exclusion_reason(str(claim.get("reason", ""))),
        })
```

And find the `review_exclusion` block (currently lines 211-216):

```python
    if pack:
        for exclusion in pack["payload"].get("review_record", {}).get("exclusions", []):
            items.append({
                "label": "Unsupported — excluded from application material",
                "source": "review_exclusion", "detail": exclusion,
            })
```

Replace with:

```python
    if pack:
        for exclusion in pack["payload"].get("review_record", {}).get("exclusions", []):
            items.append({
                "label": "Unsupported — excluded from application material",
                "source": "review_exclusion", "detail": exclusion,
                "friendly_reason": _friendly_exclusion_reason(
                    str(exclusion.get("reason", "")) if isinstance(exclusion, dict) else ""
                ),
            })
```

- [ ] **Step 6: Run the evidence-items integration test to verify it passes**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -k friendly_exclusion -v`
Expected: PASS (all 3 tests)

- [ ] **Step 7: Run full workspace_view suite and full evidence-items regression test**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -v`
Expected: All PASS, including pre-existing `test_all_six_evidence_concepts_are_classified_without_provider_rationale` (unaffected — it only checks `label` set membership, which is unchanged)

- [ ] **Step 8: Commit**

```bash
git add webapp/services/workspace_view.py tests/webapp/services/test_workspace_view.py
git commit -m "feat: add friendly exclusion-reason mapping with honest fallback"
```

---

# Part 2 — Template/UI changes

### Task 5: Fix Gate 4 visibility condition (Finding 1) and render causal/friendly copy in `workspace_detail.html`

**Files:**
- Modify: `webapp/templates/workspace_detail.html` (the review panel, currently around line 55; the stage panels for understanding/fit/application_intelligence, currently lines 21-48)

**Interfaces:**
- Consumes (all already produced by Tasks 1-4): `stages[key]["causal_reason"]`, `view["review_completion_friendly_issues"]`, `view["has_historical_pack_with_incomplete_current_material"]`, `evidence.friendly_reason` (on unsupported evidence items).

- [ ] **Step 1: Fix the Gate 4 visibility condition**

In `webapp/templates/workspace_detail.html`, find (currently the `.gate-four` block, line 55):

```html
<div class="gate-four"><h3>Create the reviewed pack</h3><p>This freezes the reviewed material and moves the workspace to <strong>drafted</strong>. It does not submit anything.</p>{% if stages.application_intelligence.artifact and not stages.review.artifact %}<p>Application material: <span class="badge {% if review_completion_status == 'READY' %}complete{% else %}review{% endif %}">{{ review_completion_status }}</span></p>{% if review_completion.issues %}<details class="technical-details"><summary>Technical details: completion checks</summary><ul class="completion-issues">{% for issue in review_completion.issues %}<li><code>{{ issue }}</code></li>{% endfor %}</ul></details>{% endif %}{% endif %}<button class="button confirm-pack" data-workspace-id="{{ workspace.id }}" {% if not controls.can_confirm_pack %}disabled{% endif %}>Create reviewed pack — does not submit</button>{% if stages.review.artifact %}<div class="pack-downloads"><p>Confirmed. Download the rendered documents (downloading is not submission):</p><a class="button secondary" href="/api/workspaces/{{ workspace.id }}/application-pack/render/cv">Download CV</a> <a class="button secondary" href="/api/workspaces/{{ workspace.id }}/application-pack/render/cover_letter">Download Cover Letter</a></div>{% endif %}</div></section>
```

Replace with (condition now `stages.application_intelligence.artifact and review_completion_status != 'READY'` — independent of pack history; the historical-pack framing sentence and download block gain a distinguishing sentence when `has_historical_pack_with_incomplete_current_material` is true):

```html
<div class="gate-four"><h3>Create the reviewed pack</h3><p>This freezes the reviewed material and moves the workspace to <strong>drafted</strong>. It does not submit anything.</p>{% if stages.application_intelligence.artifact and review_completion_status != 'READY' %}<p class="blocked-note">Your newly regenerated material is not ready to create a{% if has_historical_pack_with_incomplete_current_material %} replacement{% endif %} pack.</p><p>Application material: <span class="badge review">{{ review_completion_status }}</span></p><ul class="completion-issues-friendly">{% for message in review_completion_friendly_issues %}<li>{{ message }}</li>{% endfor %}</ul>{% if review_completion.issues %}<details class="technical-details"><summary>Technical details: completion checks</summary><ul class="completion-issues">{% for issue in review_completion.issues %}<li><code>{{ issue }}</code></li>{% endfor %}</ul></details>{% endif %}{% endif %}<button class="button confirm-pack" data-workspace-id="{{ workspace.id }}" {% if not controls.can_confirm_pack %}disabled{% endif %}>Create reviewed pack — does not submit</button>{% if stages.review.artifact %}<div class="pack-downloads">{% if has_historical_pack_with_incomplete_current_material %}<p>Your previously confirmed application pack is still available to download.</p>{% else %}<p>Confirmed. Download the rendered documents (downloading is not submission):</p>{% endif %}<a class="button secondary" href="/api/workspaces/{{ workspace.id }}/application-pack/render/cv">Download CV</a> <a class="button secondary" href="/api/workspaces/{{ workspace.id }}/application-pack/render/cover_letter">Download Cover Letter</a></div>{% endif %}</div></section>
```

- [ ] **Step 2: Qualify the reviewed-content panel heading when showing historical content**

Find the readiness panel (currently line 14):

```html
<div class="reviewed-output-grid"><section><div class="output-heading"><h3>Reviewed CV content</h3>{% if reviewed_cv_content %}<button class="button button-small secondary" data-action="copy-reviewed-output" data-copy-section="cv" data-copy-target="reviewed-cv-content">Copy CV content</button>{% endif %}</div><div id="reviewed-cv-content" class="copyable-output">{% for unit in reviewed_cv_content %}<p>{{ unit.text }}</p>{% else %}<p class="muted">No CV wording has been approved yet.</p>{% endfor %}</div></section>
<section><div class="output-heading"><h3>Reviewed cover letter content</h3>{% if reviewed_cover_letter_content %}<button class="button button-small secondary" data-action="copy-reviewed-output" data-copy-section="cover-letter" data-copy-target="reviewed-cover-letter-content">Copy cover letter content</button>{% endif %}</div><div id="reviewed-cover-letter-content" class="copyable-output">{% for unit in reviewed_cover_letter_content %}<p>{{ unit.text }}</p>{% else %}<p class="muted">No cover-letter wording has been approved yet.</p>{% endfor %}</div></section></div></section>
```

Replace the two `<h3>` lines and the two empty-state `<p class="muted">` lines:

```html
<div class="reviewed-output-grid"><section><div class="output-heading"><h3>Reviewed CV content{% if has_historical_pack_with_incomplete_current_material %} (from your confirmed pack){% endif %}</h3>{% if reviewed_cv_content %}<button class="button button-small secondary" data-action="copy-reviewed-output" data-copy-section="cv" data-copy-target="reviewed-cv-content">Copy CV content</button>{% endif %}</div><div id="reviewed-cv-content" class="copyable-output">{% for unit in reviewed_cv_content %}<p>{{ unit.text }}</p>{% else %}<p class="muted">No CV wording has been approved yet. Resolve the decisions below{% if not stages.application_intelligence.artifact %}, or run Application Intelligence first{% endif %}.</p>{% endfor %}</div></section>
<section><div class="output-heading"><h3>Reviewed cover letter content{% if has_historical_pack_with_incomplete_current_material %} (from your confirmed pack){% endif %}</h3>{% if reviewed_cover_letter_content %}<button class="button button-small secondary" data-action="copy-reviewed-output" data-copy-section="cover-letter" data-copy-target="reviewed-cover-letter-content">Copy cover letter content</button>{% endif %}</div><div id="reviewed-cover-letter-content" class="copyable-output">{% for unit in reviewed_cover_letter_content %}<p>{{ unit.text }}</p>{% else %}<p class="muted">No cover-letter wording has been approved yet. Resolve the decisions below{% if not stages.application_intelligence.artifact %}, or run Application Intelligence first{% endif %}.</p>{% endfor %}</div></section></div></section>
```

- [ ] **Step 3: Add causal-reason sentences to the three stage panels**

In `webapp/templates/workspace_detail.html`, find the Understanding panel badge line (currently line 21):

```html
<section class="panel" id="understanding"><div class="panel-heading"><div><p class="eyebrow">Grounded extraction</p><h2>Understanding</h2></div><span class="badge {{ stages.understanding.state }}">{{ stages.understanding.state_label }}</span></div>
```

Add a causal-reason line immediately after (before the `{% if stages.understanding.artifact %}` line):

```html
<section class="panel" id="understanding"><div class="panel-heading"><div><p class="eyebrow">Grounded extraction</p><h2>Understanding</h2></div><span class="badge {{ stages.understanding.state }}">{{ stages.understanding.state_label }}</span></div>
{% if stages.understanding.causal_reason %}<p class="blocked-note">{{ stages.understanding.causal_reason }}</p>{% endif %}
```

Find the Job Fit panel badge line (currently line 28):

```html
<section class="panel" id="job-fit"><div class="panel-heading"><div><p class="eyebrow">Evidence comparison</p><h2>Job Fit</h2></div><span class="badge {{ stages.fit.state }}">{{ stages.fit.state_label }}</span></div>
```

Add immediately after:

```html
<section class="panel" id="job-fit"><div class="panel-heading"><div><p class="eyebrow">Evidence comparison</p><h2>Job Fit</h2></div><span class="badge {{ stages.fit.state }}">{{ stages.fit.state_label }}</span></div>
{% if stages.fit.causal_reason %}<p class="blocked-note">{{ stages.fit.causal_reason }}</p>{% endif %}
```

Find the Application Intelligence panel badge line (currently line 44):

```html
<section class="panel" id="application-intelligence"><div class="panel-heading"><div><p class="eyebrow">Evidence-bound positioning</p><h2>Application Intelligence</h2></div><span class="badge {{ stages.application_intelligence.state }}">{{ stages.application_intelligence.state_label }}</span></div>
```

Add immediately after:

```html
<section class="panel" id="application-intelligence"><div class="panel-heading"><div><p class="eyebrow">Evidence-bound positioning</p><h2>Application Intelligence</h2></div><span class="badge {{ stages.application_intelligence.state }}">{{ stages.application_intelligence.state_label }}</span></div>
{% if stages.application_intelligence.causal_reason %}<p class="blocked-note">{{ stages.application_intelligence.causal_reason }}</p>{% endif %}
```

- [ ] **Step 4: Render friendly exclusion reasons in the technical-details block**

Find the unsupported-record markup (currently in the review panel's resolved-decisions `<details>`, line 54):

```html
{% for evidence in evidence_items %}{% if evidence.label == "Unsupported — excluded from application material" %}<article class="unsupported-record"><span class="badge unsupported">Unsupported — excluded from application material</span><p>{{ evidence.detail.get("reason") or evidence.detail.get("item", {}).get("text") or "Excluded item" }}</p><small>Audit only. No inclusion control is available.</small></article>{% endif %}{% endfor %}
```

Replace with (adds the friendly sentence above the existing raw-reason paragraph, which stays unchanged):

```html
{% for evidence in evidence_items %}{% if evidence.label == "Unsupported — excluded from application material" %}<article class="unsupported-record"><span class="badge unsupported">Unsupported — excluded from application material</span>{% if evidence.friendly_reason %}<p>{{ evidence.friendly_reason }}</p>{% endif %}<details class="technical-details"><summary>Technical details: exact reason</summary><p>{{ evidence.detail.get("reason") or evidence.detail.get("item", {}).get("text") or "Excluded item" }}</p></details><small>Audit only. No inclusion control is available.</small></article>{% endif %}{% endfor %}
```

- [ ] **Step 5: Manual smoke check — start the dev server and view a workspace with stale stages**

Run: `python -m webapp.main` (starts uvicorn via `webapp/main.py`; no `--reload` flag is wired up, so restart the process after each template edit), then in a browser create a job, run through Understanding/Fit/Intelligence, edit the Evidence Profile to trigger staleness, and reload the workspace page. Confirm:
- Causal sentences render under the Job Fit and Application Intelligence badges with the expected phrasing.
- No Jinja2 `UndefinedError` in server logs.

- [ ] **Step 6: Run the full existing browser smoke suite to check nothing broke**

Run: `python -m pytest tests/webapp/test_browser_smoke.py -v`
Expected: All existing tests PASS (template changes are additive; `test_stale_and_review_negative_paths_are_enforced_in_rendered_ui` and `test_full_visible_journey_reaches_interview_with_explicit_submission` exercise the touched blocks most heavily)

- [ ] **Step 7: Commit**

```bash
git add webapp/templates/workspace_detail.html
git commit -m "fix: always show Gate 4 completion reason regardless of pack history; add causal stale copy"
```

---

### Task 6: "Getting Started" dashboard card

**Files:**
- Modify: `webapp/templates/dashboard.html`

**Interfaces:**
- Consumes: nothing new — static markup, no view-model dependency.

- [ ] **Step 1: Add the card to `dashboard.html`**

In `webapp/templates/dashboard.html`, insert immediately after the `<section class="hero compact">...</section>` block (currently lines 4-8) and before the `{% if not profile_ready %}` block (currently line 9):

```html
<section class="panel getting-started-card"><h2>How this works</h2><ol class="getting-started-steps">
<li>Evidence Profile</li><li>Find/Add Job</li><li>Job Fit</li><li>Intelligence</li><li>Review</li><li>Pack</li><li>Download</li><li>Apply</li>
</ol><a class="button secondary button-small" href="/how-it-works">See the full walkthrough</a></section>
```

- [ ] **Step 2: Add minimal CSS for the step list**

In `webapp/static/app.css`, add near the existing `.filters`/`.filter` rules (append after the `.filter.active{...}` rule):

```css
.getting-started-card{margin:18px 0}.getting-started-steps{list-style:none;display:flex;flex-wrap:wrap;gap:6px 4px;padding:0;margin:10px 0 14px;font-size:13px}.getting-started-steps li{background:#edf2ee;color:#3e4a44;padding:6px 11px;border-radius:999px}.getting-started-steps li:not(:last-child)::after{content:"→";margin-left:10px;color:var(--muted)}
```

- [ ] **Step 3: Tighten dashboard empty-state copy for consistency**

Find (currently line 28):

```html
{% else %}<section class="empty-state"><h2>No {{ filter }} applications</h2><p>Add a saved posting or choose another filter.</p><a class="button" href="/new-job">Add your first job</a></section>{% endif %}
```

Replace with:

```html
{% else %}<section class="empty-state"><h2>No {{ filter }} applications</h2><p>Add your first job posting to get started, or choose another filter above.</p><a class="button" href="/new-job">Add your first job</a></section>{% endif %}
```

- [ ] **Step 4: Manual smoke check**

Run the dev server, load `/`, confirm the card renders above the filters with all 8 labels visible and the link goes to `/how-it-works` (will 404 until Task 7 — that's expected at this point in the plan).

- [ ] **Step 5: Commit**

```bash
git add webapp/templates/dashboard.html webapp/static/app.css
git commit -m "feat: add Getting Started workflow card to dashboard"
```

---

### Task 7: "How it works" nav entry and page (pipeline walkthrough + status glossary)

**Files:**
- Modify: `webapp/templates/base.html` (nav link)
- Modify: `webapp/api/views.py` (new route)
- Create: `webapp/templates/how_it_works.html`

**Interfaces:**
- Consumes: `_search_context(conn, scope.account_id)` (existing helper in `webapp/api/views.py`, used identically by `new_job_page`).
- Produces: `GET /how-it-works` route rendering `how_it_works.html`.

- [ ] **Step 1: Add the nav link**

In `webapp/templates/base.html`, find (currently line 20):

```html
<a href="/search-workspaces">Manage searches</a><a href="/profile">Evidence Profile</a>
```

Replace with:

```html
<a href="/how-it-works">How it works</a><a href="/search-workspaces">Manage searches</a><a href="/profile">Evidence Profile</a>
```

- [ ] **Step 2: Create the template**

Create `webapp/templates/how_it_works.html`:

```html
{% extends "base.html" %}
{% block title %}How it works · Job Search Workspace{% endblock %}
{% block content %}
<section class="hero compact"><div><p class="eyebrow">Reference</p><h1>How this app works</h1>
<p>Every application moves through the same pipeline. Each stage only unlocks once the one before it is current and, where relevant, you've made the decisions it's asking for.</p></div></section>

<section class="panel"><h2>The pipeline</h2><ol class="how-it-works-pipeline">
<li><h3>1. Evidence Profile</h3><p><strong>What it is:</strong> the verified facts about you — skills, experience, education, languages — pulled from your CV and other sources.</p><p><strong>Why it matters:</strong> everything the app writes about you must trace back to something here. Nothing is invented.</p><p><strong>What to do:</strong> set it up once, then keep it updated as your experience changes.</p></li>
<li><h3>2. Find/Add Job</h3><p><strong>What it is:</strong> the job posting you're evaluating, either discovered through search or pasted in directly.</p><p><strong>Why it matters:</strong> it's the fixed source text every later stage compares your evidence against.</p><p><strong>What to do:</strong> add a posting to start a new application workspace.</p></li>
<li><h3>3. Understanding</h3><p><strong>What it is:</strong> the requirements, responsibilities, and logistics extracted from the posting, each traceable back to an exact quote.</p><p><strong>Why it matters:</strong> Job Fit only ever compares against what was actually extracted here — not assumptions about the role.</p><p><strong>What to do:</strong> run it once the posting is saved; rerun it if the posting text changes.</p></li>
<li><h3>4. Job Fit</h3><p><strong>What it is:</strong> a structured comparison of your Evidence Profile against the extracted requirements — direct matches, transferable experience, and gaps.</p><p><strong>Why it matters:</strong> this is the evidence basis for everything Application Intelligence writes next.</p><p><strong>What to do:</strong> review any flagged matches or questions it raises.</p></li>
<li><h3>5. Application Intelligence</h3><p><strong>What it is:</strong> draft CV bullets and cover-letter wording, generated only from evidence Job Fit already accepted.</p><p><strong>Why it matters:</strong> it proposes wording, but never decides on your behalf what gets used.</p><p><strong>What to do:</strong> read the proposals; nothing is included until you review it.</p></li>
<li><h3>6. Review</h3><p><strong>What it is:</strong> your decisions on every proposal, match, and flagged item — use it or leave it out.</p><p><strong>Why it matters:</strong> only what you explicitly approve here can become part of your application pack.</p><p><strong>What to do:</strong> work through the outstanding items until none remain.</p></li>
<li><h3>7. Application Pack</h3><p><strong>What it is:</strong> the frozen, reviewed CV and cover-letter content, created once your reviewed material meets the minimum content requirements.</p><p><strong>Why it matters:</strong> creating it never submits anything — it only prepares the reviewed content for download.</p><p><strong>What to do:</strong> create it once your review queue is empty and the material is ready.</p></li>
<li><h3>8. Download</h3><p><strong>What it is:</strong> the rendered CV and cover-letter documents from your confirmed pack.</p><p><strong>Why it matters:</strong> downloading is just retrieving the file — it still isn't submission.</p><p><strong>What to do:</strong> download and use them in your actual job application, wherever that happens.</p></li>
<li><h3>9. Apply</h3><p><strong>What it is:</strong> you telling the app you actually submitted the application outside the tool.</p><p><strong>Why it matters:</strong> the app never assumes submission on your behalf — you mark it explicitly.</p><p><strong>What to do:</strong> mark applied once you've actually sent it.</p></li>
<li><h3>10. Track outcome</h3><p><strong>What it is:</strong> the real-world result — interview, offer, rejection, and so on.</p><p><strong>Why it matters:</strong> keeps your pipeline view accurate.</p><p><strong>What to do:</strong> update the status as things happen.</p></li>
</ol></section>

<section class="panel"><h2>Status glossary</h2><table class="status-glossary"><thead><tr><th>Status</th><th>What it means</th></tr></thead><tbody>
<tr><td>Current</td><td>Ready to run — nothing is blocking this stage.</td></tr>
<tr><td>Stale / needs updating</td><td>Something it depended on changed since this result was created; it needs to be rerun before it can be trusted.</td></tr>
<tr><td>Needs review</td><td>The system generated something but wants your explicit decision before it's used.</td></tr>
<tr><td>Blocked / incomplete</td><td>This stage can't proceed yet — an earlier requirement (a decision, a rerun, a minimum amount of content) isn't satisfied.</td></tr>
<tr><td>Ready</td><td>This meets every requirement to move forward.</td></tr>
<tr><td>Historical pack</td><td>A CV/cover letter you confirmed previously. It stays downloadable even after later changes make new material stale or incomplete — confirming a new pack never happens automatically.</td></tr>
<tr><td>Drafted</td><td>You've confirmed a reviewed application pack (Gate 4), but haven't told the app you actually submitted it yet.</td></tr>
<tr><td>Applied</td><td>You've told the app you submitted this application outside the tool.</td></tr>
</tbody></table></section>
{% endblock %}
```

- [ ] **Step 3: Add minimal CSS for the pipeline list and glossary table**

In `webapp/static/app.css`, append after the `.getting-started-steps` rule from Task 6:

```css
.how-it-works-pipeline{list-style:none;padding:0;display:grid;gap:16px}.how-it-works-pipeline li{border-top:1px solid var(--line);padding-top:14px}.how-it-works-pipeline h3{margin:0 0 6px;font-size:16px}.how-it-works-pipeline p{margin:4px 0}.status-glossary{width:100%;border-collapse:collapse}.status-glossary th,.status-glossary td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}.status-glossary td:first-child{font-weight:700;white-space:nowrap}
```

- [ ] **Step 4: Add the route**

In `webapp/api/views.py`, add after `new_job_page` (currently ends line 210):

```python
@router.get("/how-it-works", response_class=HTMLResponse)
def how_it_works_page(
    request: Request, conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    return request.app.state.templates.TemplateResponse(
        request, "how_it_works.html", _search_context(conn, scope.account_id)
    )
```

- [ ] **Step 5: Manual smoke check**

Run the dev server, click "How it works" in the nav, confirm the page renders with all 10 pipeline steps and the 8-row glossary table, and confirm the Getting Started card's link (from Task 6) now resolves instead of 404ing.

- [ ] **Step 6: Commit**

```bash
git add webapp/templates/base.html webapp/templates/how_it_works.html webapp/api/views.py webapp/static/app.css
git commit -m "feat: add permanent How it works page with pipeline walkthrough and status glossary"
```

---

# Part 3 — Unit tests

Unit test coverage for Tasks 1-4 was written test-first inline within each task above (exhaustiveness tests, exact-count/exact-string behavioral tests, dual-state combination tests, fallback tests). This section is a checklist confirming full coverage exists before moving to Playwright — no new production code, only verifying and, if needed, filling gaps.

### Task 8: Unit test coverage audit

**Files:**
- Modify (if gaps found): `tests/webapp/services/test_workspace_view.py`

- [ ] **Step 1: List all new tests added in Tasks 1-4 and confirm each spec requirement has coverage**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -v --collect-only | grep -E "causal_staleness|extract_upstream_type|completion_issue|unmapped_completion|historical_pack|friendly_exclusion"`

Expected output includes all of:
```
test_causal_staleness_noun_map_covers_every_dependency_type
test_causal_staleness_message_names_direct_cause_on_fit
test_causal_staleness_message_names_job_fit_as_cause_on_intelligence
test_extract_upstream_type_handles_every_check_staleness_reason_form
test_causal_staleness_message_falls_back_honestly_for_unparseable_reason
test_completion_issue_message_map_covers_every_issue_code
test_friendly_completion_issues_report_exact_counts
test_unmapped_completion_issue_code_fails_loudly_instead_of_disappearing
test_historical_pack_with_incomplete_current_material_flag_true_when_both_hold
test_historical_pack_flag_false_when_no_pack_exists
test_historical_pack_flag_false_when_current_material_is_ready
test_friendly_exclusion_reason_recognizes_known_rendering_template_pattern
test_friendly_exclusion_reason_falls_back_honestly_for_unknown_text
test_evidence_items_carry_friendly_reason_for_unsupported_claims
```

If any are missing, go back to the relevant Task 1-4 step and add them now — do not proceed to Part 4 with a gap.

- [ ] **Step 2: Run the full unit test file one more time**

Run: `python -m pytest tests/webapp/services/test_workspace_view.py -v`
Expected: All PASS (existing + 14 new tests)

- [ ] **Step 3: Commit only if Step 1 found and filled a gap**

```bash
git add tests/webapp/services/test_workspace_view.py
git commit -m "test: fill unit coverage gap for [specific gap found]"
```

(Skip this commit if Step 1 found no gaps — Tasks 1-4 already committed complete coverage.)

---

# Part 4 — Playwright acceptance

All scenarios extend `tests/webapp/test_browser_smoke.py` using its existing fixtures (`live_server`, `page`, `_refresh_profile`, `_run_to_intelligence`, `_click_reload`, `_create_job`, `_assert_no_private_browser_content`). Per the spec's copy-assertion discipline: assert semantic phrases/actions, never full paragraphs.

### Task 9: Shared review-resolution helpers (avoid repeating 30-click loops)

**Why:** three existing tests in this file already inline a `for _ in range(30): ... click ...` loop to resolve every pending review item one disposition at a time, and this plan's new scenarios (Tasks 10 and 11 below) would otherwise add three more copies of the same loop. That repetition is fragile — any future change to review-item markup or the confirm-pack flow means fixing the same loop in six places. Extracting one shared helper per disposition, plus a "confirm the pack" convenience, means future review-UI changes are fixed once. This task only adds the helpers; it does not modify the three pre-existing tests that already inline the loop (out of scope for this plan — they still pass unchanged), but every *new* test this plan adds in Tasks 10-11 uses the shared helper instead of inlining its own copy.

**Files:**
- Modify: `tests/webapp/test_browser_smoke.py`

**Interfaces:**
- Produces: `_resolve_all_pending_reviews(page, disposition: str) -> None` — clicks every outstanding review-item button for the given disposition (`"acknowledged_and_proceed"` or `"omit_from_positioning"`) until none remain, reloading after each click via the existing `_click_reload` helper. `_confirm_pack(page) -> None` — accepts the confirmation dialog and clicks "Create reviewed pack — does not submit", reloading via `_click_reload`.

- [ ] **Step 1: Add the two helpers**

In `tests/webapp/test_browser_smoke.py`, add immediately after `_run_to_intelligence` (currently ends line 400, before `_assert_no_private_browser_content`):

```python
def _resolve_all_pending_reviews(page, disposition: str) -> None:
    for _ in range(30):
        button = page.locator(
            'article.review-item:not(:has(.decision)) '
            f'button.review-action[data-disposition="{disposition}"]'
        ).first
        if button.count() == 0:
            break
        _click_reload(page, button)
    else:
        raise AssertionError(f"review queue did not converge for disposition={disposition!r}")


def _confirm_pack(page) -> None:
    page.once("dialog", lambda dialog: dialog.accept())
    _click_reload(page, page.get_by_role("button", name="Create reviewed pack — does not submit"))
```

- [ ] **Step 2: Run the existing full suite to confirm nothing regressed from this purely additive change**

Run: `python -m pytest tests/webapp/test_browser_smoke.py -v`
Expected: All existing tests still PASS unchanged (this step only adds two new module-level functions; no existing test body was touched)

- [ ] **Step 3: Commit**

```bash
git add tests/webapp/test_browser_smoke.py
git commit -m "test: extract shared review-resolution helpers for Playwright scenarios"
```

---

### Task 10: Causal staleness Playwright scenario

**Files:**
- Modify: `tests/webapp/test_browser_smoke.py`

- [ ] **Step 1: Write the test**

Add after `test_stale_and_review_negative_paths_are_enforced_in_rendered_ui`:

```python
def test_causal_staleness_message_appears_and_differs_by_stage(page, live_server):
    _refresh_profile(page, live_server)
    workspace_url = _run_to_intelligence(page, live_server)

    candidate_path = (
        live_server.profile_root
        / ".claude/skills/job-application-assistant/01-candidate-profile.md"
    )
    candidate_path.write_text(
        candidate_path.read_text(encoding="utf-8")
        + "\n2. Ada Lovelace (2027). A new browser-causal-staleness publication.\n",
        encoding="utf-8",
    )
    _refresh_profile(page, live_server)
    page.goto(workspace_url, wait_until="networkidle")

    fit_panel = page.locator("#job-fit")
    assert fit_panel.get_by_text("Evidence Profile").is_visible()
    assert fit_panel.get_by_text("Rerun Job Fit").is_visible()

    page.locator('input[name="extension_ids"][value="data-transfer"]').check()
    _click_reload(page, page.get_by_role("button", name="Rerun Job Fit"))

    intelligence_panel = page.locator("#application-intelligence")
    assert intelligence_panel.get_by_text("Job Fit").is_visible()
    assert intelligence_panel.get_by_text("Rerun Application Intelligence").is_visible()
    _assert_no_private_browser_content(page, live_server)
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `python -m pytest tests/webapp/test_browser_smoke.py::test_causal_staleness_message_appears_and_differs_by_stage -v`
Expected: PASS

(Per Task 14, Chromium is a mandatory requirement for this plan's completion gate, not an optional check — if `playwright install chromium` hasn't been run yet in this environment, run it now rather than deferring to Task 14; this test must actually execute and pass, not merely be written.)

- [ ] **Step 3: Commit**

```bash
git add tests/webapp/test_browser_smoke.py
git commit -m "test: add Playwright coverage for causal per-stage staleness messages"
```

---

### Task 11: Gate 4 visibility regression + friendly completion counts + How it works + Getting Started + empty-state Playwright scenarios

**Files:**
- Modify: `tests/webapp/test_browser_smoke.py`

- [ ] **Step 1: Write the Finding-1 regression scenario**

Add:

```python
def test_gate_four_reason_survives_an_existing_confirmed_pack(page, live_server):
    _refresh_profile(page, live_server)
    workspace_url = _run_to_intelligence(page, live_server)

    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    _confirm_pack(page)
    assert page.get_by_text("Yes — ready to send", exact=True).is_visible()

    candidate_path = (
        live_server.profile_root
        / ".claude/skills/job-application-assistant/01-candidate-profile.md"
    )
    candidate_path.write_text(
        candidate_path.read_text(encoding="utf-8")
        + "\n2. Ada Lovelace (2027). A new browser-gate-four publication.\n",
        encoding="utf-8",
    )
    _refresh_profile(page, live_server)
    page.goto(workspace_url, wait_until="networkidle")
    page.locator('input[name="extension_ids"][value="data-transfer"]').check()
    _click_reload(page, page.get_by_role("button", name="Rerun Job Fit"))
    _click_reload(page, page.get_by_role("button", name="Rerun Application Intelligence"))

    _resolve_all_pending_reviews(page, "omit_from_positioning")

    assert page.get_by_text("INCOMPLETE", exact=True).is_visible()
    assert page.locator("button.confirm-pack").is_disabled()
    assert page.get_by_text("not ready to create a replacement").is_visible()
    _assert_no_private_browser_content(page, live_server)


def test_friendly_completion_counts_visible_when_material_incomplete(page, live_server):
    _refresh_profile(page, live_server)
    _run_to_intelligence(page, live_server)

    _resolve_all_pending_reviews(page, "omit_from_positioning")

    assert page.get_by_text("INCOMPLETE", exact=True).is_visible()
    assert page.get_by_text("0 of 2 required CV bullets").is_visible()


def test_how_it_works_page_reachable_from_nav_with_pipeline_and_glossary(page, live_server):
    page.goto(live_server.base_url, wait_until="networkidle")
    page.get_by_role("link", name="How it works", exact=True).click()
    page.wait_for_url("**/how-it-works")
    assert page.get_by_role("heading", name="How this app works").is_visible()
    for stage_name in (
        "Evidence Profile", "Find/Add Job", "Understanding", "Job Fit",
        "Application Intelligence", "Application Pack",
    ):
        assert page.get_by_text(stage_name).first.is_visible()
    for term in (
        "Current", "Stale / needs updating", "Needs review", "Blocked / incomplete",
        "Ready", "Historical pack", "Drafted", "Applied",
    ):
        assert page.get_by_text(term, exact=True).first.is_visible()
    _assert_no_private_browser_content(page, live_server)


def test_getting_started_card_visible_on_dashboard_and_links_to_how_it_works(page, live_server):
    page.goto(live_server.base_url, wait_until="networkidle")
    card = page.locator(".getting-started-card")
    assert card.is_visible()
    for label in (
        "Evidence Profile", "Find/Add Job", "Job Fit", "Intelligence",
        "Review", "Pack", "Download", "Apply",
    ):
        assert card.get_by_text(label, exact=True).is_visible()
    with page.expect_navigation(wait_until="networkidle"):
        card.get_by_role("link", name="See the full walkthrough").click()
    assert page.url.endswith("/how-it-works")


def test_reviewed_output_empty_state_names_next_action(page, live_server):
    _refresh_profile(page, live_server)
    _run_to_intelligence(page, live_server)
    empty_state = page.locator("#reviewed-cv-content .muted")
    assert empty_state.is_visible()
    text = empty_state.inner_text()
    assert "Resolve" in text or "Application Intelligence" in text
```

- [ ] **Step 2: Run all five new tests**

Run: `python -m pytest tests/webapp/test_browser_smoke.py -k "gate_four_reason_survives or friendly_completion_counts or how_it_works_page or getting_started_card or reviewed_output_empty_state" -v`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/webapp/test_browser_smoke.py
git commit -m "test: add Playwright coverage for Gate 4 visibility fix, How it works page, and Getting Started card"
```

---

### Task 12: Combined confusing-state regression scenario (spec §4 item 7)

**Files:**
- Modify: `tests/webapp/test_browser_smoke.py`

This is the single most important acceptance scenario in the plan — it reproduces the exact state the original finding was about and would have caught Finding 1 on its own.

- [ ] **Step 1: Write the test**

Add:

```python
def test_historical_pack_and_incomplete_current_material_never_read_as_contradictory(
    page, live_server,
):
    _refresh_profile(page, live_server)
    workspace_url = _run_to_intelligence(page, live_server)

    _resolve_all_pending_reviews(page, "acknowledged_and_proceed")
    _confirm_pack(page)
    cv_link = page.get_by_role("link", name="Download CV")
    cover_letter_link = page.get_by_role("link", name="Download Cover Letter")
    assert cv_link.is_visible()
    assert cover_letter_link.is_visible()
    historical_cv_href = cv_link.get_attribute("href")
    historical_cover_href = cover_letter_link.get_attribute("href")

    candidate_path = (
        live_server.profile_root
        / ".claude/skills/job-application-assistant/01-candidate-profile.md"
    )
    candidate_path.write_text(
        candidate_path.read_text(encoding="utf-8")
        + "\n2. Ada Lovelace (2027). A new browser-combined-regression publication.\n",
        encoding="utf-8",
    )
    _refresh_profile(page, live_server)
    page.goto(workspace_url, wait_until="networkidle")
    assert page.locator(".badge.stale").count() >= 1
    page.locator('input[name="extension_ids"][value="data-transfer"]').check()
    _click_reload(page, page.get_by_role("button", name="Rerun Job Fit"))
    _click_reload(page, page.get_by_role("button", name="Rerun Application Intelligence"))

    _resolve_all_pending_reviews(page, "omit_from_positioning")

    # 1. Historical downloads remain available and point at the same rendered artifact.
    cv_link = page.get_by_role("link", name="Download CV")
    cover_letter_link = page.get_by_role("link", name="Download Cover Letter")
    assert cv_link.is_visible()
    assert cover_letter_link.is_visible()
    assert cv_link.get_attribute("href") == historical_cv_href
    assert cover_letter_link.get_attribute("href") == historical_cover_href
    cv_download = page.request.get(f"{live_server.base_url}{historical_cv_href}")
    assert cv_download.status == 200

    # 2. The historical pack is explicitly labeled as previous/confirmed, not
    #    presented as if it were the freshly reviewed material.
    assert page.get_by_text("previously confirmed application pack is still available").is_visible()

    # 3. A separate, distinct statement says the replacement pack is not ready,
    #    with the actual current completion issue visible.
    assert page.get_by_text("not ready to create a replacement").is_visible()
    assert page.get_by_text("INCOMPLETE", exact=True).is_visible()
    assert page.get_by_text("required CV bullets").is_visible()

    # 4. The confirm-pack button stays disabled — no automatic replacement.
    assert page.locator("button.confirm-pack").is_disabled()

    # 5. The reviewed-content panel heading is qualified as historical, never
    #    presented as the current unreviewed material.
    assert page.get_by_text("Reviewed CV content (from your confirmed pack)").is_visible()

    _assert_no_private_browser_content(page, live_server)
```

- [ ] **Step 2: Run the test**

Run: `python -m pytest tests/webapp/test_browser_smoke.py::test_historical_pack_and_incomplete_current_material_never_read_as_contradictory -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/webapp/test_browser_smoke.py
git commit -m "test: add combined regression for historical pack + incomplete current material distinction"
```

---

# Part 5 — Regression verification

### Task 13: Confirm untouched-file boundary

**Files:** none modified — verification only.

- [ ] **Step 1: Diff-check that no out-of-scope file changed**

Diffs are measured against the pinned baseline commit `485c997` recorded in Task 0, never against symbolic `master` — this guarantees the comparison is stable even if another session moves `master` while this ticket is in progress. Run (from inside the Task 0 worktree):

```bash
git diff 485c997...HEAD --stat -- product/ webapp/persistence/ webapp/services/staleness.py webapp/application_material.py webapp/services/http_api.py
```

Expected: empty output (no changes to any file in this list). If anything appears, stop and investigate before proceeding — this plan should never touch these files.

- [ ] **Step 2: Confirm no `webapp/api/*.py` other than `views.py` changed**

Run:

```bash
git diff 485c997...HEAD --stat -- webapp/api/ | grep -v "views.py"
```

Expected: empty output.

- [ ] **Step 3: Re-run the full staleness and completion-contract unit suites unmodified**

Run:

```bash
python -m pytest tests/webapp/services/test_staleness.py tests/webapp/test_application_material.py -v
```

Expected: All PASS, unchanged pass/fail set compared to a run at the pinned baseline `485c997` before this branch's changes.

- [ ] **Step 4: Re-run existing Gate 4 workflow tests**

Run:

```bash
python -m pytest tests/webapp/persistence/test_workflow.py -v
```

Expected: All PASS, unmodified.

- [ ] **Step 5: Commit nothing — this task is verification only**

If any step above fails, do not commit further work; return to the relevant task and fix the boundary violation first.

---

### Task 14: Full Chrome-inclusive suite — Chromium is mandatory for this gate

**Chromium is a hard requirement for declaring this ticket complete, not an optional extra.** This ticket is fundamentally UI/Playwright work (causal copy rendered in templates, a new page, a dashboard card) — its correctness cannot be established by unit tests against Python dicts alone. A prior worktree's environment gap (missing Chromium executable, `.claude/worktrees/.../task-3-report.md`) was tolerable for tickets where Playwright was incidental coverage; it is not tolerable here, where the working browser journeys demonstrated by `485c997`'s own acceptance testing are the whole point of this ticket. "Browser suite unexercised" is a blocker to completion, not an acceptable final-report caveat.

**Files:** none modified — verification only.

- [ ] **Step 1: Install Chromium unconditionally, before running anything**

Run:

```bash
playwright install chromium
```

If this command fails (no network access, disk space, or similar genuine environment failure — not "let's skip it"), stop here and escalate to the user before proceeding; do not report this ticket complete without a green run from Step 3.

- [ ] **Step 2: Run the complete repo test suite**

Run:

```bash
python -m pytest tests/ -v
```

- [ ] **Step 3: Require 100% pass — no tolerated failure category**

Expected: 100% pass, including all 7 new Playwright scenarios from Tasks 10-12 (plus the shared helpers added in Task 9), all pre-existing browser-smoke tests, and every unit test from Tasks 1-4/8. There is no accepted "known gap" bucket for this run — any failure, Playwright or otherwise, is investigated and fixed before this task is considered done. If any test fails, treat it exactly like any other failing test in this plan: diagnose the root cause (a genuine regression in this plan's changes, a flaky/timing issue in the test itself, or a pre-existing repo issue unrelated to this ticket) and either fix it or, only if it is unambiguously pre-existing and unrelated to any file this plan touches (per the Task 13 file list), document that specific test name and reason in the final report — never as a blanket "Chromium unavailable" excuse.

- [ ] **Step 4: Report final status to the user**

No commit for this task — it's the final verification gate. Report the pass/fail count from a green (or explicitly investigated and justified) run. A report claiming ticket completion with an unexercised browser suite is not acceptable output for this task.

---

## Self-Review Notes

**Spec coverage check:** every numbered item in the spec's §2 (2a stale causal messages, 2b Gate 4 always-visible reason, 2b-2 historical/current split, 2c exclusion friendly+preserved reason, 2d How it works + glossary, 2e empty states, 2f Getting Started card) maps to a task above (Tasks 1, 2, 5, 3, 4/5, 7, 5/6, 6 respectively). Spec §4's 7 Playwright scenarios map to Tasks 10-12 (built on the shared helpers from Task 9). Spec §6's risk mitigations (exhaustiveness tests, read-only presentation flag, no JSON API changes) map to Task 8's audit and Task 13's boundary check.

**Type consistency check:** `stage["causal_reason"]` (Task 1) is read in Task 5's Step 3 template edits using the same key name across all three stage panels. `review_completion_friendly_issues` (Task 2) is read in Task 5's Step 1 template edit using the same key name. `has_historical_pack_with_incomplete_current_material` (Task 3) is read identically in Task 5's Steps 1-2. `friendly_reason` (Task 4, on evidence items) is read in Task 5's Step 4. No renaming drift found.
