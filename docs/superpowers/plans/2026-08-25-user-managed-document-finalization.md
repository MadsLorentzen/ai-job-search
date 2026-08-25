# User-Managed Document Finalization - Implementation Plan

**Goal:** Store immutable AI-generated and user-uploaded DOCX versions, let the
human explicitly select the exact CV and cover letter for an application, and
confirm a small immutable `application-pack.v2` manifest that future handoff
can resolve to the exact selected bytes.

**Frozen product baseline:** `9f99898`

**Authoritative design:**
`docs/superpowers/specs/2026-08-24-user-managed-document-finalization-design.md`
through correction commit `7da17c7`

**Approved salvage assessment:**
`docs/superpowers/specs/2026-08-24-manual-editing-branch-salvage-assessment.md`
at `65fc27e`

**Scope:** Planning only on this branch. Production implementation begins only
after this plan is reviewed and explicitly approved.

---

## 0. Verified repository seams and invariants

### Reviewed material and Gate 4

- `webapp/services/application_pack.py::_build_application_pack_with_profile`
  constructs the exact current reviewed `application-pack.v1` basis.
- `build_application_pack` returns that validated basis without persistence or
  workflow transition.
- `confirm_application_pack` holds `BEGIN IMMEDIATE` while constructing,
  persisting, and binding a pack to `drafted`.
- The existing `POST .../application-pack` body contains only `confirmed` and
  `effective_date`. That request shape must continue producing v1.
- `webapp/application_material.py::application_material_completion` owns the
  substantive thresholds. It must remain unchanged.
- `webapp/persistence/workflow.py::record_status_change` independently checks
  the exact pack artifact bound to `drafted` or `applied`.

### Renderer and historical downloads

- `product/application_pack_renderer.py` deterministically renders v0/v1 from
  one exact pack payload, without persistence or live-upstream imports.
- Rendered files already carry safe filenames, exact lengths, and raw-byte
  SHA-256 values.
- `webapp/services/http_api.py::render_job_application_pack_document` resolves
  an owner-scoped current or explicit historical pack and never substitutes a
  different historical artifact.
- V0 and v1 rendering must stay byte-identical. V2 download dispatch reads
  stored bytes and must not call the renderer.

### Persistence and ownership

- `artifacts.payload_json` is appropriate for immutable metadata but not DOCX
  bytes.
- `webapp/persistence/migrations.py` applies ordered, transactional migrations
  and runs `PRAGMA foreign_key_check` before commit.
- Migration `003_accounts_ownership` established composite workspace/account
  identity, immutable ownership triggers, and the account aggregate-delete
  guard.
- Every user-facing route must resolve `AccountScope` before document lookup.
- `documents_root` is configurable but currently contains only best-effort
  projections. The new blob subtree must not be statically mounted.

### Review semantics

- `list_review_decisions` orders newest first for one exact source artifact.
- `_decision_index` uses `setdefault`, so the newest exact-source decision is
  effective.
- Equal-timestamp tie behavior has no secondary ordering and is outside scope.
- The generation service reuses the existing pack builder and must not redefine
  review selection.

### Frozen rejected branch

`feature/manual-document-editing-presentation @ 6743d70` remains reference
only. No production commit is cherry-picked. Only the explicitly reviewed v1
compatibility fixtures, decision characterization, and test patterns may be
ported after file-level review.

---

## Task 1: Create the isolated implementation branch and reproduce baseline

**Files changed:** none.

1. Create a fresh worktree from the exact product baseline, not from the design
   branch or the rejected feature:

   ```powershell
   git worktree add -b feature/user-managed-document-finalization `
     "C:\Users\smbab\OneDrive\Documents\Projects\ai-job-search-user-managed-documents" `
     9f99898
   ```

2. Bring the documentation-only history onto the implementation branch in
   order:

   ```powershell
   git cherry-pick 65fc27e
   git cherry-pick 7da17c7
   git cherry-pick <approved-plan-commit>
   ```

   Verify those commits change only the three reviewed files under
   `docs/superpowers/`.
3. Confirm:

   ```powershell
   git merge-base 9f99898 HEAD
   git status --short
   git diff --name-only 9f99898...HEAD
   ```

   The merge base must be exactly `9f99898`; the diff must be documentation
   only.
