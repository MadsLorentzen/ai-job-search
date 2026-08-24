# Application Pack v1 Contract Enrichment — Implementation Plan

**Goal:** Confirm new immutable `application-pack.v1` artifacts that embed a
fully provenance-validated candidate presentation snapshot, preserve v0 output
byte-for-byte, and render complete structured CVs without any live upstream read.

**Frozen product baseline:** `a7faadd`
**Authoritative design:**
`docs/superpowers/specs/2026-08-24-application-pack-v1-contract-design.md` at
`a557e5b`
**Scope:** Implementation only after this plan is reviewed. This planning branch
must not change production code.

---

## 0. Verified repository seams and invariants

The implementation starts from these inspected facts at `a7faadd`.

### Pack construction and persistence

- `webapp/services/application_pack.py::build_application_pack` reads the exact
  current Profile Snapshot, Job Posting, Job Fit, and Application Intelligence
  artifacts, selects review-authorized units, and currently emits
  `application-pack.v0`.
- `confirm_application_pack` holds `BEGIN IMMEDIATE` across construction,
  `save_artifact`, dependency fingerprints, and the drafted workflow event.
- `webapp/persistence/artifacts.py` stores arbitrary JSON in `payload_json`; no
  migration or persistence redesign is required.

### Review-decision history semantics

- Review history is append-only in `review_decisions`.
- `list_review_decisions(conn, workspace_id, source_artifact_id)` scopes to one
  exact source artifact and orders by `created_at DESC`.
- `_decision_index` iterates that newest-first list and uses `setdefault` for
  `(review_item_type, domain_item_id)`. Therefore the newest decision for the
  exact source artifact is the effective decision; older contradictory history
  remains stored but is not consulted by pack construction.
- The query has no secondary ordering for identical `created_at` values. This
  plan uses deliberately distinct timestamps to characterize the established
  newest-effective behavior; it does not define tie semantics or add a tie-break
  rule. If implementation exposes a real equal-timestamp ambiguity, stop for a
  separate review-model decision instead of folding one into this ticket.
- This ticket must preserve that model. It must not update old decisions, add a
  current-decision table, or invent a new tie-break rule.
- A valid v1 pack embeds only the one effective consulted decision for each
  rendered AI unit. The validator rejects zero, duplicate, or contradictory
  matching consulted entries. Render-time validation does not query or
  reinterpret database history.

### Rendering

- `product/application_pack_renderer.py` is pure with respect to persistence: it
  receives one exact pack payload plus `source_pack_id`.
- `webapp/services/http_api.py::render_job_application_pack_document` performs
  owner-scoped current/historical pack lookup and then passes only that payload
  to the renderer.
- `product/application_pack_renderer.py` must not import profile, fit,
  intelligence, review, provider, persistence, or webapp modules.

### Render-time provenance limit

The canonical validator has two modes, but one implementation:

```text
construction: pack + exact source_profile_artifact
    -> structural + review + full profile referential validation

render: pack only
    -> structural + review validation
    -> no independent proof against a historical Profile Snapshot
```

Render-time validation can prove the pack is internally well-shaped and that
every rendered AI unit has one exact embedded authorization. It cannot prove an
embedded candidate value matched a historical Profile Snapshot claim, because
the source artifact is intentionally not fetched or embedded in full. That proof
is performed before persistence at construction time. Implementation comments
and tests must state this limit explicitly; no test may imply render-time
cryptographic re-verification of Profile provenance.

### Protected boundaries

Do not change:

- Job Fit scoring, verdict, evidence, or ranking semantics;
- Application Intelligence generation or review semantics;
- `check_staleness` or dependency types;
- substantive-completion thresholds or Gate 4 workflow transitions;
- Profile Snapshot parsing, conflict detection, or source-priority behavior;
- account ownership or route authorization;
- submission behavior;
- database schema or migrations.

If implementation appears to require any of those changes, stop and report the
blocker before modifying them.

---

