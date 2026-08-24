# User-Managed Document Finalization - Design Specification

**Status:** Proposed for review; production implementation is explicitly out of scope
**Accepted product baseline:** `9f99898`
**Reference-only rejected branch:** `feature/manual-document-editing-presentation @ 6743d70`
**Date:** 2026-08-24

## 1. Product decision

The governing principle is:

> AI creates the application CV and cover letter. The human owns the final documents.

JobSearch generates evidence-backed Word documents from the existing reviewed
application pipeline. The user may download those originals, edit them in Word
or another compatible editor, and upload any preferred DOCX version. JobSearch
stores exact bytes and provenance; it does not police arbitrary human wording.

The authoritative handoff chain is:

```text
reviewed application material
  -> immutable AI-generated DOCX originals
  -> explicit per-kind user selection
  -> immutable confirmed final pack with exact IDs and SHA-256 hashes
  -> future handoff uploads those exact stored bytes
```

The forbidden chain is:

```text
confirmed final pack
  -> current Profile / Job Fit / Intelligence / renderer
  -> regenerated or substituted submission document
```

## 2. Scope and non-goals

This ticket designs:

1. storage of generated DOCX originals;
2. download, external editing, and re-upload;
3. immutable uploaded document versions;
4. explicit CV and cover-letter selection per Application Workspace;
5. an optional account-owned reusable-document library;
6. immutable final-pack hash binding for future handoff;
7. historical exact-byte retrieval;
8. account isolation;
9. upload validation and storage safety; and
10. backward compatibility for historical Application Packs.

This ticket does not redesign Job Fit, Application Intelligence, Evidence
Profile, review selection, discovery, authentication, or submission automation.
It does not add in-app document editing, presentation controls, edit
classification, factual-integrity attestation, or semantic validation of user
uploads.

## 3. Verified baseline at `9f99898`

These are repository facts, not plan assumptions:

- Reviewed application material is assembled as an immutable
  `application-pack.v1` payload from exact Profile, Job Posting, Job Fit,
  Application Intelligence, and effective review-decision sources.
- Gate 4 currently persists that pack, records a `drafted` workflow event, and
  binds the exact pack artifact ID.
- `application-pack.v0` and `.v1` render deterministically from their own
  payloads. Rendering has no live Profile, Fit, or Intelligence lookup.
- Rendered files already expose exact byte length and `sha256:<hex>` identity.
- Historical render routes can request an exact pack artifact rather than
  silently substituting the current pack.
- `artifacts.payload_json` is suitable for immutable JSON metadata, but it is
  not a binary-object store.
- `documents_root` currently holds a best-effort Markdown archive projection;
  it is not an authoritative blob store.
- Account ownership exists on workspaces, and every user-facing route is
  expected to resolve an explicit `AccountScope`.
- The current schema has no table for binary document versions, reusable
  documents, or per-application document selection.
- The runtime does not currently depend on `python-multipart`.

The existing arbitrary-JSON artifact model therefore does not remove the need
for a migration. Exact uploaded bytes need durable binary storage and
owner-scoped relational metadata. Base64-encoding DOCX files into
`payload_json` is explicitly rejected.

## 4. Domain model

### 4.1 Application document generation

`application-document-generation.v1` is an immutable JSON artifact owned by one
Application Workspace. It contains the exact `application-pack.v1` reviewed
basis used by the unchanged renderer, the renderer version, and the resulting
CV and cover-letter document-version IDs and hashes.

Generation is not confirmation and does not move workflow status. Each
regeneration creates a new artifact and two new immutable document-version
rows. The current-artifact pointer identifies the latest generation; history
remains available.

The service preallocates the generation artifact ID and both document-version
IDs before its database transaction. This permits the immutable generation
payload and document rows to reference one another without a post-insert update.

The generation artifact is separate from `application_pack` because the
baseline product treats an Application Pack as a Gate-4-confirmed record.
Persisting an unconfirmed pack under that artifact type would blur existing
workflow and historical semantics.

### 4.2 Document version

A document version is an immutable metadata row pointing to immutable exact
bytes. Required fields are:

```text
id                         opaque document-version ID
account_id                 immutable owner
source_workspace_id        creating Application Workspace
document_kind              cv | cover_letter
origin                     ai_generated | user_uploaded
original_filename          original user/renderer filename
media_type                 canonical DOCX MIME type
byte_length                exact stored byte count
sha256                     lowercase 64-character digest
storage_key                server-generated relative blob key
source_generation_artifact_id  required for ai_generated, null for upload
created_at                 server timestamp
```