4. Install Chromium unconditionally:

   ```powershell
   python -m playwright install chromium
   ```

5. Run the full accepted baseline before production changes:

   ```powershell
   python -m pytest -q --browser chromium
   ```

   Expected accepted baseline: `1101 passed, 1 skipped`, including 15 Chromium
   journeys. If it differs, stop and reconcile the exact `9f99898` environment
   before implementation.

No commit for this task.

---

## Task 2: Port frozen v1 compatibility and review-basis characterization

**Files:**

- Modify: `.gitattributes`
- Create: `tests/fixtures/application_pack/v1_archive_projection_baseline.md`
- Modify: `tests/test_application_pack_renderer.py`
- Modify: `tests/webapp/services/test_archive_projection.py`
- Modify: `tests/webapp/services/test_application_pack.py`

Do not cherry-pick blindly. Review `2efc2f8` and `3c12175` file by file, then
port only their test/fixture changes.

### Test first

Add immutable expectations from `9f99898`:

- v1 CV: 36,733 bytes,
  `sha256:ee9f915b0eaadf9eda5ac758016c44e0017ae7c180e4859d3812fb2241f0d19e`;
- v1 cover letter: 36,668 bytes,
  `sha256:9e69eb343b4be43317644b7ffd8a6a0029253bd57714bfbbf7acdc97851aaa7e`;
- v1 archive: 2,705 bytes,
  `8811be42ac296b0bd530900d9e6894d62d15574f44c081018c22164bc012a60a`.

Also characterize newest-effective, exact-source decision behavior using
distinct timestamps. Do not add an equal-timestamp tie rule.

Run:

```powershell
python -m pytest -q `
  tests/test_application_pack_renderer.py `
  tests/webapp/services/test_archive_projection.py `
  tests/webapp/services/test_application_pack.py