## Task 1: Create an isolated implementation worktree and establish the baseline

**Files changed:** none.

1. Create a fresh worktree and branch whose production baseline is exactly
   `a7faadd`. Do not branch from a moving symbolic `master`.

   ```powershell
   git worktree add -b feature/application-pack-v1-contract `
     "C:\Users\smbab\OneDrive\Documents\Projects\ai-job-search-pack-v1" a7faadd
   ```

2. Bring the reviewed specification and implementation plan onto the new branch
   before production work. Cherry-pick the complete documentation-only range in
   its existing order:

   ```powershell
   $packV1DocCommits = @(
     git rev-list --reverse a7faadd..design/application-pack-v1-contract
   )
   foreach ($packV1DocCommit in $packV1DocCommits) {
     git cherry-pick $packV1DocCommit
   }
   ```

   Confirm that this range changes only the two reviewed files under
   `docs/superpowers/`. Do not squash or recreate them. This makes the approved
   contract auditable from the implementation branch even if the design
   worktree is later removed.
3. Confirm the implementation worktree is clean and that `a7faadd` remains its
   merge base. All production-diff checks stay anchored to `a7faadd`; the
   documentation commits do not change the frozen product baseline.
4. Install Chromium unconditionally:

   ```powershell
   python -m playwright install chromium
   ```

5. Run the accepted baseline suite before changing files:

   ```powershell
   python -m pytest tests/ -v
   ```

   Expected baseline: `1049 passed, 1 skipped`, including 14 Chromium journeys.
   If the baseline differs, investigate before implementation.

No commit for this task.

---

## Task 2: Materialize and lock the v0 renderer baseline before dispatch changes

**Files:**

- Create: `tests/fixtures/application_pack/v0_renderer_baseline.json`
- Modify: `tests/test_application_pack_renderer.py`

### Test first

1. Materialize the exact JSON payload returned by
   `tests/test_application_pack_renderer.py::_pack()` at `a7faadd`. Do not improve,
   normalize, or regenerate its wording after renderer changes.
2. Add a test loading only that frozen JSON fixture and rendering it with
   `source_pack_id="art_v0_baseline"`.
3. Assert exact legacy metadata, filenames, byte lengths, and hashes:

   - renderer version: `application-pack-renderer.v1`
   - CV length: `36_857`
   - CV hash:
     `sha256:91c3ca63b2d9d16bb1d2e9ef0d40a7825e92874b6521b0824bf52b88dd6e541d`
   - cover-letter length: `36_713`
   - cover-letter hash:
     `sha256:2f9f45802ac9e983afd6a8af0858f5e9ab3dda58c7e96a7ccf207678e82c3159`

Run:

```powershell
python -m pytest tests/test_application_pack_renderer.py -k "v0_baseline" -v
```

Expected: PASS against unmodified production code. This is a characterization
lock, so a failing expectation is corrected against `a7faadd`, never against a
later renderer.

Run the full existing renderer suite, then commit:

```powershell
git add tests/fixtures/application_pack/v0_renderer_baseline.json `
  tests/test_application_pack_renderer.py
git commit -m "test: lock application pack v0 renderer bytes"
```

---

## Task 3: Add pure candidate-snapshot construction

**Files:**

- Create: `product/application_pack_contract.py`
- Create: `tests/test_application_pack_contract.py`

**Public interfaces introduced:**

```python
APPLICATION_PACK_V0 = "application-pack.v0"
APPLICATION_PACK_V1 = "application-pack.v1"
SUPPORTED_PROFILE_SCHEMA_VERSIONS = frozenset({
    "candidate-profile-evidence-snapshot.v0",
})

class ApplicationPackContractError(ValueError): ...

def build_candidate_snapshot(source_profile_artifact: dict[str, Any]) -> dict[str, Any]: ...
```