Every generation and every upload creates a new document-version ID, even when
its bytes duplicate an existing version. Physical blobs may be deduplicated by
SHA-256, but domain history may not be collapsed.

Metadata is immutable. There is no update operation for filename, origin,
kind, source, hash, length, storage key, or ownership.

### 4.3 Application selection

One mutable selection pointer exists per `(workspace_id, document_kind)`:

```text
workspace_id
document_kind              cv | cover_letter
document_version_id
revision                   optimistic-concurrency integer
selected_at
```

Selection is explicit. Generating or uploading a document does not silently
select it. The UI action is **Use this version**.

A selection is valid only when:

- the Application Workspace belongs to the current account;
- the document version belongs to the same account;
- the kinds match; and
- the version either originated in this workspace or is an account-owned
  reusable user-managed document.

Changing selection after a pack was confirmed does not mutate that pack. It
makes the workspace visibly require a new confirmation before handoff uses the
new selection.

### 4.4 Reusable document membership

Reuse is a separate mutable membership, not a mutation of a document version:

```text
account_id
document_version_id
label                      optional user-facing label
saved_at
```

Only `user_uploaded` versions may be saved for reuse in the first release.
Removing a version from the library removes only membership; it does not
delete the document, break existing selections, or rewrite historical packs.

Selecting a reusable version in another application points to the same exact
document version and bytes. The UI must label it **User-managed - not verified
by JobSearch for this role**. Evidence Profile changes never rewrite it.

## 5. Authoritative binary storage

### 5.1 Content-addressed layout

Exact bytes live beneath a dedicated server-owned root, for example:

```text
documents_root/document_blobs/sha256/ab/<64-hex-digest>.docx
```

`storage_key` is produced by the server from the computed digest. No account
ID, workspace ID, original filename, request path, or caller-supplied path is
used to construct it.

The storage service must resolve the final path and prove it remains under the
configured blob root. Downloads never accept a storage path from the client.

### 5.2 Write ordering

SQLite and the filesystem cannot share one atomic transaction. The safe order
is:

1. validate the complete upload/generated bytes;
2. compute length and SHA-256;
3. write a temporary file inside the blob root;
4. flush, close, and atomically publish to the content-addressed target;
5. if the target already exists, verify its exact length and hash and retain it;
6. persist metadata, selections, and artifacts in one SQLite transaction.

A database failure may leave an unreferenced content-addressed blob, which is
safe and can be garbage-collected later. The reverse failure mode - committed
metadata pointing to a missing blob - is forbidden.

No implementation path overwrites a published blob.

### 5.3 Read integrity

Every authoritative download and future handoff read:

1. resolves document metadata through owner/workspace authorization;
2. opens only the server-derived storage key;
3. enforces the recorded byte length;
4. recomputes SHA-256 while reading; and
5. fails closed on any mismatch.

It never repairs, normalizes, or regenerates corrupt or missing bytes.

## 6. AI-generated originals

The **Generate AI documents** operation is available only when the existing
reviewed application-material builder produces completion-ready
`application-pack.v1` material under the unchanged authoritative completion
contract.

The operation:

1. obtains the exact current reviewed basis using existing pack construction;
2. validates it with the existing v1 validator;
3. renders CV and cover letter with the existing deterministic renderer;
4. stores each exact rendered byte stream as `ai_generated` document versions;
5. persists one immutable generation artifact containing the exact v1 basis,
   renderer version, and both version IDs/hashes; and
6. commits both metadata rows and the generation artifact atomically after
   both blobs are safely published.

The generated originals are never overwritten. A later pipeline rerun may
offer generation again and create a new pair. Old generated originals remain
downloadable and retain their exact provenance.

An AI-generated original is honestly labelled **Generated by JobSearch from
reviewed evidence**. That statement applies to that exact generated version,
not to a later user upload derived from it.

## 7. Upload contract and security

### 7.1 First-release file scope

The accepted format is DOCX only:

- extension: `.docx` case-insensitively;
- canonical media type:
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
- maximum compressed upload size: 10 MiB;
- maximum ZIP entry count: 2,048;
- maximum total uncompressed size: 50 MiB; and
- maximum aggregate expansion ratio: 100:1.

Client filename and `Content-Type` are untrusted hints. Server-side validation
must additionally require a valid ZIP/OOXML package containing
`[Content_Types].xml`, `_rels/.rels`, and `word/document.xml`.