```

Commit:

```text
test: lock document finalization compatibility boundaries
```

---

## Task 3: Define pure document and DOCX validation contracts

**Files:**

- Create: `product/application_document_contract.py`
- Create: `product/docx_package.py`
- Create: `tests/test_application_document_contract.py`
- Create: `tests/test_docx_package.py`

### Test first - metadata contract

Define closed constants and pure validators for:

- kinds: `cv`, `cover_letter`;
- origins: `ai_generated`, `user_uploaded`;
- canonical DOCX MIME;
- document-version metadata shape;
- SHA-256 lowercase hex and positive byte length;
- safe nonempty original filename;
- `source_generation_artifact_id` required only for `ai_generated`; and
- server-created IDs/timestamps represented as strings without generating them
  inside validation.

### Test first - package validation

Build small in-memory ZIP fixtures. Test:

- valid DOCX with ordinary HTTP/HTTPS hyperlinks;
- wrong extension or declared media type;
- missing ZIP signature at byte zero;
- malformed/truncated archive;
- missing `[Content_Types].xml`, `_rels/.rels`, or `word/document.xml`;
- compressed size over 10 MiB;
- more than 2,048 entries;
- total uncompressed size over 50 MiB;
- expansion ratio over 100:1;
- encrypted entry flag;
- `../`, `..\`, leading slash/backslash, UNC, and drive-letter members;
- duplicate normalized names using slash/backslash and case variants;
- NUL/control characters;
- `word/vbaProject.bin`;
- `word/embeddings/*` OLE/package content;
- `word/activeX/*` content or ActiveX relationships; and
- `.doc`, `.docm`, PDF, HTML, RTF, and executable signatures.

The pure validator returns canonical size/hash/package metadata but never
extracts files or parses prose. It imports neither `webapp` nor persistence.

Run:

```powershell
python -m pytest -q `
  tests/test_application_document_contract.py `
  tests/test_docx_package.py
```

Commit:

```text
feat: validate immutable application document files
```

---

## Task 4: Add migration 004 for document metadata, selection, and reuse

**Files:**

- Modify: `webapp/persistence/migrations.py`
- Create: `webapp/persistence/application_documents.py`
- Create: `tests/webapp/persistence/test_application_documents_migration.py`
- Create: `tests/webapp/persistence/test_application_documents.py`

Use one migration ID:

```text
004_application_documents
```

### Test first - migration

Prove:

- fresh database bootstrap;
- exact upgrade from a populated `003` database;
- idempotent second startup;
- rollback on injected failure;
- `PRAGMA foreign_key_check` remains empty;
- legacy accounts/workspaces/artifacts/events are unchanged;
- no rows are backfilled into the new tables;
- nondefault-account composite foreign keys work;
- document ownership cannot be updated;
- document-version metadata cannot be updated or deleted;
- account deletion is blocked when document rows or reusable membership exist;
- selection kind/owner mismatch fails at the database boundary; and
- duplicate `(workspace_id, kind)` selection is impossible.

Tables:

```text
application_document_versions
application_document_selections
reusable_application_documents
```

Use composite foreign keys described by the design. Extend the account
aggregate-delete trigger deliberately; do not weaken existing ownership guards.

### Test first - persistence helpers

Implement owner-scoped create/get/list operations, current selection with
expected revision, reusable membership, and preallocated document IDs. There is
no metadata update/delete helper.

Run:

```powershell
python -m pytest -q `
  tests/webapp/persistence/test_application_documents_migration.py `
  tests/webapp/persistence/test_application_documents.py `
  tests/webapp/persistence/test_accounts_migration.py
```

Commit:

```text
feat: persist immutable application document versions
```

---

## Task 5: Implement the no-clobber content-addressed blob store

**Files:**

- Create: `webapp/services/document_blob_store.py`
- Create: `tests/webapp/services/test_document_blob_store.py`

### Test first

Prove:

- storage keys derive only from validated SHA-256;
- resolved paths remain under
  `documents_root/document_blobs/sha256/<prefix>/`;
- caller filenames/account/workspace IDs never enter storage paths;
- publish uses a temporary sibling and an atomic no-clobber operation;
- identical bytes reuse physical storage without collapsing version metadata;
- an existing target is retained only after exact length/hash verification;
- a conflicting/corrupt existing target fails closed and is never overwritten;
- database failure may leave only an unreferenced valid blob;
- authorized reads recompute length/hash and fail on corruption or absence;
- no read repairs or regenerates bytes; and
- concurrent identical publish attempts converge on the same valid blob.

Do not mount this directory with `StaticFiles`.

Run:

```powershell
python -m pytest -q tests/webapp/services/test_document_blob_store.py
```

Commit:

```text
feat: store exact application document bytes
```

---

## Task 6: Generate and persist immutable AI originals

**Files:**

- Modify: `webapp/persistence/artifacts.py`
- Create: `webapp/services/application_documents.py`
- Create: `tests/webapp/services/test_application_documents.py`

### Test first

Prove generation:

- calls the unchanged `build_application_pack` and v1 validator;
- requires the authoritative completion result to be `READY`;
- renders through the existing v1 renderer only;
- stores exact renderer bytes and hashes as two `ai_generated` versions;
- preallocates generation/document IDs and commits one closed
  `application-document-generation.v1` artifact plus both metadata rows;
- records exact v1 basis, renderer version, version IDs, lengths, and hashes;
- does not move workflow status or create an `application_pack` artifact;
- creates a new immutable generation and versions on each rerun;
- leaves prior originals downloadable;
- rolls back all database rows if either blob/metadata/artifact step fails; and
- never reads from `6743d70` draft/presentation contracts.

Add `application_document_generation` to the closed artifact registry. If
preallocation requires an artifact helper, add a safe internal optional
artifact-ID seam whose default behavior and all existing callers remain exact.

Run:

```powershell
python -m pytest -q `
  tests/webapp/services/test_application_documents.py `
  tests/webapp/persistence/test_artifacts.py `
  tests/test_application_pack_renderer.py
```

Commit:

```text
feat: persist AI-generated application document originals
```

---

## Task 7: Add strict upload and document-list APIs

**Files:**

- Modify: `requirements.txt`
- Create: `webapp/api/application_documents.py`
- Modify: `webapp/app.py`
- Modify: `webapp/services/http_api.py`
- Create: `tests/webapp/api/test_application_document_routes.py`

Add a pinned `python-multipart` runtime dependency.

### Test first

Prove:

- multipart upload accepts only one DOCX and derives every trusted field on the
  server;
- client attempts to forge owner, workspace, origin, timestamp, hash, length,
  MIME, storage key, or source generation are ignored/rejected by the strict
  route shape;
- each upload creates a new `user_uploaded` version, including identical bytes;
- upload never auto-selects or confirms;
- list results separate AI originals and user uploads and expose no storage key;
- download returns exact bytes, safe `Content-Disposition`, length, hash, kind,
  and origin headers;
- invalid packages leave no metadata/selection changes;
- cross-account/missing workspace and version IDs share not-found behavior;
- applied/final workspaces reject upload writes while preserving reads; and
- raw errors reveal no local path.

Run:

```powershell
python -m pytest -q tests/webapp/api/test_application_document_routes.py
```

Commit:

```text
feat: upload immutable user-managed application documents
```

---

## Task 8: Implement explicit optimistic document selection

**Files:**

- Modify: `webapp/services/application_documents.py`
- Modify: `webapp/api/application_documents.py`
- Modify: `tests/webapp/services/test_application_documents.py`
- Modify: `tests/webapp/api/test_application_document_routes.py`

### Test first

Prove **Use this version**:

- requires document-version ID plus expected current revision;
- rejects missing/stale expected revision with conflict;
- validates exact account and kind;
- accepts a version originating in the same workspace;
- does not accept another workspace's ordinary version;
- does not modify document metadata or bytes;
- selecting again increments revision;
- generation/upload alone leaves selection empty;
- selection is blocked after `applied`; and
- concurrent updates cannot silently win.

Run the two focused files, then commit:

```text
feat: select exact documents for an application
```

---

## Task 9: Add the account-owned reusable-document library

**Files:**

- Modify: `webapp/services/application_documents.py`
- Modify: `webapp/api/application_documents.py`
- Modify: `tests/webapp/services/test_application_documents.py`
- Modify: `tests/webapp/api/test_application_document_routes.py`

### Test first

Prove:

- only `user_uploaded` versions may be saved for reuse;
- membership belongs to the document owner account;
- optional label is bounded and server-normalized;
- removing membership never deletes bytes, metadata, current selections, or
  historical packs;
- Account B cannot list or infer Account A's library;
- a currently reusable same-account version from Workspace A may be selected in
  Workspace B with the matching kind;
- removing membership later does not rewrite an already confirmed pack;
- an unconfirmed cross-workspace selection cannot be newly created after
  membership removal; and
- Profile changes never alter reusable bytes or labels.

Commit:

```text
feat: add reusable user-managed application documents
```

---

## Task 10: Define the fresh pure `application-pack.v2` manifest

**Files:**

- Create: `product/application_pack_v2_contract.py`
- Create: `tests/fixtures/application_pack/v2_selected_files_valid.json`
- Create: `tests/test_application_pack_v2_contract.py`

This module is new work. Do not copy the rejected branch's v2 contract.

### Test first

Define one closed validator/builder for:

- exact generation artifact ID and embedded reviewed v1 basis;
- exact CV and cover-letter manifest entries;
- document ID, kind, origin, `source_generation_artifact_id`, filename, length,
  and SHA-256;
- `confirmed_account_id` as account scope, not human identity;
- server timestamp and completion-contract version; and
- no edit units, classifications, attestation, or presentation fields.

Construction mode receives exact generation artifact, selected immutable rows,
verified blob metadata, current reusable membership, selection revisions, and
account/workspace context. Require exact equality between every embedded field
and its authoritative input.

Render/history validation checks the closed self-contained manifest shape but
does not query mutable selections or claim content verification.

Import tests prohibit `webapp`, persistence, Profile, Fit, Intelligence,
provider, renderer, and the rejected draft/presentation modules.

Run:

```powershell
python -m pytest -q tests/test_application_pack_v2_contract.py
```

Commit:

```text
feat: define selected-file application pack v2
```

---

## Task 11: Confirm v2 selections while preserving legacy v1 API behavior

**Files:**

- Modify: `webapp/services/application_pack.py`
- Modify: `webapp/services/http_api.py`
- Modify: `webapp/api/review.py`
- Modify: `tests/webapp/services/test_application_pack.py`
- Modify: `tests/webapp/api/test_review_routes.py`

Extend the strict request body with one optional all-or-nothing object:

```json
{
  "document_selection_revisions": {
    "cv": 3,
    "cover_letter": 2
  }
}
```

### Test first - compatibility

- An absent selection object follows the exact current code path and creates
  v1.
- Existing request/response/status/projection tests remain unchanged.
- Partial/extra selection fields are rejected; the service never guesses v2.

### Test first - v2

Under one `BEGIN IMMEDIATE` transaction:

- resolve the exact current generation and both selections;
- compare both expected revisions;
- allow same-workspace versions or current same-account reuse membership;
- verify both blobs and metadata;
- build/persist the closed v2 pack;
- bind that exact pack to `drafted`; and
- roll everything back on any race, mismatch, missing blob, or validation
  failure.

The new UI will always send both revisions. Existing API callers need no
change.

Run:

```powershell
python -m pytest -q `
  tests/webapp/services/test_application_pack.py `
  tests/webapp/api/test_review_routes.py
```

Commit:

```text
feat: confirm exact selected application documents
```

---

## Task 12: Authorize the narrow workflow and applied-selection seams

**Files:**

- Modify: `webapp/persistence/workflow.py`
- Modify: `webapp/services/http_api.py`
- Modify: `tests/webapp/persistence/test_workflow.py`
- Modify: `tests/webapp/api/test_status_routes.py`

### Test first

Add a version-aware pure projection from exact pack payload:

```text
v0/v1 payload -> identity
v2 payload    -> exact embedded reviewed application-pack.v1 basis
```

Then pass only that result to unchanged
`application_material_completion()` inside `record_status_change`.

Prove:

- v0/v1 behavior remains exact;
- v2 `drafted` and `applied` use the exact pack passed to workflow;
- caller completion data and stored completion claims cannot substitute;
- malformed v2 or incomplete embedded v1 basis is rejected;
- user-uploaded bytes are not parsed or scored;
- all existing status transitions/restrictions remain;
- before `applied`, current selections must still match the exact current v2
  pack, otherwise status change blocks and asks for reconfirmation;
- v1 application remains compatible without selection rows; and
- `applied` records the exact pack ID that resolves both submitted files.

No completion threshold or public workflow status API changes.

Commit:

```text
feat: bind workflow to exact selected document packs
```

---

## Task 13: Dispatch historical downloads and expose the handoff resolver

**Files:**

- Modify: `webapp/services/http_api.py`
- Modify: `webapp/api/review.py`
- Modify: `webapp/services/archive_projection.py`
- Create: `webapp/services/application_handoff.py`
- Modify: `tests/webapp/api/test_application_pack_render_routes.py`
- Modify: `tests/webapp/services/test_archive_projection.py`
- Create: `tests/webapp/services/test_application_handoff.py`

### Test first

- Current/explicit v0/v1 packs continue through the unchanged renderer and
  preserve exact hashes.
- V2 never imports/calls the renderer; it reads the exact manifest version,
  verifies owner/kind/length/hash twice, and returns stored bytes.
- Explicit historical v2 never substitutes current selections or current pack.
- Handoff accepts an authorized exact pack ID, not mutable selection input.
- Pre-submission handoff blocks if current selections differ from the current
  confirmed v2 pack.
- Submitted handoff resolves from the applied workflow event's pack even if
  current pointers later differ.
- Missing/corrupt blobs fail closed without regeneration.
- Cross-account exact IDs return not found and no DOCX prefix/body.
- V2 Markdown archive projection records the exact final-document manifest and
  generation-basis references without embedding binary data or implying user
  content verification; v0/v1 archive bytes remain frozen.

Commit:

```text
feat: resolve exact application documents for handoff
```

---

## Task 14: Build the simplified workspace presentation

**Files:**

- Modify: `webapp/services/workspace_view.py`
- Modify: `webapp/templates/workspace_detail.html`
- Modify: `webapp/static/app.js`
- Modify: `webapp/static/app.css`
- Modify: `tests/webapp/services/test_workspace_view.py`
- Modify: `tests/webapp/api/test_views.py`

### Test first

The view model must present, per kind:

- immutable AI originals;
- immutable user uploads;
- reusable same-account choices;
- exact current selection and revision;
- exact current confirmed/submitted version where present;
- `can_generate`, `can_upload`, `can_select`, and `can_confirm` controls;
- whether selection differs from confirmed pack; and
- whether an AI version came from current or earlier reviewed material.

Do not change `check_staleness`. Derive the informational earlier-material
label by comparing the immutable generation basis source refs with current
artifacts in the presentation service.

### UI behavior

- **Generate AI documents** creates originals but selects nothing.
- Download and **Use this version** are separate actions.
- Upload creates a version but selects nothing.
- The selected filename, origin, and hash suffix are obvious.
- User uploads/reusable files say **not content-verified by JobSearch**.
- Old generated versions say **This document was generated from earlier
  reviewed material** without disabling selection/confirmation.
- Confirmation says **Confirm selected files - does not submit**.
- After confirmation, exact files remain downloadable; changing selection shows
  reconfirmation required.
- After applied, submitted files are labelled and all finalization writes are
  disabled.
- No governed-editor fields, presentation controls, classification, or
  attestation appear.

Commit:

```text
feat: add human-owned application document workspace
```

---

## Task 15: Prove immutable history, reuse, and account isolation end to end

**Files:**

- Modify: `tests/webapp/api/test_application_pack_render_routes.py`
- Modify: `tests/webapp/test_account_ownership.py`
- Modify: `tests/webapp/test_full_journey_acceptance.py`

Adapt the intent of `0a910e0`, not its rejected fixtures.

Scenarios:

1. Generate originals, upload edited files, select, and confirm v2.
2. Record exact bytes and hashes, then change Profile/current pipeline, upload
   replacements, change selection, and confirm a second v2.
3. Delete current Profile/generation/selection pointers in the test database;
   explicitly download both historical packs and prove exact bytes remain.
4. Save an upload for reuse in Workspace A, select it in Workspace B, confirm,
   remove library membership, and prove the confirmed B pack remains exact.
5. Account B knows Account A's workspace/document/hash/pack IDs but cannot list,
   download, select, save, confirm, or infer them.
6. Apply one exact v2 pack and prove the event/handoff resolves its two files.
7. Confirm legacy v1 with the old request and prove no document rows are needed.

Commit:

```text
test: prove immutable owner-scoped final document history
```

---

## Task 16: Add Chromium acceptance journeys

**Files:**

- Modify: `tests/webapp/test_browser_smoke.py`

Use deterministic in-test DOCX uploads. Add journeys for:

1. generate -> download AI originals -> upload edited CV and cover letter ->
   explicitly select both -> confirm v2 -> download exact confirmed bytes;
2. verify upload does not auto-select, selection does not auto-confirm, and
   confirmation does not mark applied;
3. change selection while drafted -> see reconfirmation warning -> confirm new
   pack -> download older pack unchanged;
4. save for reuse in another workspace with the unverified label;
5. refresh Profile/rerun pipeline -> see **earlier reviewed material** on old AI
   original while selection remains available;
6. applied state shows exact submitted files and disables finalization writes;
7. invalid upload displays a friendly error without losing existing versions;
8. cross-account known IDs never render/download private data; and
9. old no-selection API confirmation remains covered outside the new product UI.

Capture byte equality through browser downloads where Playwright exposes them.

Run:

```powershell
python -m pytest -q tests/webapp/test_browser_smoke.py --browser chromium
```

Commit:

```text
test: add Chromium user-managed document journeys
```

---

## Task 17: Mechanical protected-boundary verification

Against `9f99898`, require no diff in:

```text
product/job_fit.py
product/application_intelligence.py
product/profile_snapshot.py
product/application_pack_contract.py
product/application_material_contract.py
webapp/application_material.py
webapp/services/staleness.py
webapp/persistence/review.py
webapp/persistence/accounts.py
webapp/persistence/workspaces.py
webapp/services/ownership.py
```

`webapp/persistence/migrations.py` is an authorized migration change, but review
function context to prove existing 001-003 operations are unchanged and only
004 registration/implementation plus the deliberate account-delete guard
replacement were added.

`webapp/persistence/workflow.py` is an authorized narrow change. Review function
context to prove only exact-pack version-aware completion projection and v2
selection-match enforcement changed; transitions, transaction behavior, and
public signature remain otherwise exact.

AST-compare `_decision_index` in `webapp/services/application_pack.py` against
`9f99898`; it must remain exact. Review `confirm_application_pack` separately
because legacy/v2 dispatch is authorized.

Static import tests must prove:

- pure document/DOCX/v2 contracts import no webapp, persistence, provider,
  Profile, Job Fit, or Intelligence module;
- the renderer imports no new storage/persistence/upstream module;
- v2 download/handoff does not invoke rendering; and
- no rejected draft/presentation module appears anywhere in the production
  diff.

Run protected suites:

```powershell
python -m pytest -q `
  tests/test_job_fit.py `
  tests/test_application_intelligence.py `
  tests/test_profile_snapshot.py `
  tests/webapp/test_application_material.py `
  tests/webapp/services/test_staleness.py `
  tests/webapp/persistence/test_review.py `
  tests/webapp/persistence/test_workflow.py `
  tests/webapp/persistence/test_accounts_migration.py `
  tests/webapp/persistence/test_search_workspace_migration.py
```

If a test-only boundary commit is needed:

```text
test: guard user-managed document trust boundaries
```

---

## Task 18: Mandatory final verification and handoff

Run focused suites:

```powershell
python -m pytest -q `
  tests/test_application_document_contract.py `
  tests/test_docx_package.py `
  tests/test_application_pack_renderer.py `
  tests/test_application_pack_v2_contract.py `
  tests/webapp/persistence/test_application_documents_migration.py `
  tests/webapp/persistence/test_application_documents.py `
  tests/webapp/services/test_document_blob_store.py `
  tests/webapp/services/test_application_documents.py `
  tests/webapp/services/test_application_handoff.py `
  tests/webapp/services/test_application_pack.py `
  tests/webapp/api/test_application_document_routes.py `
  tests/webapp/api/test_application_pack_render_routes.py `
  tests/webapp/api/test_review_routes.py `
  tests/webapp/api/test_status_routes.py `
  tests/webapp/services/test_workspace_view.py `
  tests/webapp/api/test_views.py
```

Run all Chromium journeys:

```powershell
python -m pytest -q tests/webapp/test_browser_smoke.py --browser chromium
```

Run the mandatory full gate:

```powershell
python -m pytest -q --browser chromium
```

Then:

```powershell
git diff --check 9f99898...HEAD
git status --short
git diff --stat 9f99898...HEAD
```

Verify the main worktree remains on `master @ 9f99898`, the candidate-profile
hash remains unchanged, and `6743d70` remains frozen. Stop after the final
validated feature commit. Do not merge or push.

Final report must include:

- commits created;
- files changed;
- migration fresh/upgrade/idempotency/rollback results;
- frozen v0/v1 hashes;
- DOCX security-fixture results;
- focused/protected/Chromium/full-suite counts;
- exact historical and cross-account results;
- `git diff --check`;
- protected-diff/AST/import results;
- confirmation that master, the frozen branch, and candidate profile were
  untouched; and
- every deviation from this reviewed plan and why.

---

## Planned commit sequence

1. `test: lock document finalization compatibility boundaries`
2. `feat: validate immutable application document files`
3. `feat: persist immutable application document versions`
4. `feat: store exact application document bytes`
5. `feat: persist AI-generated application document originals`
6. `feat: upload immutable user-managed application documents`
7. `feat: select exact documents for an application`
8. `feat: add reusable user-managed application documents`
9. `feat: define selected-file application pack v2`
10. `feat: confirm exact selected application documents`
11. `feat: bind workflow to exact selected document packs`
12. `feat: resolve exact application documents for handoff`
13. `feat: add human-owned application document workspace`
14. `test: prove immutable owner-scoped final document history`
15. `test: add Chromium user-managed document journeys`
16. Optional test-only protected-boundary commit.
