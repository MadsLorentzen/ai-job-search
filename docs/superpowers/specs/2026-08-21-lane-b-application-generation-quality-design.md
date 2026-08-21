# Lane B — Application Generation Quality: Design

Status: **Approved for implementation planning.** Not yet implemented. This document
reflects the design after three review rounds; see "Design history" at the end.

## Baseline

- `master` at `e626dde` (PR #16, "Enforce substantive application completion
  minimum" / Issue #15). Ticket 8 (Application Intelligence v0), Ticket 9 (Web
  Product Workflow), Ticket 10 (Application Management Usability), and the
  Issue #15 substantive-completion contract are all merged.
- **Lane B does not depend on User Profile v1** and must not be held for it.
  User Profile is intent/search-preference data (what jobs to look for); Lane B's
  input boundary is the already-validated `Profile Snapshot` (candidate evidence)
  and `Job Fit Result` (Ticket 7 output) — a separate contract that exists today
  and is not owned by the User Profile effort. If a future profile feature adds
  writing-preference fields, that is a distinct, later contract change to this
  design, not a prerequisite for it. Lane B may begin immediately.
- Running in parallel, out of scope here: Ticket 11 discovery/ranking work
  (separate lane, separate owner).

## Purpose

Improve the *quality and usefulness* of generated CV/cover-letter material without
touching evidence validation, without adding a production LLM quality judge, and
without relaxing or reinterpreting the Issue #15 substantive-completion contract.
"Better" means: fuller job-requirement coverage from accepted evidence, more
natural composition, a richer-but-still-closed rendering repertoire, and material
that clears the Issue #15 minimum because it is substantively richer — never
because thresholds were gamed or padded.

## Boundary (unchanged, restated)

> **Local code defines what is permissible; the untrusted provider chooses what is
> useful from within that permissible space; local code verifies and renders the
> choice.**

- The LLM proposer (`product/openai_application_intelligence_provider.py`) selects
  evidence ids, unit order, one bounded `rendering_variant` per atom from an
  enumerated table, and connectives from a closed allowlist. It never emits prose.
- `product/application_intelligence.py` remains the sole authority for eligibility,
  rendering, evidence validation, conflict rejection, and acceptance.
- Free-text candidate invention remains forbidden. Unsupported material remains
  rejected. No LLM is added anywhere in the validation or acceptance path.

Lane B works *inside* this boundary: richer permissible space (templates,
connectives, coverage signal, typed plans), better choices within it (prompt), and
a way to measure whether generation is getting more useful (regression suite) —
without moving the boundary itself.

## Components

### 1. Typed `cv_emphasis_plan` / `cover_letter_plan` contract

Today these are untyped passthrough: `analyze_application_intelligence` copies
`(proposal or {}).get("cv_emphasis_plan", [])` / `cover_letter_plan` straight into
the result, and `validate_application_intelligence_result` only checks
`isinstance(result.get(field), list)`. No structure, no validation, nothing an eval
suite can assert against.

New shape, one entry per planned unit:

```
{
  "plan_id": string,                     # provider-supplied, opaque
  "target_unit_type": one of UNIT_TYPES,
  "target_job_requirement_ids": [string], # job_requirement_ids this unit intends to cover
  "rationale_kind": enum,                 # closed vocabulary, no free text — see below
}
```

`rationale_kind` is a closed enum describing *why* the unit is planned, not prose:
`"covers_uncovered_requirement"`, `"reinforces_required_dimension"`,
`"strengthens_direct_match"`, `"addresses_gap_context"`. This mirrors the
connective-allowlist pattern: mechanically checkable membership, never free text.

**Validation, fail-closed, separate from `unsupported_claims`:** a new
`_validate_plan_entry_shape` mirrors `_validate_atom_shape`'s pattern. A malformed
plan entry (bad enum, unknown unit type, non-list `target_job_requirement_ids`) is
**dropped from the plan**, not raised as an error, and not routed into
`unsupported_claims` — that field is reserved for candidate/application content
that could not be supported by evidence, a distinct concept from a malformed
planning-metadata entry. Instead, dropped entries are recorded in a new top-level
result field:

```
"plan_issues": [{"field": "cv_emphasis_plan"|"cover_letter_plan", "index": int, "reason": string}]
```

This keeps the audit model honest: a planning-schema problem is diagnostics, not an
application-content-integrity problem.

`validate_application_intelligence_result` gains shape validation for
`cv_emphasis_plan`/`cover_letter_plan` (now typed, not just "is a list") and for
the new `plan_issues` field (typed, always present, may be empty).

**`plan_issues` is diagnostic, not authority.** A malformed plan entry is dropped
fail-closed and reported, exactly as above — but it carries no independent power
over acceptance or completion. Specifically:

- A `plan_issues` entry must never invalidate an otherwise evidence-valid rendered
  unit. Plan entries are guidance for *what the provider intended to compose*; a
  unit's own atoms are validated entirely on their own terms by
  `_adjudicate_content_unit`, independent of whether the plan entry that motivated
  it was well-formed.
- A `plan_issues` entry must never be counted as, or converted into, an
  `unsupported_claims` entry. The two fields answer different questions
  (`unsupported_claims`: "was this candidate-bearing content rejected?";
  `plan_issues`: "was this planning metadata malformed?") and must never be
  merged, summed, or cross-reported as if interchangeable.
- A `plan_issues` entry must never independently alter the Issue #15 substantive-
  completion predicate (`application_material_completion` /
  `application_material_is_completion_ready`). That predicate reads only
  `cv_content`/`cover_letter_content` plus the review record's acknowledgments —
  never `cv_emphasis_plan`, `cover_letter_plan`, or `plan_issues`. The plan guides
  composition; the rendered, evidence-validated units remain the sole authority
  for completion.

### 2. Requirement coverage — computed from accepted rendered units only

Coverage must **not** be computable from the raw provider proposal. The chain is:

> Ticket 7 match → its `job_requirement_ids` → its `profile_evidence_ids` → an atom
> in the *accepted* unit that cites at least one of those evidence ids → that
> unit survives `_adjudicate_content_unit` (eligibility + rendering + evidence
> validation + conflict check) and lands in `cv_content`/`cover_letter_content`
> with `status == "READY"` and non-empty rendered `text` → only then is the
> requirement counted covered.

A proposed atom that fails eligibility, fails rendering, cites unsupported or
conflicted evidence, or otherwise lands in `unsupported_claims` contributes **zero**
coverage — even if the provider's plan claimed it would cover something.

New pure function in `product/application_intelligence.py`:

```python
def _compute_requirement_coverage(
    job_fit_result: dict[str, Any],
    accepted_units: list[dict[str, Any]],
) -> dict[str, Any]:
    """required_job_requirement_ids: union of job_requirement_ids across
    direct_matches/functionally_equivalent_matches/transferable_matches.
    covered_job_requirement_ids: subset of the above where at least one
    accepted unit (status READY, non-empty text) cites a profile_evidence_id
    that belongs to a match carrying that requirement id.
    Returns {"required": [...], "covered": [...], "uncovered": [...]}, all sorted.
    """
```

This runs **after** `_adjudicate_content_unit` has produced `cv_content` +
`cover_letter_content`, inside `analyze_application_intelligence`, and is exposed
two ways:

- **Result-level diagnostic field** `requirement_coverage` (new, always present on
  `analyze_application_intelligence`'s output) — computed strictly from *this
  call's own* accepted units, per the chain above. Lets the eval suite assert
  coverage deterministically without any LLM judge.
- **Provider input** (`_hosted_input` in the OpenAI provider) — a *different*
  computation, reusing the same underlying function with an empty accepted-units
  list, since the proposal flow is single-shot: at the moment the provider is
  called, no units have been accepted yet (there is nothing prior to adjudicate).
  This necessarily yields `covered: []` and `uncovered: <all required ids>` — it is
  not a claim that anything is covered, only the *target set* the provider should
  try to address. This is a bootstrap signal, not a violation of "accepted units
  only": the result-level field and the provider-input field are two different
  consumers of the same function at two different points in the same call, and
  only the result-level field is ever presented as "coverage achieved."

`requirement_coverage` is a required, always-populated field on the result — see
Component 3 for exactly how this is versioned; it is **not** treated as a
backward-compatible same-version addition, because `validate_application_intelligence_result`
enforces an *exact* top-level key set (`_object_shape(result, required, required, ...)`
with `required == allowed`), so adding a field to that set is a breaking shape
change for any code still asserting the old exact shape.

### 3. Result and proposal contract versioning

This is a real contract evolution, not an invisible implementation detail, and the
existing validators make that concrete: `validate_application_intelligence_result`
checks the result's top-level keys against an *exact* required-and-allowed set
(`RESULT_VERSION = SCHEMA["$defs"]["resultVersion"]["const"]`, currently
`"application-intelligence-result.v0"`), and the OpenAI provider's strict response
schema (`openai_atom_proposal_schema`, named
`application_intelligence_atom_proposal_v0`) sets `additionalProperties: false` and
allows only `content_units` — the provider **cannot return either typed plan under
the current schema**, full stop. Both contracts move together:

- **Result contract → `application-intelligence-result.v1`.** New required fields:
  typed `cv_emphasis_plan`/`cover_letter_plan` entries (Component 1), `plan_issues`
  (Component 1), `requirement_coverage` (Component 2). `RESULT_VERSION` in
  `application-intelligence-contract.v0.schema.json` (the schema file itself keeps
  its `v0` filename per existing convention — Ticket 7's schema file is
  `job-fit-contract.v1.schema.json` alongside a retained `v0` file, so the pattern
  here is a **new schema file**, `application-intelligence-contract.v1.schema.json`,
  not an in-place edit) defines the v1 `resultVersion` const and the v1 required
  top-level shape. `analyze_application_intelligence` emits `schema_version:
  "application-intelligence-result.v1"` going forward.
- **Proposal contract → `application_intelligence_atom_proposal_v1`.** The OpenAI
  provider's strict schema (`openai_atom_proposal_schema`) gains `cv_emphasis_plan`
  and `cover_letter_plan` as typed, closed-shape arrays (mirroring the existing
  `content_units` array's strict-object-per-entry pattern — enums only, no free
  text, `additionalProperties: false` throughout), and the schema's `name` becomes
  `application_intelligence_atom_proposal_v1`. The only proposer shipped is this
  OpenAI provider, moving to v1 in the same change, so there is no live v0 proposer
  to stay compatible with. `analyze_application_intelligence`'s local adjudication
  of `cv_emphasis_plan`/`cover_letter_plan` (Component 1) is defensive regardless —
  a proposal with plans absent or malformed is treated as empty-with-`plan_issues`,
  never a hard failure — matching how `proposal or {}).get(...)` already tolerates
  a missing `content_units` today, and incidentally keeping pre-Lane-B test
  fixtures that omit plans from crashing. `analyze_application_intelligence` only
  ever *emits* v1 results.
- **Historical v0 artifacts stay immutable and viewable, never silently reinterpreted
  as v1.** Persisted `application_intelligence_result` artifacts already carry their
  own `schema_version` field and are stored as immutable JSON payloads
  (`webapp/persistence`) — nothing in Lane B rewrites history. Verified against the
  actual webapp read paths (`workspace_view.py:207,241-242,280,367,371`,
  `application_pack.py:130,252-253,289-290`): every existing consumer already reads
  `cv_content`/`cover_letter_content` defensively via `.get(...)`, and **none reads
  `cv_emphasis_plan`, `cover_letter_plan`, `plan_issues`, or `requirement_coverage`
  today**. So no new `schema_version`-branching code is required for these
  read paths to keep working against a v0 artifact — the new fields are simply
  absent on a v0 payload, `.get(field, [])`/`.get(field, {})` on an absent key
  already degrades correctly, and nothing currently treats their absence as an
  error. If a *future* Lane B follow-up adds a webapp view that surfaces
  `requirement_coverage` or the typed plans to the user, that view is the one that
  must branch on `schema_version` (or default-render "not available" for a v0
  artifact) — not existing code, which needs no change for this reason.

### 4. Generation-contract staleness

The bigger finding: Lane B changes the prompt, the template/connective repertoire,
and the provider's proposal schema — all of which affect what a **freshly
generated** Application Intelligence result would look like — but none of that
machinery is currently fingerprinted. Checked against the actual staleness
mechanism (`webapp/services/staleness.py`, `webapp/services/input_identity.py`):
`DEPENDENCY_TYPES["application_intelligence_request"]` today lists
`("profile_snapshot", "job_fit_result", "server:application_intelligence_policy")`
— `server:application_intelligence_policy` fingerprints only the *recommendation*
policy JSON (`application_intelligence_policy.v0.json`), which is a different
artifact from the generation machinery entirely. Without a new dependency, an
Application Intelligence artifact generated under the pre-Lane-B renderer/prompt
would remain `check_staleness(...) == {"stale": False}` after Lane B ships, which
is wrong — the inputs it was computed from are unchanged, but the deterministic
*function* that computes from them changed.

Add a new mutable server input, following the exact existing pattern in
`input_identity.py` (a pure function returning a `content_identity(prefix, value)`
hash of a JSON-serializable value — never a hash of a Python function object,
never a source-file mtime):

```python
def application_intelligence_generation_contract_identity() -> str:
    """Deterministic identity for everything that changes what
    analyze_application_intelligence + the OpenAI provider would produce from the
    same request, independent of the request's own content. Explicit and versioned
    -- not derived from hashing code or files."""
    return content_identity("aiintelgencontract_", {
        "prompt_version": "application-intelligence.v0",       # bump the string
                                                                 # when the prompt
                                                                 # text changes
        "proposal_schema_version": "application_intelligence_atom_proposal_v1",
        "result_schema_version": RESULT_VERSION,                # "application-intelligence-result.v1"
        "template_table_keys": sorted(f"{k[0]}:{k[1]}" for k in TEMPLATE_TABLE),
        "connective_allowlist": sorted(CONNECTIVE_ALLOWLIST),
    })
```

Wired in exactly like the existing `server:*` dependencies:

- `DEPENDENCY_TYPES["application_intelligence_request"]` gains
  `"server:application_intelligence_generation_contract"`.
- `run_application_intelligence` (`webapp/services/pipeline.py`) calls
  `record_dependency_fingerprint(..., upstream_artifact_type=
  "server:application_intelligence_generation_contract", upstream_content_id=
  application_intelligence_generation_contract_identity())` alongside the existing
  fingerprint calls, at request-build time.
- `_server_input_identity` (`staleness.py`) gains the matching branch:
  `if input_type == "server:application_intelligence_generation_contract": return
  application_intelligence_generation_contract_identity()`.

Effect: any Lane B change that alters the prompt text, the proposal schema version,
the result schema version, the template table's key set, or the connective
allowlist changes this identity's hash, which makes every existing
`application_intelligence_request`/`_result` artifact stale under
`check_staleness`, surfacing as "needs rerun" in the workspace UI — without
rewriting any stored artifact. A request/result computed *after* Lane B ships
records the new identity and stays current until the next generation-contract
change. `prompt_version` is a literal version string bumped by hand alongside the
prompt file (not a hash of the prompt file's bytes) so that unrelated
whitespace/comment edits to the prompt don't spuriously invalidate every artifact —
the version string is the explicit, human-controlled point of "this materially
changed."

**Regression tests pin this identity function directly:** a test asserts
`application_intelligence_generation_contract_identity()` returns a *specific known
hash* for the current Lane B template table / connective allowlist / version
strings (a golden-value test, same idea as Component 8's golden snapshots) — so
that any future accidental change to the template table or allowlist is caught by
a hash mismatch, forcing a deliberate decision about whether that change should
also bump `prompt_version`/schema versions, rather than silently shipping a
generation change with no staleness signal.

### 5. Template repertoire — fill gaps in existing categories only

Scope, per your ruling: **broaden expression of existing evidence; do not broaden
what counts as evidence or introduce multi-atom synthesis.** Every new template
keeps the existing pattern — specific eligibility predicate over the *cited*
claims → bounded rendering → existing evidence/conflict validation. `education`,
`publication`, and `award` are already-recognized `assertion_type`s (present in
`_ASSERTION_TYPE_SHAPES`) that currently have **no template registered at all** —
filling those in is in scope as "existing category, missing variant," not "new
assertion type."

Confirmed gaps to fill. Eligibility predicates below are pinned against the
**actual** claim shapes `product/profile_snapshot.py` extracts today (verified,
not sketched): `education` records are multi-field (`qualification`,
`date_range`, `institution` sharing one `record_id` — see
`_parse_markdown_source`'s `"Education"` branch), but `publication`, `award`, and
`certification` are each extracted as a **single claim, single field, no linked
date/issuer claim on the same `record_id`** (`_add_publication_claim`,
`_add_award_claim`, and the `"Certifications"` markdown branch each call
`builder.add_claim` exactly once per bullet line, with no companion claim). There
is therefore no structural evidence anywhere in the extraction pipeline to build a
`certification` `AS_CAPABILITY_STATEMENT` (or any) variant beyond `PLAIN` — that
line item from the earlier draft of this table is **removed**, not deferred; it
would have been a template with no claim shape it could ever legitimately render
against evidence-preserving grounds. `employment` variants remain in scope since
`employment` records are already multi-field today (`job_title`/`employer`/
`date_range`/`responsibility_or_achievement` on one `record_id`, per
`_has_employment_linkage`/`_is_explicit_duration`/`_is_explicit_hands_on`, already
proven eligibility helpers).

| assertion_type | rendering_variant | eligibility predicate (verified against actual claim shape) | format |
|---|---|---|---|
| `education` | `PLAIN` | claim present (any of qualification/institution/date_range) | `{value}` |
| `publication` | `PLAIN` | claim present | `{value}` |
| `award` | `PLAIN` | claim present | `{value}` |
| `employment` | `AS_CAPABILITY_STATEMENT` | claim is `job_title` or `employer` with a linked `responsibility_or_achievement` claim on the same `record_id` (reuses `_has_employment_linkage`) | `"Experience as {value}"` |
| `employment` | `AS_STRENGTH` | claim linked to an explicit `date_range` **and** at least one `responsibility_or_achievement` on the same `record_id` (reuses `_is_explicit_duration` + `_is_explicit_hands_on`) | `"Sustained, hands-on experience as {value}"` |

`certification` stays at `PLAIN` only in this iteration — no gap to fill there,
since no eligibility-worthy structural variant exists given the current
single-claim extraction. (A future iteration could extend
`product/profile_snapshot.py`'s certification extraction to capture a linked date
or issuing-body claim, which would then make an `AS_CAPABILITY_STATEMENT` variant
legitimately buildable — out of scope here, since Lane B does not touch evidence
extraction.)

Each new `(assertion_type, rendering_variant)` entry gets:
- a positive regression case (correct evidence shape → renders as expected), and
- at least one negative regression case (evidence missing the required structural
  linkage → template ineligible, atom falls to `UNSUPPORTED`/`PLAIN` fallback or is
  rejected, per existing behavior for the analogous `technical_skill` cases).

Explicitly deferred (not in this iteration): any `cv_summary_line` or unit type
that synthesizes prose from 2+ atoms into one combined sentence. That requires new
deterministic rules for preserving the strength *and relationship* of multiple
constituent claims simultaneously — a distinct design problem, called out for a
future iteration, not slipped in here.

### 6. Connective allowlist — conservative expansion

Add exactly two entries to `CONNECTIVE_ALLOWLIST`:

- `"which included"` — restrictive/appositive, asserts nothing beyond "the
  preceding item included the following," safe between an employment/role atom and
  a responsibility atom on the same record.
- `"specifically"` — narrows scope without asserting a new relationship (temporal,
  causal, or developmental) between the two atoms it joins.

**Not adding** `"building on"` (or similar developmental/causal connectives): it
asserts a temporal or causal relationship between two claims — "X, building on
Y" — that the evidence model has no structural way to verify holds between the
*specific* cited claims. This mirrors the exact defect class the eligibility-
predicate rendering design was built to close: a connective must preserve not only
each claim's strength but the *relationship* between claims, and no current claim
field encodes claim-to-claim temporal/causal ordering. Revisit only if/when the
evidence model gains a structural way to express such a relationship.

### 7. Prompt rewrite (`product/prompts/application-intelligence.v0.txt`)

Update to:
- Explain the new `coverage` field in the hosted input and instruct the provider
  to prioritize atoms/units that address `uncovered` requirement ids, without
  ever fabricating evidence to do so.
- Explain the typed `cv_emphasis_plan`/`cover_letter_plan` entries and their closed
  `rationale_kind` vocabulary; instruct the provider to plan toward coverage and
  a coherent CV/cover-letter structure (e.g. lead with direct matches, use
  transferable/functional matches to fill gaps, keep the cover letter's paragraph
  order matching the plan) rather than emitting an unordered bag of valid atoms.
- Reference the newly available templates/connectives so the provider knows the
  expanded repertoire exists.
- Preserve, verbatim in spirit, all existing hard constraints: no free text, no
  padding, no invented facts, return partial output rather than force the
  threshold, never weaken evidence selection to hit a word count.

### 8. Deterministic scenario suite + human-readable snapshots

New fixture family: `tests/fixtures/application_intelligence/scenarios/`. Five
named scenarios, each a complete, valid request (`profile_snapshot` +
`job_fit_result` + `resolved_job_evidence`) plus a **canned proposal fixture**
(no live LLM call in tests — the suite is deterministic):

1. **strong_evidence** — multiple direct matches, rich profile claims, plenty of
   eligible templates. Expect: high coverage, contract cleared, several distinct
   qualifying units.
2. **sparse_evidence** — one or two thin profile claims, few matches. Expect:
   contract may legitimately stay INCOMPLETE; assert it is INCOMPLETE *for the
   right reason* (not enough evidence), never that the suite forces it to pass.
3. **transferable_only** — no direct/functional matches, only `transferable_matches`
   with `limitations`/`conditions`. Expect: transferability atoms render, coverage
   counts transferable-covered requirements distinctly from direct-covered ones.
4. **gaps** — profile evidence present but Ticket 7 recorded real `gaps`. Expect:
   `positioning.material_gaps` carries the gap text verbatim; requirement coverage
   correctly excludes gapped requirement ids from `covered`.
5. **conflicting_evidence** — profile snapshot includes a `conflicts` entry over
   some claim(s) (reusing `profile_snapshot.py`'s existing conflict mechanism).
   Expect: any atom citing a conflicted claim is rejected (`_render_candidate_fact_atom`
   already checks `concept_id in conflicted_concepts`); this scenario proves Lane B's
   new templates/coverage logic do not create a bypass around that existing check.

**Assertions per scenario (deterministic, no LLM judge):**
- Substantive-completion status (READY/INCOMPLETE at the Application-Intelligence
  layer, see below) matches the scenario's expectation, and the *reason* is the
  right one (e.g. sparse fails on word count, not unit count).
- Every evidence id cited in accepted output is valid and unconflicted.
- `requirement_coverage.covered` only contains requirement ids actually backed by
  an accepted rendered unit (re-derive independently in the test, don't just trust
  the field — assert the field against a from-scratch recomputation).
- No template over-claims: for each accepted unit, the claims it cites structurally
  satisfy the template's documented eligibility predicate (spot-checked, not just
  "it rendered").
- `plan_issues` is populated (not silently dropped) when a fixture deliberately
  includes a malformed plan entry, and `unsupported_claims` is NOT used for that
  case.

**On Issue #15's actual `READY` contract:** `application_material_completion`
(webapp layer) requires an explicit `review_record.decisions_consulted` entry with
`disposition == "acknowledged_and_proceed"` per `unit_id` — state Application
Intelligence alone cannot produce, since it lives in the webapp review workflow,
not in `product/`. The scenario suite therefore asserts at the correct layer:

- At the **Application Intelligence layer** (`product/`), assertions are phrased
  as "produces sufficient qualifying material to meet the v1 thresholds once
  reviewed" — i.e. run the *same* unit/word-count logic
  (`MIN_CV_UNITS`/`MIN_CV_WORDS`/etc. from `application_material_contract.py`)
  directly against `cv_content`/`cover_letter_content`, without requiring
  acknowledgment, since acknowledgment isn't this layer's concern.
- One **integration-level test** (`tests/webapp/` or a new
  `tests/test_lane_b_scenarios_integration.py`) takes the `strong_evidence`
  scenario's output, synthesizes a `review_record` that acknowledges every
  qualifying unit (mirroring the shape `_acknowledged_content_unit_ids` expects),
  and asserts `application_material_is_completion_ready(...)` returns `True` end
  to end — proving the full chain actually reaches Issue #15's real `READY`, not
  just a look-alike at the wrong layer.
- **Distinct-evidence-id anti-duplication** (no two accepted units rendering the
  same evidence redundantly to pad word count) is a **fixture/scenario-level**
  expectation asserted in the suite, not a new field in
  `application_material_contract.py` and not a new production completion rule.
  Issue #15's contract is not changed by Lane B.

**Golden snapshots — static in CI, explicit refresh only.** Each scenario's
rendered CV/cover-letter text is written to a checked-in golden file (e.g.
`tests/fixtures/application_intelligence/scenarios/<name>/expected_render.json`).
Normal `pytest` runs **compare against** the golden file and fail on mismatch —
they never rewrite it. Refreshing goldens is an explicit, separate action (e.g.
`python -m tests.fixtures.application_intelligence.update_snapshots` or a
`--update-snapshots` pytest flag gating a write path), run deliberately when a
change is understood and intended, mirroring how `generate_fixtures.py` already
works as a standalone script rather than test-time generation.

## Non-goals (explicit)

- No LLM quality judge anywhere in the validation or CI path.
- No relaxation of evidence validation, conflict checks, or the eligibility-
  predicate rendering model.
- No change to Issue #15's `application_material_contract.py` thresholds or
  semantics.
- No multi-atom prose synthesis (deferred).
- No dependency on User Profile v1.
- No same-version ("invisible") contract change — the result and proposal
  contracts are explicitly versioned (v0 → v1), and generation-affecting changes
  are explicitly fingerprinted for staleness, never left implicit.
- `plan_issues` never gains authority over acceptance, evidence validation, or the
  Issue #15 completion predicate — diagnostics only.

## Files touched (expected)

- `product/application_intelligence.py` — typed plan validation, `plan_issues`,
  `_compute_requirement_coverage`, new template table entries, `RESULT_VERSION`
  bump. Exports `TEMPLATE_TABLE`/`CONNECTIVE_ALLOWLIST`/`RESULT_VERSION` (already
  module-level) for `input_identity.py` to import.
- `product/schemas/application-intelligence-contract.v1.schema.json` — **new
  file** (v0 file retained, unmodified, per the `job-fit-contract.v0/v1` precedent)
  defining the v1 `resultVersion` const and required shape: typed
  `cv_emphasis_plan`/`cover_letter_plan`, `plan_issues`, `requirement_coverage`.
- `product/openai_application_intelligence_provider.py` — hosted input gains
  `coverage`, typed plan schema in the strict OpenAI response schema (schema name
  bumped to `application_intelligence_atom_proposal_v1`), new connectives/templates
  surfaced.
- `product/prompts/application-intelligence.v0.txt` — rewrite per Component 7;
  the prompt file's own name/`prompt_version` string is the human-controlled
  version marker consumed by Component 4's identity function.
- `webapp/services/input_identity.py` —
  `application_intelligence_generation_contract_identity()`.
- `webapp/services/staleness.py` — `DEPENDENCY_TYPES["application_intelligence_request"]`
  gains `"server:application_intelligence_generation_contract"`;
  `_server_input_identity` gains the matching branch.
- `webapp/services/pipeline.py` — `run_application_intelligence` records the new
  fingerprint.
- No changes needed to existing webapp read paths (`workspace_view.py`,
  `application_pack.py`) — verified they only ever read `cv_content`/
  `cover_letter_content` via `.get(...)`, never the new fields, so v0 artifacts
  keep rendering correctly with zero new branching code.
- `tests/test_application_intelligence.py` — unit coverage for new templates,
  connectives, plan validation, coverage computation, v0/v1 result-shape handling.
- `tests/webapp/services/test_staleness.py` — coverage for the new generation-
  contract dependency, including a fixture proving a pre-Lane-B artifact becomes
  stale post-Lane-B without being rewritten.
- `tests/fixtures/application_intelligence/scenarios/**` — new fixture family +
  golden snapshots + update-snapshots tooling.
- New integration test proving the full chain reaches Issue #15's real `READY`.

## Design history

- Round 1 (initial proposal): established the six-component shape (typed plans,
  coverage, template gap-fill, connectives, prompt, eval suite) and proposed
  sequencing Lane B after User Profile v1.
- Round 2 corrected: (1) removed the User Profile v1 dependency — Lane B starts
  now; (2) tightened coverage to require an *accepted rendered unit*, not a raw
  proposed atom; (3) split malformed-plan diagnostics (`plan_issues`) from
  `unsupported_claims`, which is reserved for candidate-content rejection;
  (4) dropped `"building on"` from the connective allowlist as asserting an
  unverifiable relationship between claims; (5) fixed the eval harness to assert
  Application-Intelligence-layer sufficiency correctly (not a false `READY` claim
  at the wrong layer), moved distinct-evidence-id anti-duplication to
  fixture-level-only (not a new production rule), and made golden snapshots
  static-with-explicit-refresh rather than CI-rewritten.
- Round 3 (this round) corrected, against the actual `40ac81a` baseline code:
  (1) made the result contract (`application-intelligence-result.v0` →
  `.v1`) and the OpenAI provider's strict proposal schema
  (`application_intelligence_atom_proposal_v0` → `_v1`) explicitly versioned
  additions rather than treating them as invisible v0 details — the current
  validator's exact-shape check and the current proposal schema's
  `additionalProperties: false` make this a hard requirement, not a style
  preference — plus a documented rule for historical v0 artifacts (immutable,
  viewable, never silently reinterpreted as v1); (2) added generation-contract
  staleness (`server:application_intelligence_generation_contract`, wired through
  `input_identity.py`/`staleness.py`/`pipeline.py` following the exact existing
  `server:*` fingerprint pattern) so a prompt/template/connective/schema change
  correctly marks existing artifacts stale without rewriting them, with a pinned
  golden-hash regression test guarding the identity function itself; (3) made
  explicit that `plan_issues` is diagnostic only — never invalidates an otherwise
  evidence-valid unit, never becomes an `unsupported_claims` entry, never
  independently alters the Issue #15 completion predicate.