Reject:

- malformed or truncated ZIPs;
- encrypted entries;
- absolute paths, drive paths, `..` traversal, or duplicate normalized names;
- macro payloads such as `word/vbaProject.bin`;
- `.doc`, `.docm`, PDF, HTML, RTF, executable, or polyglot inputs; and
- any limit violation.

Validation inspects the archive in memory/streaming form and never extracts it
to the filesystem. It does not parse prose or attempt factual verification.
An antivirus hook may be added at this boundary later, but the first release
must fail closed if such a configured scanner is unavailable.

Use conventional multipart upload and add `python-multipart` as an explicit
runtime dependency when implementation begins. Error messages reveal no
storage paths or cross-account resource existence.

### 7.2 Filename handling

The original filename is retained as display metadata after Unicode and length
validation. Download `Content-Disposition` uses a separately sanitized ASCII
fallback plus standards-compliant encoded filename. It never interpolates raw
CR, LF, quotes, slashes, or control characters.

### 7.3 Human provenance

Every upload is labelled **User-managed document**. JobSearch may state that
the user uploaded and selected it, its exact timestamp, and its exact hash. It
must not state or imply that its wording was verified against Evidence Profile,
Job Fit, Application Intelligence, or review decisions.

There is no wording classification, factual-change block, attestation, or
automatic return to Evidence Profile.

## 8. Final Application Pack contract

New confirmations use a freshly designed `application-pack.v2`. This name is a
normal successor to v0/v1; it does not reuse the rejected branch's governed
editing payload.

V2 is a closed immutable manifest:

```json
{
  "schema_version": "application-pack.v2",
  "generation_basis": {
    "generation_artifact_id": "art_...",
    "reviewed_application_pack": { "schema_version": "application-pack.v1" }
  },
  "final_documents": {
    "cv": {
      "document_version_id": "docv_...",
      "document_kind": "cv",
      "origin": "user_uploaded",
      "sha256": "0123...64 hex...",
      "byte_length": 48123,
      "original_filename": "My final CV.docx"
    },
    "cover_letter": {
      "document_version_id": "docv_...",
      "document_kind": "cover_letter",
      "origin": "ai_generated",
      "sha256": "abcd...64 hex...",
      "byte_length": 39210,
      "original_filename": "Company_Role_Cover_Letter.docx"
    }
  },
  "confirmed_by_account_id": "account_local",
  "confirmed_at": "2026-08-24T20:30:00+00:00",
  "completion_contract_version": "substantive-completion.v1"
}
```

`generation_basis` is the exact current immutable generation artifact selected
inside the confirmation transaction. It proves that this application reached a
completion-ready reviewed AI basis. It is not a claim that every selected file
was derived from that one generation. Each `ai_generated` document version
retains its own exact `source_generation_artifact_id`; user-managed documents
retain `user_uploaded` provenance. This distinction permits an honest mix of an
AI original, a user upload, or a reusable document without laundering their
origins.

Construction validates in one transaction that:

- the generation artifact and both selections belong to the workspace/account;
- both required kinds are present and distinct;
- every embedded document field exactly equals immutable metadata;
- every referenced blob exists and passes exact length/hash verification;
- the embedded reviewed v1 basis exactly equals the generation artifact basis;
- the reviewed basis was completion-ready under the authoritative unchanged
  application-material completion function; and
- the current selection revisions have not changed during confirmation.

The pack snapshots metadata rather than trusting mutable selection rows later.
Its bytes remain in the document store; its manifest is in the immutable JSON
artifact store.

Confirmation means only:

> Use these exact selected files for this application.

It does not mean JobSearch approves every factual statement in user-managed
files.

## 9. Gate 4 and workflow behavior

V0/v1 pack behavior remains frozen.

For v2, the existing workflow transition and status restrictions remain, but
the completion input is the immutable embedded `generation_basis` v1 pack -
never uploaded file text, stored completion metadata, current live artifacts,
or a caller-supplied substitute. The existing completion thresholds remain
unchanged.

This preserves two separate truths:

- JobSearch produced a completion-ready reviewed AI basis; and
- the human selected the exact files they want to use.

The workflow does not claim the second truth was semantically validated.

While the workspace remains `drafted`, the user may upload or select another
version. Doing so does not mutate the current confirmed pack. The UI must show
that selection differs from the confirmed pack and require explicit
reconfirmation, producing another immutable v2 pack.