The module is standard-library-only. It must not import
`product.profile_snapshot`; otherwise the renderer’s later import of the
canonical validator would transitively import the live Profile Snapshot module.
The webapp construction service remains responsible for calling the existing
Profile Snapshot validator before this pure transformation.

### Failing tests

Add focused fixtures with valid artifact wrappers and Profile Snapshot v0 claim
shapes. Cover:

1. copied `profile_schema_version` and all closed candidate categories;
2. identity/contact mapping, including nullable missing contact methods;
3. employment grouping and field mapping, especially
   `responsibility_or_achievement -> details`;
4. education, certifications, skills, languages, projects, publications, awards;
5. placeholder and conflicted concepts excluded;
6. unsupported Profile Snapshot version rejected;
7. multiple name claims with the same normalized value collapse successfully;
8. distinct normalized safe names fail;
9. equivalent values choose the exact literal from earliest
   `(source.file, source.line_start, claim.id)` and retain every sorted claim ID;
10. distinct normalized values in one concept fail rather than selecting a
    source winner;
11. deterministic record/detail order;
12. sparse optional records remain representable with nulls/empty lists.

The v0 normalization helper inside the contract module must exactly implement
the inspected Profile Snapshot v0 rules: NFC, en/em dash to ASCII hyphen,
Unicode-whitespace collapse, trim, casefold, recursively normalized dictionaries
and lists, and canonical JSON serialization. Pin these semantics directly in
tests; do not import the private `_normalized_json` helper.

Run failing tests, implement the smallest pure transformation, then run:

```powershell
python -m pytest tests/test_application_pack_contract.py -k "candidate_snapshot" -v
```

Commit:

```powershell
git add product/application_pack_contract.py tests/test_application_pack_contract.py
git commit -m "feat: build deterministic candidate presentation snapshots"
```

---

## Task 4: Add the one canonical v1 validator

**Files:**

- Modify: `product/application_pack_contract.py`
- Modify: `tests/test_application_pack_contract.py`
- Create: `tests/fixtures/application_pack/v1_valid.json`

**Interface:**

```python
def validate_application_pack_v1(
    pack: dict[str, Any],
    *,
    source_profile_artifact: dict[str, Any] | None = None,
) -> None: ...
```

Create a complete frozen v1 fixture containing valid candidate data, exact source
artifact refs, reviewed AI units, and exact consulted review rows. The fixture is
test-only and must satisfy the reviewed design; production never imports it.

### Structural tests, run in both modes

Parameterize calls with and without `source_profile_artifact` where applicable.
Require failures for:

- wrong/unknown schema version;
- missing or unexpected top-level/candidate keys;
- unsupported `profile_schema_version`;
- absent/null/invalid candidate name;
- malformed provenanced values;
- empty, duplicate, unsorted, or non-string evidence IDs;
- malformed record scalar/list/null types;
- unexpected candidate categories;
- malformed source-artifact refs.

### Review-authorization cardinality tests

For every `cv_summary_line`, `cv_bullet`, and `cover_letter_paragraph` in the
pack, require exactly one consulted decision with:

- `review_item_type == "content_unit"`;
- `domain_item_id == unit_id`;
- `source_artifact_id` equal to
  `source_artifacts.application_intelligence_result.artifact_id`;
- `disposition == "acknowledged_and_proceed"`.

Add independent failures for:

1. no matching decision;
2. decision for a superseded Intelligence artifact;
3. matching omitted/blocking decision;
4. two acknowledged matches;
5. acknowledged plus contradictory matching decision;
6. duplicated unit IDs across or within rendered collections.

This validator checks the effective set embedded in the immutable pack. It does
not query historical decisions and does not change `_decision_index` semantics.

### Construction-only source checks

With `source_profile_artifact` supplied, the validator must first compute:

```python
expected_candidate_snapshot = build_candidate_snapshot(source_profile_artifact)
```

and require exact structural equality:

```python
pack["candidate_snapshot"] == expected_candidate_snapshot
```

