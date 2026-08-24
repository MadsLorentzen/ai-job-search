# Manual Editing Branch Salvage Assessment

**Status:** Proposed for review; no cherry-picks authorized
**Baseline for new design:** `9f99898`
**Frozen reference branch:** `feature/manual-document-editing-presentation @ 6743d70`
**Date:** 2026-08-24

## 1. Conclusion

Do not integrate, rewrite, or partially merge `6743d70`.

No production commit from the branch should be cherry-picked into the new
human-owned document design. Its production contracts are organized around
in-app editable units, classification, attestation, draft freshness, and
presentation rendering. Those concepts are deliberately absent from the new
product direction.

The branch remains valuable as reference material for exact-byte testing,
immutable-history tests, owner-scoped route tests, and the integration lesson
that workflow must validate the exact object it binds.

## 2. Safe salvage candidates

### 2.1 V1 compatibility locks from `2efc2f8`

This commit is narrowly useful:

- v1 CV baseline: 36,733 bytes,
  `sha256:ee9f915b0eaadf9eda5ac758016c44e0017ae7c180e4859d3812fb2241f0d19e`;
- v1 cover-letter baseline: 36,668 bytes,
  `sha256:9e69eb343b4be43317644b7ffd8a6a0029253bd57714bfbbf7acdc97851aaa7e`;
- v1 archive fixture: 2,705 bytes,
  `8811be42ac296b0bd530900d9e6894d62d15574f44c081018c22164bc012a60a`;
  and
- a narrowly scoped LF rule for that Markdown fixture.

These are exact `9f99898` behavior locks and should be ported before new pack or
download dispatch changes. The commit can be considered for a reviewed
test-only cherry-pick, but nothing is authorized yet.

### 2.2 Effective-decision characterization from `3c12175`

Its tests characterize newest-effective exact-source review decisions and prove
that a contradictory newer decision changes the reviewed basis without changing
source artifact IDs. The new generation service still depends on the existing
reviewed pack builder, so these tests are useful protected-boundary coverage.

They should be reviewed and ported as test-only coverage. The new document
model must not import or redefine `_decision_index`.

### 2.3 Historical and cross-account test patterns from `0a910e0`

The branch demonstrates useful acceptance patterns:

- retrieve an explicitly identified historical artifact;
- change or remove current upstream state;
- prove historical bytes remain exact;
- prove a later confirmation does not substitute for an older one; and
- return indistinguishable not-found responses across accounts.

The v2 payload and draft helpers in that commit are rejected. Only the testing
strategy should be adapted to immutable document-version blobs and the new
selected-file manifest.

### 2.4 Baseline renderer utilities already on `9f99898`

The strongest reusable production capability does not need salvaging from the
branch because it already exists on the accepted baseline:

- deterministic DOCX generation;
- frozen ZIP timestamps;
- exact raw-byte SHA-256;
- version-aware v0/v1 dispatch;
- sanitized download filenames; and
- a renderer with no upstream/live-profile reads.

Use the baseline implementation directly for AI-generated originals.

### 2.5 General immutable-record patterns

The branch's append-only discipline, exact-parent conflict tests, and
transaction rollback tests are useful examples. The new implementation should
apply the same discipline to document versions and selection confirmation, but
should not reuse the draft contract or draft tables.

## 3. Explicitly rejected salvage

Do not bring across:

- `product/application_document_draft_contract.py`;
- `product/application_presentation_contract.py`;
- the `application-pack.v2` contract from `6751501`;
- editable `final_text` units or `source_unit` duplication;
- `unchanged`, `unclassified`, `wording_only`, or `factual_change` states;
- factual-integrity attestation or account/timestamp stamping for attestation;
- draft parent/child revisions and exact-current-draft APIs;
- draft preview rendering;
- template IDs, font/size/spacing controls, section reordering, or hiding;
- the final-document in-app editor HTML, JavaScript, and CSS;
- the governed-edit workflow completion projector from `eb2b171`;
- v2 archive edit/presentation audit sections; and
- Chromium scenarios whose purpose is classification, attestation, or
  presentation control.

Those pieces are internally coherent but solve the rejected product model.

## 4. Commit-level disposition

| Commits | Disposition | Reason |
|---|---|---|
| `b1b8bfb`, `b16615a`, `881ce25`, `0e27686` | Reference only | Describe the superseded design and plan. |
| `2efc2f8` | Candidate test-only port | Freezes baseline v1 bytes/archive independently of governed editing. |
| `3c12175` | Candidate test-only port | Protects existing review-decision semantics used by generation. |
| `36b5bb7`, `d7294d4`, `4801ec9`, `73f979a` | Reject | Presentation and draft contracts/persistence/APIs are out of scope. |
| `6751501`, `c285043`, `c884355` | Reject | V2 and templates exist solely for governed in-app editing/presentation. |
| `9a9f16f` | Reject | Draft preview contract is replaced by exact stored-document download. |
| `eb2b171`, `e1a64e9`, `de3af21` | Reject implementation; retain lesson | Workflow must bind exact immutable inputs, but the payload/projector is wrong for the new model. |
| `1cdac37`, `234d7cc` | Reject | In-app editor and presentation UX are explicitly removed. |
| `0a910e0` | Adapt test patterns only | Historical/ownership strategy is useful; v2/draft fixtures are not. |
| `08e4f7f` | Partially adapt scenarios | Keep historical/replacement intent; replace editor interactions with upload/select flows. |
| `6593aba` | Recreate relevant boundary tests | Import-boundary principle remains; governed contract modules do not. |
| `6743d70` | Not needed | Artifact-count update was specific to the rejected draft artifact type. |

## 5. Recommended reuse procedure

1. Keep `6743d70` frozen and unmerged.
2. Begin implementation later from the reviewed design branch based on
   `9f99898`.
3. Before production changes, port or recreate the exact v1 compatibility
   locks from `2efc2f8` and review-decision characterization from `3c12175`.
4. Implement the new binary store, document-version metadata, selection, reuse,
   and final manifest independently.
5. Adapt historical and account-isolation tests by intent, not by copying draft
   fixtures or v2 payloads.
6. Review every proposed cherry-pick by file before applying it. Prefer a clean
   test-only port when a commit contains naming or assumptions tied to manual
   editing.

## 6. Branch preservation

`feature/manual-document-editing-presentation @ 6743d70` should remain as an
unmodified local reference until the replacement implementation is integrated
and its historical/compatibility coverage is independently proven. It should
not be deleted merely because its product direction was rejected.