A change in the live Evidence Profile or current pipeline after generation is
shown as provenance/staleness context and blocks producing a *new* AI original
until the normal pipeline is current. It does not invalidate or rewrite stored
document bytes, and it does not block the human from selecting and confirming
an already generated or user-managed version. Confirmation validates the exact
immutable generation basis that originally passed completion, not today's live
Profile. This is intentional: Evidence Profile governs AI generation, not the
human's final document ownership.

The `applied` transition continues to bind an explicitly supplied exact pack
artifact. Submission/handoff must reject mutable selections that do not match
that pack. Once applied, application selection and confirmation writes are
blocked; historical document and pack downloads remain available.

## 10. Historical and compatibility behavior

- Historical v0 packs render exactly as they do at `9f99898`.
- Historical v1 packs render exactly as they do at `9f99898`.
- Their deterministic byte/hash baselines are frozen before adding v2 dispatch.
- V2 does not render or regenerate documents. Its download service reads the
  exact bound document-version blobs and verifies them against the manifest.
- An explicit historical pack ID always selects that pack's exact document
  manifest. The current pack is never substituted.
- Profile changes, pipeline reruns, renderer changes, new uploads, selection
  changes, reusable-library changes, or account preference changes cannot alter
  historical bytes.
- After `applied`, the workflow event's pack ID is the source of truth for the
  exact submitted CV and cover letter.

The existing Markdown archive projection may add v2 manifest metadata but is a
non-authoritative convenience projection. Blob bytes plus database metadata and
pack manifests are authoritative.

The future handoff seam accepts an authorized exact pack artifact ID, not a
workspace's mutable selection. A pure service-level resolver loads the v2
manifest, resolves its two document-version IDs, verifies kind/owner/length/hash
against both metadata and bytes, and returns read streams plus safe filenames.
If the workspace selection has changed since that pack was confirmed, a
pre-submission handoff must block and ask for explicit reconfirmation. After
`applied`, the workflow event's submitted pack ID wins regardless of later
current pointers.

## 11. Ownership and authorization

All user-facing document operations require `AccountScope` before resolving a
workspace, document ID, selection, reusable membership, generation artifact,
or pack.

Cross-account attempts return the same not-found response as absent resources.
Knowing a document ID, hash, storage key, workspace ID, reusable membership, or
pack ID grants no access.

Database design must carry `account_id` directly on document versions and
reusable membership. Service-level transactional checks enforce that workspace,
selection, document, generation, and confirming account agree. Migration tests
must prove nondefault-account behavior and ownership immutability.

The blob store itself is never exposed as a static-file mount. Every read goes
through authorized application routes.

## 12. Minimal persistence change

Implementation requires one migration adding:

```text
application_document_versions
application_document_selections
reusable_application_documents
```

The first table stores immutable metadata. The second stores the two mutable
workspace pointers with optimistic revision. The third stores account-owned
library membership.

The database should enforce the service invariants structurally:

- document versions have a composite foreign key from
  `(source_workspace_id, account_id)` to the existing unique workspace/owner
  pair;
- `(id, account_id, document_kind)` is unique on document versions;
- selections reference `(document_version_id, account_id, document_kind)`, so
  owner and kind cannot drift;
- reusable membership references `(document_version_id, account_id)` and is
  additionally restricted by the service to `user_uploaded` origin; and
- update/delete triggers make document-version metadata immutable in the first
  release.

The existing account aggregate-delete guard must be extended so an account
that owns document versions or reusable membership cannot be deleted. Ownership
columns themselves remain immutable.

Generated basis and final manifests use two new artifact types:

```text
application_document_generation
application_pack                 (v2 is a new payload version, not a new type)
```

No binary data is stored in SQLite JSON. No existing row is backfilled or
rewritten. The migration creates empty tables and indexes and therefore has no
historical data conversion requirement.

## 13. Minimal service and API surface

Suggested routes, all under an owned Application Workspace:

```text
POST /api/workspaces/{workspace_id}/application-documents/generate
POST /api/workspaces/{workspace_id}/application-documents/upload/{kind}
GET  /api/workspaces/{workspace_id}/application-documents
GET  /api/workspaces/{workspace_id}/application-documents/{version_id}/download
PUT  /api/workspaces/{workspace_id}/application-documents/selection/{kind}
POST /api/workspaces/{workspace_id}/application-documents/{version_id}/save-for-reuse
DELETE /api/workspaces/{workspace_id}/application-documents/{version_id}/save-for-reuse
GET  /api/reusable-application-documents
POST /api/workspaces/{workspace_id}/application-pack
```