This is the construction-mode completeness invariant. It proves that every safe
in-scope value was copied, every unsafe value was excluded, deterministic
literal selection and ordering were preserved, all corroborating IDs were
retained, sparse fields use the specified null/empty representation, and no
field was invented. Do not implement a second extraction algorithm inside the
validator.

Keep focused failures for:

- artifact ID/type/content ID mismatch;
- copied profile schema mismatch;
- unknown evidence ID;
- placeholder/conflicted evidence ID;
- literal value not equal to the deterministic selected source claim;
- missing corroborating claim ID.

Also require independent failures when an otherwise valid candidate snapshot:

- omits a safe record;
- omits a safe field from an included record;
- adds a fabricated record/value; or
- reorders deterministic record or detail output.

Each must pass render-mode structural validation when it remains structurally
well-formed, then fail construction mode against the exact source artifact. That
contrast documents why render mode cannot prove completeness without a forbidden
Profile read.

### Explicit render-time provenance-limit test

Add a test with a structurally valid pack whose candidate evidence IDs are
well-shaped but no source artifact is supplied. The validator may pass because it
cannot prove claim existence without violating the no-upstream-read boundary.
Name and comment the test explicitly, for example:

```python
def test_render_mode_is_structural_not_profile_referential_validation(): ...
```

The same pack must fail when a mismatching `source_profile_artifact` is supplied.
This test documents an intentional trust boundary, not a gap to “fix” with a
renderer database lookup.

Run:

```powershell
python -m pytest tests/test_application_pack_contract.py -v
```

Commit:

```powershell
git add product/application_pack_contract.py `
  tests/test_application_pack_contract.py `
  tests/fixtures/application_pack/v1_valid.json
git commit -m "feat: validate immutable application pack v1 contracts"
```

---

## Task 5: Introduce version dispatch while preserving the v0 branch exactly

**Files:**

- Modify: `product/application_pack_renderer.py`
- Modify: `tests/test_application_pack_renderer.py`

Refactor existing code mechanically into explicit v0 helpers before adding v1
layout logic:

```python
def _render_cv_document_v0(pack): ...       # existing body unchanged
def _render_cover_letter_document_v0(pack): ...

def render_cv_document(pack):               # exact schema dispatch
def render_cover_letter_document(pack):
def render_application_pack(pack, *, source_pack_id):
```

Rules:

- exact `application-pack.v0` dispatches only to the legacy body;
- unknown or absent versions raise `RendererError`;
- v0 keeps `application-pack-renderer.v1` metadata;
- no candidate or upstream fallback is added;
- no renderer import from profile/webapp/persistence/provider modules.

The renderer's public exception boundary remains `RendererError`:

- absent or unknown versions raise
  `RendererError("unsupported application pack schema version")` exactly;
- v1 validation failures are caught at the renderer boundary and re-raised as
  `RendererError("invalid application pack v1 payload")`, chaining the original
  `ApplicationPackContractError` with `raise ... from exc`;
- validation details, candidate values, evidence IDs, and payload fragments must
  not be interpolated into the public message.

Add tests for absent/unknown versions here. Task 6 adds malformed and
review-unauthorized v1 cases and verifies both the stable public message and the
chained internal cause. The existing HTTP service already translates
`RendererError` to `PipelineError`; preserve that clean public route behavior.

At this task’s boundary, a valid v1 may raise a clean “v1 renderer not yet
available” error; pack construction still emits v0, so the application remains
coherent between commits.

Run:

```powershell
python -m pytest tests/test_application_pack_renderer.py -v
```

The frozen lengths/hashes from Task 2 must still match exactly. Commit:

```powershell
git add product/application_pack_renderer.py tests/test_application_pack_renderer.py
git commit -m "refactor: add explicit application pack renderer version dispatch"
```

---

## Task 6: Implement deterministic v1 CV and cover-letter rendering

**Files:**

- Modify: `product/application_pack_renderer.py`
- Modify: `tests/test_application_pack_renderer.py`

The v1 renderer calls `validate_application_pack_v1(pack)` first. That call is
render-mode structural/review validation only; add a nearby code comment stating
that full Profile provenance was checked before persistence and cannot be
re-proven here without a forbidden upstream read.

### Failing v1 renderer tests

Using the frozen valid v1 fixture, require:

1. candidate name and available contact values render; internal evidence IDs do
   not;
2. fixed CV section order from the spec;
3. employment headers render available role/employer/date/location fields;
4. `employment.details` render verbatim under their exact Profile-owned record;
5. reviewed AI bullets render only under separate `Tailored Highlights`;
6. AI bullets are never attributed to an employer;
7. structured education and certifications render;
8. skills, languages, projects, publications, and awards render when present and
   omit cleanly when absent;
9. cover letter renders candidate header, job subject, and reviewed paragraphs,
   but no invented recipient/salutation/closing/signature;
10. malformed or review-ambiguous v1 packs fail before document creation;
11. repeated v1 rendering is byte-identical across a real wall-clock gap;
12. v1 reports `application-pack-renderer.v2`;
13. malformed and review-unauthorized v1 packs surface the stable
    `RendererError("invalid application pack v1 payload")`, with an
    `ApplicationPackContractError` as `__cause__` and no payload data in the
    public message;
14. renderer source/import guard remains free of upstream modules.

Run focused v1 tests and then the complete renderer suite:

```powershell
python -m pytest tests/test_application_pack_renderer.py -k "v1" -v
python -m pytest tests/test_application_pack_renderer.py -v
```

The v0 lock must remain exact. Commit:

```powershell
git add product/application_pack_renderer.py tests/test_application_pack_renderer.py
git commit -m "feat: render self-contained application pack v1 documents"
```

---

## Task 7: Emit and validate v1 during pack construction and confirmation

**Files:**

- Modify: `webapp/services/application_pack.py`
- Modify: `tests/webapp/services/test_application_pack.py`

### Preserve effective-decision semantics first

Add tests with explicitly distinct mocked `created_at` values proving:

1. acknowledged then newer omitted -> unit is omitted and only the newer
   effective decision is consulted for that unit;
2. omitted then newer acknowledged -> unit is included and only the newer
   effective acknowledged decision is consulted;
3. a decision for a superseded Intelligence artifact never authorizes the unit.

Do not change `review.py`, `_decision_index`, or decision history storage. These
tests pin the existing model before v1 validation adds cardinality enforcement.
They also prove that the one authorization embedded for an included unit is the
effective newest decision for that exact unit and source artifact. Older
contradictory history may remain in the database, but it is not embedded as a
second effective authorization. An equal-timestamp tie is not assigned new
meaning by this ticket.

### Make service fixtures valid

The current `_seed` helper uses a deliberately skeletal profile payload. Replace
its default with the smallest valid `candidate-profile-evidence-snapshot.v0`
fixture containing a safe name and any claims required by the test units. Do not
weaken production validation to accommodate invalid tests.

### Assemble v1

Refactor internally without changing the public return type:

```python
def _build_application_pack_with_profile(...) -> tuple[dict, dict]:
    # returns (pack, exact_profile_artifact)

def build_application_pack(...) -> dict:
    pack, _ = _build_application_pack_with_profile(...)
    return pack
```

Inside the internal builder:

1. call the existing `validate_snapshot(profile_artifact["payload"])`;
2. build `candidate_snapshot` from that exact artifact;
3. preserve all v0 fields and review selection;
4. emit `schema_version: "application-pack.v1"`;
5. call `validate_application_pack_v1(pack,
   source_profile_artifact=profile_artifact)` before returning.

`confirm_application_pack` uses the internal tuple and calls the same validator
again immediately before `save_artifact`, still inside `BEGIN IMMEDIATE`. This is
the authoritative pre-persistence provenance check.

### Service tests

Require:

- exact candidate snapshot and source-profile ref in a newly built v1 pack,
  explicitly asserting
  `pack["candidate_snapshot"] == build_candidate_snapshot(profile_artifact)`;
- every candidate value traces to the exact source artifact;
- changed live profile after confirmation does not mutate persisted pack JSON;
- unsupported profile version fails before persistence;
- validator failure rolls back pack, current pointer, fingerprints, and workflow
  event atomically;
- sparse candidate sections do not change completion status;
- completion thresholds and existing review/gate tests remain unchanged;
- `review_record.decisions_consulted` contains exactly one effective authorization
  per included AI unit.

Run:

```powershell
python -m pytest tests/webapp/services/test_application_pack.py -v
python -m pytest tests/webapp/test_application_material.py `
  tests/webapp/persistence/test_workflow.py -v
```

Commit:

```powershell
git add webapp/services/application_pack.py `
  tests/webapp/services/test_application_pack.py
git commit -m "feat: confirm provenance-complete application pack v1 artifacts"
```

---

## Task 8: Make the legacy archive projection version-aware

**Files:**

- Create: `tests/fixtures/application_pack/v0_archive_projection_baseline.md`
- Modify: `webapp/services/archive_projection.py`
- Modify: `tests/webapp/services/test_archive_projection.py`

### Phase A: freeze v0 before changing production

At `a7faadd`, pass the exact frozen v0 fixture from Task 2 to
`_render_markdown` with
`projection_id="art_v0_projection_baseline"`. Materialize the returned text
unchanged as `v0_archive_projection_baseline.md` and add a characterization
test that pins its UTF-8 bytes:

- byte length: `752`;
- SHA-256:
  `sha256:f6951f92b4cdcd81790b871a3639b899fc7ff05f2c16651be8cf00d96795ab68`.

These are immutable values captured from `a7faadd`, not expectations to
recalculate after implementation. The test must pass while
`archive_projection.py` is still unmodified. Commit the fixture and passing
characterization test separately:

```powershell
python -m pytest tests/webapp/services/test_archive_projection.py `
  -k "v0_archive_projection_baseline" -v
git add tests/fixtures/application_pack/v0_archive_projection_baseline.md `
  tests/webapp/services/test_archive_projection.py
git commit -m "test: lock application pack v0 archive projection bytes"
```

### Phase B: add explicit v1 projection

Only after the Phase A commit may `archive_projection.py` change. Test first:

- v0 projection output still matches the exact frozen bytes and hash;
- v1 projection adds exactly one `Candidate Snapshot` JSON audit section copied
  from the pack;
- no live Profile read/import is introduced;
- retry for the same exact v1 pack remains idempotent;
- candidate contact values do not leak into filesystem paths.

The projection is an audit/compatibility export, not a second CV renderer. It
does not reinterpret candidate fields or AI review decisions.

Run and commit:

```powershell
python -m pytest tests/webapp/services/test_archive_projection.py -v
git add webapp/services/archive_projection.py `
  tests/webapp/services/test_archive_projection.py