Selection requests contain a document-version ID and expected selection
revision. Upload requests contain only kind plus the file. Trusted origin,
owner, workspace, timestamp, length, hash, MIME, storage key, and IDs are
server-derived.

## 14. Workspace UX

Replace Gate 4's direct-render/confirm presentation with two simple panels.

```text
CV
  AI-generated originals
    [filename] [date] [Download] [Use this version]

  Your uploaded versions
    [filename] [date] [Download] [Use this version] [Save for reuse]

  [Upload edited CV]
  Selected for this application: [exact filename + origin + hash suffix]
```

The cover-letter panel is equivalent.

The confirmation area says:

```text
Use these exact selected files for this application.
CV: <filename> - <origin> - SHA-256 ...abcd1234
Cover letter: <filename> - <origin> - SHA-256 ...9876fedc
[Confirm selected files - does not submit]
```

Required labels:

- **AI-generated original - based on reviewed JobSearch evidence**
- **User-managed document - not content-verified by JobSearch**
- **Selected for this application**
- **Confirmed exact files - not submitted**
- **Submitted files** after `applied`

Download, selection, confirmation, and submission must read as separate
actions. Upload never implies selection; selection never implies confirmation;
confirmation never implies submission.

## 15. Failure behavior

- Invalid upload: reject before publishing metadata; preserve all earlier
  versions and selections.
- Blob write failure: no metadata or selection changes.
- Database failure after blob publication: leave an unreferenced immutable blob
  for later garbage collection; expose no version.
- Hash mismatch on read: fail closed, log the document/version ID without file
  contents, and do not regenerate.
- Stale selection revision: return conflict and show current selection.
- Missing selection: confirmation remains blocked with a per-kind explanation.
- Cross-account ID: not found, without confirming existence.
- Selection changed during confirmation: roll back pack and workflow event.
- Archive projection failure: preserve the confirmed database record and exact
  blobs, matching the existing best-effort projection philosophy.

## 16. Acceptance requirements

Implementation planning must include test-first coverage proving:

1. v0/v1 renderer byte and archive locks from `9f99898` remain exact;
2. generated originals store renderer bytes and hashes exactly;
3. every repeated upload creates a new version ID, including identical bytes;
4. published blobs are immutable and verified on read;
5. invalid, oversized, traversal, encrypted, macro, and ZIP-bomb-like files are
   rejected without state changes;
6. upload metadata and timestamps cannot be forged by clients;
7. selection requires exact kind, owner, workspace/reuse eligibility, and
   optimistic revision;
8. confirmation embeds metadata exactly equal to the selected immutable rows;
9. changing selection requires a new confirmation and cannot mutate an older
   pack;
10. v2 historical downloads still return exact bytes after Profile deletion,
    renderer changes, new uploads, and new confirmations;
11. Account B cannot list, download, select, save, confirm, or infer Account A's
    document IDs or hashes;
12. reusable user documents remain unchanged when Evidence Profile changes;
13. `applied` binds one exact v2 pack and both exact files;
14. handoff-facing resolution rejects current selections that differ from the
    submitted/confirmed pack;
15. all existing workflow submission restrictions remain; and
16. Chromium covers generate, download, upload, explicit selection,
    confirmation, replacement selection, reuse, and historical download.

## 17. Protected boundaries

Implementation must not change:

- Job Fit semantics or score;
- Application Intelligence generation or evidence boundary;
- Evidence Profile parsing or ownership;
- effective review-decision selection;
- substantive-completion thresholds;
- staleness calculation;
- account resolution or authentication behavior;
- discovery; or
- submission automation.

Any workflow change is limited to recognizing the fresh v2 manifest and
projecting its exact immutable embedded v1 generation basis into the unchanged
completion function. No caller supplies completion material.

## 18. Recommended delivery boundary

The smallest useful first release includes generated originals, DOCX upload,
immutable versions, explicit selection, optional reuse membership, v2 final
manifest, exact historical download, and handoff-facing exact-file resolution.

It excludes document deletion, library folders/tags, previews of arbitrary
uploads, text extraction, semantic comparison, antivirus product integration,
PDF conversion, cloud object storage, and automatic reuse migration. Those can
be separate tickets after the exact-byte contract is proven.