git commit -m "feat: project application pack v1 candidate audit data"
```

---

## Task 9: Verify current and historical rendering through owner-scoped routes

**Files:**

- Modify: `tests/webapp/api/test_application_pack_render_routes.py`
- Modify if strictly required by a failing contract: `webapp/services/http_api.py`

No route change is expected. Add integration tests proving:

1. current v1 CV includes embedded candidate name/contact/structured history;
2. explicit historical v0 renders the frozen legacy structure and does not gain
   v1 fields;
3. explicit historical v1 renders its own embedded candidate snapshot;
4. after confirming v1, replace or delete the live Profile Snapshot/current
   pointer, then render the historical pack to identical bytes/hashes;
5. render path performs no Profile, Fit, Intelligence, or review lookup after the
   pack artifact is selected (use monkeypatch tripwires on those read paths);
6. render-mode validation rejects review-ambiguous or unauthorized v1 payloads
   through the stable `RendererError -> PipelineError` seam without exposing
   contract details or payload data;
7. Account B cannot render Account A’s exact v0 or v1 artifact;
8. explicit pack artifact ID cannot cross workspace ownership or silently
   substitute the current pack.

The live-profile deletion test is the end-to-end proof of the intended
immutability boundary. It must not be weakened into merely changing one field.

Run:

```powershell
python -m pytest tests/webapp/api/test_application_pack_render_routes.py -v
python -m pytest tests/webapp/test_account_ownership.py -v
```

If no production route change is needed, commit tests only:

```powershell
git add tests/webapp/api/test_application_pack_render_routes.py
git commit -m "test: prove immutable owner-scoped v0 and v1 historical rendering"
```

If `http_api.py` must change for a genuine contract failure, stop for focused
diff review before including it; authorization must remain before artifact read
and rendering.

---

## Task 10: Add a full Chromium v1 acceptance journey

**Files:**

- Modify: `tests/webapp/test_browser_smoke.py`

Add one Playwright scenario using the existing browser fixtures:

1. refresh/create a structured Evidence Profile with name, contact, employment,
   education, and certification data;
2. create a job and run Understanding, Job Fit, and Intelligence;
3. make the existing explicit review decisions;
4. confirm the v1 pack;
5. download CV and cover letter and inspect their DOCX paragraph text in the
   Python test process;
6. assert Profile-owned employment details and reviewed tailored bullets appear
   in separate sections;
7. assert no unreviewed AI text appears;
8. change the live Evidence Profile, reload, and download the exact historical
   pack by artifact ID;
9. assert identical response hashes/bytes and the original candidate facts;
10. assert no private filesystem/API-key content is exposed.

Run the new scenario, then all browser journeys:

```powershell
python -m pytest tests/webapp/test_browser_smoke.py `
  -k "application_pack_v1" -v
python -m pytest tests/webapp/test_browser_smoke.py -v
```

Expected browser count becomes 15 unless another reviewed plan has changed the
baseline first. Commit:

```powershell
git add tests/webapp/test_browser_smoke.py
git commit -m "test: add Chromium journey for immutable application pack v1 rendering"
```

---

## Task 11: Boundary, migration, and regression verification

**Files changed:** none unless a failing test exposes an in-scope defect.

### Forbidden-diff checks

Against the frozen product baseline:

```powershell
git diff a7faadd...HEAD --name-only -- `
  product/job_fit.py `
  product/application_intelligence.py `
  product/profile_snapshot.py `
  webapp/services/staleness.py `
  webapp/application_material.py `
  webapp/persistence/review.py `
  webapp/persistence/accounts.py `
  webapp/persistence/workspaces.py `
  webapp/services/ownership.py `
  webapp/services/http_api.py `
  webapp/api/review.py `
  webapp/persistence/schema.sql `
  webapp/persistence/migrations.py
```

Expected: empty. These paths mechanically protect `list_review_decisions`,
account/workspace owner resolution, `AccountScope`, authorization-before-read,
and the existing `RendererError -> PipelineError` route seam. If Task 9 exposes
a genuine need to change `http_api.py`, stop for the focused review required
there before altering this expected set; do not silently weaken the guard.

`webapp/services/application_pack.py` must change to construct v1, so it cannot
be part of the empty file-level check. It is nevertheless the real module that
contains `_decision_index`. Mechanically prove that function's AST is unchanged
from `a7faadd`:

```powershell
@'
import ast
import subprocess
from pathlib import Path

def function_ast(source: str, name: str) -> str:
    tree = ast.parse(source)
    node = next(
        item for item in tree.body
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
        and item.name == name
    )
    return ast.dump(node, include_attributes=False)

baseline = subprocess.check_output(
    ["git", "show", "a7faadd:webapp/services/application_pack.py"],
    text=True,
    encoding="utf-8",
)
current = Path("webapp/services/application_pack.py").read_text(encoding="utf-8")
assert function_ast(current, "_decision_index") == function_ast(
    baseline, "_decision_index"
), "_decision_index changed from a7faadd"
'@ | python -
```

Expected: exit code zero. Review the remaining diff in that module with function
context and require all selection semantics to stay in place:

```powershell
git diff --function-context a7faadd...HEAD -- webapp/services/application_pack.py
```

The Task 7 newest-effective characterization tests are the behavioral guard for
the nested review-selection code. Neither this review nor the AST check assigns
meaning to equal timestamps.

No new SQL/migration file may exist. Confirm:

```powershell
git diff a7faadd...HEAD --name-only | Select-String -Pattern "migration|schema.sql"
```

Expected: no output.

### Protected semantic suites

```powershell
python -m pytest `
  tests/test_job_fit.py `
  tests/test_application_intelligence.py `
  tests/webapp/services/test_staleness.py `
  tests/webapp/test_application_material.py `
  tests/webapp/persistence/test_workflow.py `
  tests/webapp/persistence/test_accounts_migration.py `
  tests/webapp/persistence/test_search_workspace_migration.py -v
```

All must pass unmodified.

### Static renderer boundary

Strengthen the existing import guard so both
`product/application_pack_renderer.py` and its imported contract module remain
free of webapp/persistence/provider imports. The contract module may validate
plain artifact-shaped dictionaries but performs no lookup.

No commit unless a test-only boundary guard is added; if added, use:

```powershell
git commit -m "test: guard application pack v1 trust boundaries"
```

---

## Task 12: Mandatory final Chrome-inclusive full suite and handoff

1. Install Chromium again unconditionally:

   ```powershell
   python -m playwright install chromium
   ```

2. Run the full suite:

   ```powershell
   python -m pytest tests/ -v
   ```

3. Require 100% passing tests, with only the accepted pre-existing skip unless a
   separately reviewed baseline changed it.
4. Run:

   ```powershell
   git diff --check
   git status --short
   git diff a7faadd...HEAD --stat
   ```

5. Review the final diff specifically for:

   - exact v0 renderer and archive-projection byte/hash compatibility, including
     archive length `752` and SHA-256
     `f6951f92b4cdcd81790b871a3639b899fc7ff05f2c16651be8cf00d96795ab68`;
   - construction-mode proof that
     `pack["candidate_snapshot"] == build_candidate_snapshot(source_profile_artifact)`,
     including omitted record/field, fabricated record, and reordered-output
     failures;
   - render-time provenance-limit comments/tests;
   - exact-one effective review authorization per rendered AI unit;
   - verbatim Profile employment details separated from tailored AI bullets;
   - historical rendering after live Profile deletion;
   - ownership before artifact read;
   - absence of migrations and protected semantic changes.

6. Report:

   - commits created;
   - files changed;
   - focused contract/service/renderer/route results;
   - exact v0 renderer and archive-projection baseline lengths/hashes;
   - Chromium results;
   - full-suite result;
   - `git diff --check`;
   - confirmation that `master` and the candidate-profile edit were untouched;
   - every deviation from this plan and why.

Stop after the final validated implementation commit. Do not merge or push.

---

## Expected commit sequence

1. `test: lock application pack v0 renderer bytes`
2. `feat: build deterministic candidate presentation snapshots`
3. `feat: validate immutable application pack v1 contracts`
4. `refactor: add explicit application pack renderer version dispatch`
5. `feat: render self-contained application pack v1 documents`
6. `feat: confirm provenance-complete application pack v1 artifacts`
7. `test: lock application pack v0 archive projection bytes`
8. `feat: project application pack v1 candidate audit data`
9. `test: prove immutable owner-scoped v0 and v1 historical rendering`
10. `test: add Chromium journey for immutable application pack v1 rendering`
11. Optional test-only boundary commit if Task 11 adds a guard.

Each commit must leave the repository coherent for its current production pack
version. No squash, merge, push, or unrelated cleanup is part of this plan.
