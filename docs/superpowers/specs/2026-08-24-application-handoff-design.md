# Application Handoff / Autofill + Submission Record — Design Specification

## 1. Goal

Design how a user takes an already-confirmed, immutable Application Pack and
uses it to complete a real job application on an external site, with a
browser extension that prepares the application (autofill of safe facts,
attachment of the exact approved documents, surfacing of ambiguous
questions) while the user remains the one who reviews and submits. Produce a
durable, honest record of what actually happened, without ever inventing,
regenerating, silently substituting, or rewriting content.

This is a design and specification only. No production code is written as
part of this document.

## 2. Verified current state

Investigated at commit `9f99898` on branch `design/application-handoff`
(worktree isolated from `master`; `master` untouched; the pre-existing
uncommitted candidate-profile edit is unrelated to this branch and was not
touched).

- Full suite baseline at this commit: `1095 passed, 7 skipped` (close to the
  `1101 passed, 1 skipped` figure quoted in the originating brief; the
  difference is environment/filter variance, not a discrepancy worth
  investigating for this design).

### 2.1 Application Pack v1 contract

- `product/application_pack_contract.py` defines `APPLICATION_PACK_V0 =
  "application-pack.v0"` and `APPLICATION_PACK_V1 = "application-pack.v1"`.
  A v1 pack's top-level keys are exactly `_PACK_V1_KEYS`: `schema_version`,
  `source_artifacts`, `candidate_snapshot`, `job`, `fit_summary`,
  `recommendation`, `recommendation_reason`, `cv_content`,
  `cover_letter_content`, `review_record`, `completion_contract_version`,
  `completion_status`, `completion_issues`, `completion_metrics`. No other
  keys may exist on a v1 pack.
- `candidate_snapshot` (`_CANDIDATE_KEYS`) carries `identity`, `contact`,
  `employment`, `education`, `certifications`, `skills`, `languages`,
  `projects`, `publications`, `awards`. Every leaf is a **provenanced
  value**: `{"value": <str>, "profile_evidence_ids": [<clm_... ids>]}`.
  `identity.name` is non-nullable; `contact.{email,phone,linkedin,github,
  location}` are nullable provenanced values. Record-shaped items
  (employment, education, etc.) carry a `record_id` (`rec_[0-9a-f]{16}`).
- This is the exact, safe-fact source the handoff layer's autofill mapping
  reads from. It already existed and already solved "does the pack know the
  candidate's name/email/employment" before this design started — the
  handoff layer adds no new fact-extraction of its own.
- `source_artifacts` references `profile_snapshot`, `job_posting_snapshot`,
  `job_fit_result`, `application_intelligence_result` by `{artifact_id,
  artifact_type, content_id}`. The handoff layer never reads these directly;
  it reads only the already-embedded `candidate_snapshot`/`job`/
  `cv_content`/`cover_letter_content` inside the one pack it was given.

### 2.2 Renderer and render route

- `product/application_pack_renderer.py::render_application_pack(pack, *,
  source_pack_id) -> RenderedApplicationPack` is pure: no database access,
  no re-derivation of upstream artifacts. `RenderedFile` carries `kind`,
  `filename`, `content`, `mime_type`, `content_hash` (a real
  `sha256:<hex>` of the exact returned bytes, made deterministic by
  `_freeze_docx_bytes`). `RENDERER_VERSION = "application-pack-renderer.v1"`
  for v0 packs, `V1_RENDERER_VERSION = "application-pack-renderer.v2"` for
  v1 packs.
- `GET /api/workspaces/{workspace_id}/application-pack/render/{kind}`
  (`webapp/api/review.py`) accepts an optional `pack_artifact_id` query
  parameter. Omitted, it renders the current pack; supplied, it renders that
  exact historical artifact and never substitutes the current one. Ownership
  (`require_job_workspace(..., account_id=...)`) is checked before any
  artifact is read. Response is raw bytes with `Content-Disposition` and an
  `X-Content-Hash` header. This route is the handoff layer's **only** path
  to CV/cover-letter bytes; it is reused as-is.

### 2.3 Artifact and account model

- `webapp/persistence/artifacts.py`: every `save_artifact` call inserts a
  new row into `artifacts`; there is no in-place `UPDATE` of `payload_json`
  anywhere in the codebase. `application_pack` rows are immutable once
  created by construction, not by convention alone. `current_artifacts` is a
  separate pointer table, upserted independently.
- `webapp/services/ownership.py` / `webapp/api/dependencies.py`:
  `AccountScope { account_id, profile_root }` is resolved today from
  `Settings.account_id` (one configured account per running instance), not
  from a login/session system. `get_workspace(conn, workspace_id, *,
  account_id=...)` enforces ownership at the SQL predicate level (`WHERE id
  = ? AND account_id = ?`), and a cross-account lookup simply returns no
  row — the same 404 as "does not exist." There is no browser-cookie session
  to reuse; this design must not describe one.

### 2.4 Workflow status

- `webapp/persistence/workflow.py`: `TRACKER_STATUSES` includes `drafted`,
  `applied`, `interview`, `offer`, `hired`, `rejected`, `no_response`,
  `offer_declined`, `withdrawn`. `drafted` is reachable only through Gate 4
  (`confirm_application_pack`). `applied` requires the workspace's previous
  status to be exactly `drafted` and requires `submitted_pack_artifact_id`.
  `workflow_events` has no field today describing *how* an application was
  submitted (no external URL, no ATS identifier, no proof) — `applied` is
  currently a bare, self-reported status change. This is the actual gap
  this design fills; it is filled additively (Section 11), not by adding
  columns to `workflow_events`.

### 2.5 Existing test pattern

- `tests/webapp/test_browser_smoke.py` uses a `live_server` fixture (real
  `uvicorn.Server` on a background thread, fake LLM providers injected onto
  `app.state`) and drives a real Playwright `page` against it, asserting on
  rendered DOM and on downloaded file bytes. A helper,
  `_assert_no_private_browser_content`, asserts no secret/path leakage into
  rendered HTML. New Chrome acceptance tests for this design follow the
  same shape, plus new local fixture HTML pages simulating Greenhouse,
  Lever, and a generic form (Section 13) — no live ATS dependency.

### 2.6 Nothing to avoid duplicating

- No browser-extension, autofill, handoff, or submission-tracking code
  exists anywhere in the repository today. This feature is greenfield.

## 3. First-release user journey

```
confirmed pack (already exists)
        │
        ▼
user opens the extension's side panel on an employer application page
        │
        ▼
extension detects the page (named adapter or generic fallback)
        │
        ▼
user selects which workspace/pack this application is for
        │
        ▼
extension mints a handoff session bound to (account, workspace, exact
  pack_artifact_id, target URL/domain, adapter id+version)
        │
        ▼
safe-catalog fields (name/email/phone/LinkedIn/GitHub/location) are
  inserted automatically; adapter-specific unambiguous fields (e.g.
  Greenhouse's explicit "Most Recent Employer") may also autofill
        │
        ▼
"suggest" fields are shown as proposed answers in the extension panel only
  — nothing is written to the page until the user clicks Insert
        │
        ▼
"ask"/"never" fields (compensation, demographic, legal declarations,
  signatures, unrecognized fields) are left entirely untouched
        │
        ▼
user attaches the exact CV/cover-letter documents for this pack via the
  extension (rendered on demand from the render route)
        │
        ▼
user reviews the full field/attachment audit in the extension panel
        │
        ▼
user submits the application on the employer's own site (JobSearch never
  clicks that button)
        │
        ▼
user explicitly confirms "I submitted this" in the extension
        │
        ▼
a submission-confirmation record is created; the user may separately choose
  to mark the workspace `applied` via the existing, unmodified status action
```

## 4. Architecture

```
Employer tab (any origin)
  │  content script: reads DOM, matches an adapter, requests field
  │  decisions and file attachment from the background worker
  │  never holds a credential, never calls the JobSearch server directly
  ▼
Extension background/service worker
  │  owns the extension credential and per-session tokens
  │  the only component that talks to the JobSearch server
  │  durably queues unsent events (Section 9)
  ▼
HTTP → http://127.0.0.1:8420 (existing FastAPI app; no new server process)
  - new router:      webapp/api/handoff.py
  - new service:      webapp/services/handoff.py
  - new persistence:  webapp/persistence/handoff.py
  - reused as-is:     GET .../application-pack/render/{kind},
                       AccountScope resolution pattern, get_artifact,
                       get_current_artifact, record_status_change
  - new tables:       extension_credentials, handoff_sessions,
                       handoff_events, submission_confirmations
                       (migration 005_handoff_sessions)
```

No cloud relay. No new server process. The extension is a thin, narrowly
scoped HTTP client of the existing local FastAPI application; it does not
introduce a second backend or a new source of truth for pack content.

## 5. Trust model: pairing and per-handoff authorization

Two distinct credential lifetimes. Neither is a general authentication
redesign; both resolve to the same `AccountScope` concept the codebase
already has.

### 5.1 Extension pairing (long-lived, coarse-grained)

1. The user opens a "Connect extension" page in the JobSearch webapp,
   already resolved to an `AccountScope` the normal way.
2. The webapp generates a one-time pairing secret, displayed once. The
   server immediately stores only its hash in `extension_credentials`
   (`id`, `account_id`, `secret_hash`, `created_at`, `revoked_at`).
3. The extension exchanges that one-time secret for a durable extension
   credential in one HTTP call. The one-time secret is single-use and never
   stored raw. The durable credential is what the background worker keeps
   in `browser.storage.local`.
4. On every request, the durable credential resolves to an `AccountScope`
   exactly as `get_account_scope` resolves `Settings.account_id` today —
   via a header lookup instead of app configuration.
5. Revocable at any time from the webapp's "Connect extension" page
   (deletes the row / sets `revoked_at`).

### 5.2 Per-handoff session authorization (short-lived, fine-grained)

1. Before starting a handoff, the background worker presents its durable
   extension credential to mint a **handoff session**, scoped to exactly:
   `account_id` (from the credential) + `workspace_id` + exact
   `pack_artifact_id` + target URL/domain + adapter id/version.
2. The server returns a `handoff_session_id` — the actual identity of the
   session, never a `(workspace, domain)` pair — plus a short-lived session
   token bound to it.
3. All subsequent field-event/attachment-event/confirmation calls for that
   application present the session token, not the long-lived extension
   credential, limiting blast radius if one session's token leaks.

A `(workspace_id, target_domain)` query exists only as a **discovery**
convenience — "is there an unfinished session here I could resume?" — and
is never used as the session's identity or as an implicit authorization
path.

## 6. Exact-pack invariant

The handoff layer operates on one exact confirmed `application_pack`
artifact, identified by `pack_artifact_id`, captured once at session
creation (Section 5.2) and never changed for the lifetime of that session.

It must never:

- render from the current Evidence Profile, Job Fit, or Application
  Intelligence result;
- query current Job Fit or Application Intelligence to reconstruct or
  regenerate answers;
- substitute a newer current pack for an explicitly pinned historical one;
- silently regenerate CV or cover-letter content.

If a newer pack is confirmed for the same workspace while a handoff session
is open, the session's `pack_artifact_id` does not change. The extension
UI may show an informational banner ("A newer application pack now exists
for this job. This session is still using the one you started with.") but
never swaps the artifact automatically. The user may finish the original
session or explicitly abandon it and start a new one against the newer
pack.

This mirrors, and is directly enforced by, the render route's existing
historical-pack behavior (Section 2.2) — the handoff layer adds no new
enforcement mechanism, it simply always calls that route with an explicit
`pack_artifact_id`, never omitting it once a session exists.

## 7. Document attachment model

- CV and cover-letter bytes are obtained by calling the existing render
  route on demand, with the session's pinned `pack_artifact_id`, each time
  they are needed (session start, and again immediately before an upload
  attempt, to guard against a long-idle session). Rendering is already
  proven byte-deterministic for a given `(pack_artifact_id,
  renderer_version)`, so re-rendering is equivalent to caching.
- No new artifact type is introduced. No rendered file bytes are persisted
  by the handoff layer. What is persisted is a record sufficient to prove
  later which exact file was used:
  `pack_artifact_id`, `renderer_version`, `filename`, `mime_type`,
  `sha256`, `byte_length`, plus an honest `outcome`.
- Filenames are exactly whatever `RenderedFile.filename` produced (already
  sanitized, deterministic, derived from company/title) — the handoff layer
  invents no filename convention of its own.
- **Attachment outcome vocabulary** (deliberately not a boolean, because a
  file input accepting bytes does not prove the ATS's own asynchronous
  upload completed):
  - `selected` — the extension successfully set the file input / triggered
    the file-picker interaction. Proves attempt, not ATS-side completion.
  - `upload_confirmed_by_adapter` — the adapter additionally observed a
    page-specific success signal (e.g. a filename chip, a completed
    progress indicator). Only available where an adapter implements that
    check.
  - `rejected` — the page visibly rejected the file (adapter-observed error
    state).
  - `unknown` — no observable signal either way. This is the honest default
    when an adapter has no upload-confirmation capability; it is never
    upgraded to `selected`-implies-success.

## 8. Field classification and the closed autofill policy

Four behaviors. `behavior` is decided **only** by a closed policy — never by
a confidence score, and confidence itself is not a stored field anywhere in
this design (a diagnostic confidence signal, if ever needed for tuning the
generic fallback, belongs in developer-facing adapter test output, not in
`FieldDecision`, where it could be mistaken for authorization).

| Behavior | Authorized by | Effect |
|---|---|---|
| `autofill` | (a) exact match against the shared six-field safe catalog, or (b) an adapter's own explicit, versioned rule for an ATS field whose target meaning is unambiguous | Value written to the DOM automatically |
| `suggest` | an adapter rule that explicitly opts a field into "propose, don't insert" | Value shown only in the extension panel; **no DOM write occurs until the user clicks Insert** |
| `ask` | default for anything not matched above, including all generic-fallback misses | Field is surfaced/highlighted for the user; JobSearch never fills or copies its value |
| `never` | pattern match against legal/declaration/certification/signature language | Field is never touched, never surfaced as fillable |

### 8.1 The shared safe catalog

Exactly six fields, universal across all adapters: **name, email, phone,
LinkedIn, GitHub, location.** Nothing else is ever universally
autofillable. Employment/education fields (e.g. "most recent employer") are
never in the shared catalog — they may only be marked `autofill` inside a
specific adapter's own rule set, and only where that ATS's form makes the
target field's meaning unambiguous (an explicit "Most Recent Employer"
label, not a generically-named "Employer" field that could mean any of
several roles).

### 8.2 Generic fallback, strict defaults

- Unknown field → `ask` (not `never` — worth surfacing so the user notices
  it exists, without JobSearch touching it).
- Legal/declaration/signature/certification pattern match → `never`.
- Escalation to `autofill` requires an exact match against the shared
  six-field catalog. There is no heuristic path that promotes a
  non-catalog field to `autofill` in the generic adapter. This is a
  structural rule enforced by the adapter's code shape, not a policy
  statement that could be silently violated by a future heuristic tweak.

### 8.3 `FieldDecision`

```
FieldDecision {
  normalized_field_type: string
  behavior: "autofill" | "suggest" | "ask" | "never"
  mapping_reason: string          # human-readable rationale, e.g.
                                   # "shared safe catalog: contact.email"
                                   # "adapter rule: greenhouse most_recent_employer"
                                   # "pattern match: certification/signature language"
                                   # "generic fallback: unmatched field, default ask"
  source_kind: "safe_fact" | "adapter_rule" | "generic_fallback" | "none"
  requires_user_approval: bool    # true for suggest; false otherwise
  adapter_id: string              # "greenhouse" | "lever" | "generic"
  adapter_version: string         # e.g. "greenhouse@1"
}
```

`map(field, candidate_snapshot) -> value | null` runs only for
`autofill`/`suggest` decisions. If no safe-catalog value actually exists for
this candidate (e.g. no GitHub on file), the decision degrades to `ask` —
never to a blank silent autofill.

## 9. Adapter interface and site-support strategy

V1 ships two named adapters (Greenhouse, Lever) plus one generic fallback,
deliberately not "every careers site":

```
Adapter (versioned, e.g. "greenhouse@1")
  detect(document) -> bool
  scan(document) -> DetectedField[]           # {page_field_key, label_text, dom locator}
  classify(field) -> FieldDecision            # pure, no DOM/network access
  map(field, candidate_snapshot) -> value|null # pure
  detectLikelySuccess(document) -> bool       # optional; Section 12
```

- `detect`/`scan` run in the content script (DOM access required).
- `classify`/`map` are pure functions, testable against fixture
  HTML/JSON with no live DOM or network — matching the requirement that
  acceptance testing never depend on live Workday/Greenhouse/Lever sites.
- Each adapter's version string is recorded on every session and every
  event it produces, so a DOM change that breaks an adapter's selectors is
  visible as "adapter version X started producing zero/garbage
  detections" against a frozen fixture, not a silent bad-fill in
  production.
- Workday and generic company-hosted forms fall to the generic adapter only
  in v1 — named here as an explicit non-goal to revisit in a later release,
  not a gap this design pretends to close.

## 10. Field identity

Two identifiers per field, never conflated:

- `normalized_field_type` — semantic type, used for classification
  (`"email"`, an indexed employment path, etc.).
- `page_field_key` — adapter-defined, DOM-page-local identity (e.g.
  `"greenhouse:application:email"`, `"lever:eeo:disability_status"`),
  stable only within one handoff session, used to correlate multiple
  events about the same physical field on a page that may repeat field
  types (multiple employment rows, several free-text questions of the same
  semantic type, etc.). A `normalized_field_type` alone is insufficient on
  forms with repeated or indexed fields.

## 11. Event-sourced provenance model

The audit is an append-only event log per handoff session. A field's
current state is derived by replaying its events; nothing is ever mutated
in place to represent "this changed."

### 11.1 Event identity and ordering — server-authoritative

```json
{
  "event_id": "evt_...",
  "handoff_session_id": "hs_...",
  "server_sequence": 42,
  "recorded_at": "2026-08-24T14:03:11.402Z",
  "observed_at": "2026-08-24T14:03:10.900Z"
}
```

`event_id` is client-generated and used only as an idempotency key.
`server_sequence` is assigned atomically by the server on insert and is the
canonical order for any derivation logic. `recorded_at` (server receipt
time) is canonical; `observed_at` (client-reported) is retained for
diagnostics only and is never authoritative for ordering or for "when did
this really happen."

### 11.2 Event types — observations and actions, never conclusions

```
field_detected
suggestion_presented
user_approved_insert
value_inserted
value_observed                -- a DOM read at a checkpoint
user_value_present_observed   -- user has content in an ask/never field; no value captured
upload_selected
upload_confirmed
upload_failed
target_unresolved
submission_success_observed   -- adapter's passive success-page detection; never auto-confirms
```

There is no `later_value_changed` or `user_modified_after` field or event
anywhere in storage. "Was this field modified after JobSearch inserted it?"
is answered at read time by replaying the ordered `value_inserted`/
`value_observed` events for a given `page_field_key` — never written down
as a stored conclusion. Similarly, "attached" is never stored as a
boolean conclusion; it is the `upload_selected`/`upload_confirmed`/
`upload_failed` event sequence itself (Section 7).

### 11.3 Sensitive-value minimization

- `value_inserted` (JobSearch wrote it) — records the exact value. Proving
  what the system did is the entire point of the audit.
- `value_observed` on a JobSearch-sourced field — records the exact value,
  needed to detect drift from what was inserted.
- `user_value_present_observed` on an `ask`/`never`/user-owned field —
  records only `normalized_field_type` + `page_field_key` + the fact that
  content is present, **never the value**. This applies specifically and
  deliberately to compensation, demographic, disability, veteran status,
  work authorization, and legal-declaration/free-text fields the user
  filled independently.

**Governing rule:** persist the exact value when JobSearch supplied it;
minimize to presence-only when the user supplied it independently. The
content script's technical ability to read a DOM value is not, by itself, a
reason to store it.

### 11.4 Provenance binding, exact

```json
{
  "event_type": "value_inserted",
  "normalized_field_type": "email",
  "page_field_key": "greenhouse:application:email",
  "decision": {
    "behavior": "autofill",
    "mapping_reason": "shared safe catalog: contact.email",
    "source_kind": "safe_fact",
    "requires_user_approval": false,
    "adapter_id": "greenhouse",
    "adapter_version": "greenhouse@1"
  },
  "value": "shola@example.com",
  "provenance": {
    "pack_artifact_id": "art_XYZ",
    "candidate_snapshot_path": "contact.email",
    "provenance_ids": ["clm_a1b2c3d4e5f6..."]
  }
}
```

For a `suggest`-derived value not copied verbatim from the pack (e.g. a
computed "years of experience"), `provenance` additionally carries
`derivation_id` and `derivation_version` (e.g.
`"years_of_experience_from_employment_dates@1"`), so a computed value can
never be mistaken for a literal candidate-snapshot fact.

### 11.5 Idempotency, strict

`UNIQUE(handoff_session_id, event_id)` at the database level. A retried
delivery of the same `event_id` is a no-op returning the original result.
The extension is contractually forbidden from minting a new `event_id` to
resolve a network ambiguity — the same locally-queued event, with its
original `event_id`, is retried as-is until acknowledged.

## 12. Submit-boundary state machine

```
detected → prepared → partially_filled ⇄ user_reviewing → ready_for_user_review
                                                                    │
                                        (adapter may observe a likely   │
                                         ATS success page — context     │
                                         only; never auto-transitions)  │
                                                                    ▼
                                          user_confirmed_submitted (terminal, explicit action)
                                                                    │
                                          abandoned / expired (terminal, alternate exits)
```

- `prepared`: session minted; safe fields identified; nothing written to
  the DOM yet.
- `partially_filled`: autofill values inserted; suggestions computed but
  held in the extension panel only.
- `user_reviewing`: user has opened the panel; suggestion Insert actions
  happen here.
- `ready_for_user_review`: JobSearch has finished everything it will do —
  every field has a terminal-for-now decision, every attachment attempt has
  a recorded outcome. This is a statement about JobSearch's completeness,
  **not** about the user having reviewed anything. Reaching it unlocks the
  "I submitted this" control but does not itself enable or imply
  submission.
- `submission_success_observed` (an event, not a state) may fire if an
  adapter recognizes a likely ATS confirmation page. This is surfaced as a
  passive UI nudge ("It looks like this went through — confirm
  submission?") and never calls the confirmation endpoint itself.
  Observation informs; it never authorizes.
- Multi-page ATS forms loop `prepared ⇄ partially_filled ⇄ user_reviewing`
  across pages under one unchanged `handoff_session_id`.
- Only the user's own explicit confirmation action produces
  `user_confirmed_submitted` and a `submission_confirmations` row. Filling
  a form does not equal applying. Uploading a CV does not equal applying.
  Opening the employer site does not equal applying. Detecting a likely
  success page does not equal applying. JobSearch never clicks the
  employer's own submit button.
- If the user separately chooses to update workflow status to `applied`,
  that uses the existing, entirely unmodified `record_status_change(...,
  new_status="applied", submitted_pack_artifact_id=...)` call. This design
  adds no new path to `applied` and no automatic transition into it.

## 13. Durable, idempotent event delivery

A Manifest V3 background service worker can be killed and restarted at any
time; in-memory queuing of unsent events is unsafe.

- Every event is assigned a stable client-generated `event_id` at creation
  time, before any network attempt.
- Unsent events are persisted to `chrome.storage.local` (or IndexedDB for
  larger payloads) immediately, keyed by `event_id`, and removed from the
  local queue only after the server acknowledges receipt.
- The ingestion endpoint (`POST
  /api/handoff/sessions/{id}/events`) is idempotent on `event_id`
  (`UNIQUE(handoff_session_id, event_id)`, Section 11.5) — a duplicate
  delivery is accepted as a no-op.
- On service-worker wake (browser restart, extension reload, scheduled
  alarm), the worker re-reads its local queue and retries in original
  order, using a client-side monotonic counter to preserve intended order
  even though the server assigns the canonical `server_sequence`.
- This queue is durable across the exact failure mode a service worker is
  prone to, because the source of truth for "what happened" lives in
  `chrome.storage.local` until the server has durably confirmed it — never
  in worker memory alone.

## 14. Failure and recovery behavior

| Scenario | Behavior |
|---|---|
| Page reload / browser crash | Content script re-injects; background worker issues a discovery query on `(workspace_id, target_domain)` (never an identity lookup); offers "Resume" by `handoff_session_id` if found and accepted, else starts fresh. |
| Multi-page ATS flow | Same `handoff_session_id` persists across pages; events accumulate under it. |
| Unsupported / unrecognized field | Classified `ask` by the generic fallback; never escalated. |
| Upload failure | `upload_failed` event appended; session state does not advance as if attachment succeeded. |
| User navigates away mid-session | Session remains `in_progress`; discoverable for resume on return; eventually reaches `expired` if abandoned long enough. |
| Browser crash | As "page reload" — recovery is via the durable local event queue (Section 13) and server-side session state, not in-memory recovery. |
| Employer site reloads | As "page reload." |
| Login wall / CAPTCHA | Out of scope by design. The content script never interacts with login or CAPTCHA elements; it waits passively until an actual application form is reachable. |
| Multi-page forms | Handled by session persistence across page transitions (above). |
| Exact pack becomes historical mid-session | No effect on the session (Section 6) — informational banner only, never a substitution. |
| Network interruption | Handled by the durable idempotent queue (Section 13); the panel shows "not yet saved" rather than a false success. |
| Unrecognized ATS | All named adapters' `detect()` fail; generic fallback is tried; if it also finds no recognizable form, no session is minted and the extension reports "No application form detected." |
| Stale DOM mid-session | `scan()` re-runs on significant DOM mutation; a field whose `page_field_key`/locator no longer resolves gets a `target_unresolved` event appended. Its earlier `field_detected`/`value_inserted` events are untouched. |

Governing rule across all scenarios: a visibly incomplete or failed state is
always preferable to a state that merely looks successful.

## 15. Submission record and its relationship to workflow status

### 15.1 What the record answers

The persisted data must be able to answer, for any past application:

> "Which exact CV and cover letter did this user use, what did JobSearch
> actually insert into the form, what did the user change afterward, and
> was it really submitted?"

This is answered entirely by replaying `handoff_events` for a
`handoff_session_id`, plus the single `submission_confirmations` row if the
user confirmed submission. No separate "summary" record is needed or
created.

### 15.2 Relationship to `workflow_events`

`workflow_events` remains exactly as it is today — unchanged schema,
unchanged semantics, the sole and unmodified path to `applied`. This design
does not add columns to it. Instead, `submission_confirmations` is an
append-only link table: one row per user-confirmed submission, referencing
`handoff_session_id` and, optionally (nullable), the `workflow_event_id`
produced if the user also chose to mark the workspace `applied` in the same
flow. A user may confirm a submission without immediately updating workflow
status; that remains valid, exactly as "applied" today already requires its
own explicit action independent of any drafting activity.

## 16. Persistence and migration decision

A migration is justified here, unlike a purely presentational ticket: this
design introduces genuine new durable domain state — records of real-world
actions the user performed outside the system (visited a page, had a value
inserted, attached a file, clicked submit) — the same category of durable
fact `workflow_events` already represents, not an authentication or
UI-only concern. `extension_credentials` is the only table resembling
authentication, and it is narrowly scoped to "does this bearer token
resolve to an `AccountScope`," identical in purpose to how
`Settings.account_id` already resolves one today, just sourced from a
request header instead of app configuration.

```sql
-- migration 005_handoff_sessions

CREATE TABLE extension_credentials (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    secret_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE handoff_sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    pack_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    target_url TEXT NOT NULL,
    target_domain TEXT NOT NULL,
    ats_adapter_id TEXT NOT NULL,
    ats_adapter_version TEXT NOT NULL,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL,              -- in_progress | abandoned | expired | user_confirmed_submitted
    user_confirmed_submitted_at TEXT
);

CREATE TABLE handoff_events (
    handoff_session_id TEXT NOT NULL REFERENCES handoff_sessions(id),
    event_id TEXT NOT NULL,
    server_sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    normalized_field_type TEXT,
    page_field_key TEXT,
    event_json TEXT NOT NULL,
    observed_at TEXT,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (handoff_session_id, event_id),
    UNIQUE (handoff_session_id, server_sequence)
);

CREATE TABLE submission_confirmations (
    id TEXT PRIMARY KEY,
    handoff_session_id TEXT NOT NULL REFERENCES handoff_sessions(id),
    workflow_event_id TEXT REFERENCES workflow_events(id),
    created_at TEXT NOT NULL
);
```

Notes:

- `handoff_events` is one table for every event type (field and
  attachment alike); they share an identical append-only, idempotent,
  server-sequenced shape, so splitting attachment events into a second
  table would be a redundant schema concept, not additional safety.
- `event_json` is JSON **inside one immutable event row** (the decision,
  value if applicable, and provenance for that one event) — never a JSON
  blob representing an entire session's mutable, rewritten history. This
  is the deliberate distinction: JSON as the payload of an immutable fact
  is fine; JSON as the whole audit trail, mutated in place, is not, and no
  table here does the latter.
- `handoff_sessions.status` is the one intentionally mutable field in this
  schema, transitioning `in_progress → {abandoned, expired,
  user_confirmed_submitted}`. This is acceptable because it is a cached,
  derived summary ("has this session reached a terminal event"), never
  itself the source of truth — the actual proof of what happened always
  lives in `handoff_events`, which is never updated once written.
- `workflow_events`: zero columns added, zero semantic changes.
- No existing table (`artifacts`, `current_artifacts`, `workflow_events`,
  `workspaces`, `accounts`) is altered by this migration beyond the new
  foreign-key references from the new tables.

## 17. Privacy and security model

- **Minimum data released to the extension**: a session-minting response
  contains only the specific `candidate_snapshot` paths the matched
  adapter's field rules actually need for the current page — never the
  full pack, never other workspaces, never other accounts. There is no
  endpoint that returns "the current profile" or "the current pack" in
  bulk to the extension; this is a structural non-goal, not merely a
  policy, since it is the natural shortcut a future implementer might
  otherwise reach for.
- **No unrelated Evidence Profile claims exposed**: the extension never
  receives raw `profile_snapshot` artifacts, Job Fit results, or
  Application Intelligence content — only the specific `candidate_snapshot`
  leaves an adapter actually mapped, each already provenance-tagged.
- **No API keys in browser state**: the extension holds only its own
  durable extension credential and per-session tokens (Section 5) — never
  the server's `OPENAI_API_KEY` or any provider secret, which never leaves
  the server process.
- **Authorization before pack access**: every session-minting request
  resolves `AccountScope` from the extension credential before touching
  `workspace_id`/`pack_artifact_id`, mirroring the render route's existing
  ownership-before-artifact-read order exactly (Section 2.3).
- **Cross-account isolation**: an extension credential tied to account A
  cannot mint a session against account B's workspace — enforced by the
  same SQL-predicate mechanism (`WHERE ... AND account_id = ?`) as the rest
  of the app, not a post-hoc check.
- **Origin/domain handling and narrow permissions**: content scripts are
  injected only into tabs the user has explicitly granted access to
  (`activeTab` / explicit host patterns), never a blanket `<all_urls>`
  permission by default.
- **No arbitrary site can query JobSearch data**: the employer's own page
  JavaScript has no access to the extension's background worker or its
  credential; content-script-to-background communication uses the
  extension's internal messaging API, unreachable from page scripts.
- **Independently entered sensitive answers are not stored**: per Section
  11.3, compensation, demographic, disability, veteran status, work
  authorization, and legal-declaration content the user answers
  independently is recorded as presence-only, never with its value,
  regardless of the content script's technical ability to read it.
- **No unnecessary logging**: server logs record event type, field type,
  and adapter/version at normal levels. The `value` inside a
  `value_inserted` event is persisted only inside that event's own row,
  never duplicated into general application logs.

## 18. Non-goals and protected boundaries

This design does not implement or redesign, and must not require changes
to:

- manual CV/cover-letter editing, presentation controls, or renderer
  formatting (Codex's stream);
- the Application Pack content or versioning contract itself
  (`product/application_pack_contract.py`,
  `product/application_pack_renderer.py`);
- the Evidence Profile editor;
- a general authentication/session system (the pairing model in Section 5
  is additive and scoped narrowly to extension access, not a login system);
- discovery automation, Job Fit, Application Intelligence, or Gate 4
  thresholds;
- staleness semantics (`check_staleness` / dependency fingerprints);
- `workflow_events` schema or the existing `applied` transition rules;
- post-application interview tooling;
- autonomous/unattended job-application submission — the user always
  performs the final submit action on the employer's own site, and always
  performs a separate, explicit confirmation afterward.

If implementation later finds that any of the above must change to make
handoff work, that is a stop-and-report condition, not something to
resolve by editing those areas directly.

## 19. Interface dependencies on Codex's stream

Handoff requires, as an interface contract only (never as code this design
owns or duplicates):

- an exact, immutable confirmed Application Pack artifact, reachable by
  `pack_artifact_id`, with `candidate_snapshot` safe-fact structure at
  least as rich as `application-pack.v1` provides today;
- a rendering API that returns exact bytes plus a content hash for a given
  `pack_artifact_id`, supporting both current and explicit historical
  lookups, with ownership enforced before artifact access — satisfied
  today by the existing render route as-is.

If Codex's stream later changes the pack's shape or introduces a new
"final presentation" contract, this handoff layer should be updated to
consume whatever immutable confirmed artifact the application then defines
— it must not fork or duplicate that definition itself.

## 20. Chrome acceptance-test matrix

Fixture-driven; no live Workday/Greenhouse/Lever dependency. New local
fixture HTML pages simulate a Greenhouse-shaped form, a Lever-shaped form,
and a generic unfamiliar form, following the existing `live_server` /
Playwright `page` pattern from `tests/webapp/test_browser_smoke.py`.

| Test | Proves |
|---|---|
| `test_greenhouse_fixture_autofills_only_safe_catalog` | Only name/email/phone/LinkedIn/GitHub/location get `value_inserted` on the Greenhouse fixture; everything else gets `field_detected` only. |
| `test_lever_fixture_autofills_only_safe_catalog` | Same proof on the Lever fixture, confirming the safe-catalog policy is adapter-independent. |
| `test_generic_fallback_never_escalates_beyond_safe_catalog` | On an unfamiliar fixture form, only exact safe-catalog matches autofill; everything else defaults to `ask`, never promoted by any heuristic. |
| `test_suggestion_requires_explicit_insert_before_dom_write` | A `suggest` field produces `suggestion_presented` with the DOM untouched; only a simulated Insert click produces `user_approved_insert` then `value_inserted`. |
| `test_legal_and_signature_fields_never_activated` | Certification checkboxes/signature fields receive zero click/write events across a full autofill pass; DOM state is unchanged. |
| `test_ask_field_user_entry_is_presence_only` | Typing into a compensation/demographic fixture field produces a `user_value_present_observed` event with no `value` key present in `event_json`. |
| `test_value_drift_detected_without_mutating_original_event` | After `value_inserted`, directly editing the DOM value and triggering a checkpoint produces a new `value_observed` event; the original `value_inserted` row is byte-identical to what was first recorded. |
| `test_attachment_records_exact_pack_hash` | A simulated file-input interaction produces an `upload_selected` (and, where the fixture simulates a signal, `upload_confirmed`) event whose `sha256`/`pack_artifact_id`/`renderer_version`/`byte_length` match an independent direct call to the render route for the same `pack_artifact_id`. |
| `test_real_submit_button_never_clicked` | The fixture submit button's test-only click counter stays zero through a full flow to `ready_for_user_review`, including a simulated `submission_success_observed`. |
| `test_success_page_detection_never_creates_applied` | `detectLikelySuccess` firing on a fixture confirmation page creates no `submission_confirmations` row and no workflow status change until a separate, explicit confirmation is simulated. |
| `test_explicit_confirmation_creates_submission_record` | Simulating "I submitted this" produces exactly one `submission_confirmations` row; if status update is also requested, `workflow_events` is written via the existing, unmodified `record_status_change` path. |
| `test_event_retry_is_idempotent` | POSTing the same `(handoff_session_id, event_id)` twice results in exactly one `handoff_events` row and an identical response both times. |
| `test_resume_keyed_by_session_id_not_domain` | Two workspaces pointed at the same employer domain each get distinct `handoff_session_id`s; resuming one never surfaces or attaches to the other's session. |
| `test_pack_pinned_across_newer_confirmation` | Confirming a second pack mid-session leaves all subsequent events citing the original `pack_artifact_id`; no silent substitution. |
| `test_cross_account_denial` | An extension credential for account B cannot mint a session against account A's workspace/pack — 404, no `handoff_sessions` row created, matching the existing render-route cross-account pattern. |
| `test_no_sensitive_value_or_secret_leakage` | Extension-adjacent HTTP payloads and rendered extension UI never contain the server's `OPENAI_API_KEY`, other accounts'/workspaces' data, or the raw value of any `ask`/`never` field — adapts the existing `_assert_no_private_browser_content` helper. |

## 21. Unresolved product questions and risks

- **Session expiry duration** is not fixed by this design (an inactivity
  timeout is required, Section 14, but the exact threshold is an
  implementation-plan decision, tunable without changing the contract).
- **Which specific adapter-only employment/education fields are
  "unambiguous enough" for autofill** is adapter-specific judgment to be
  made against real Greenhouse/Lever form fixtures during implementation,
  not fully enumerable in this design.
- **Extension packaging/distribution** (Chrome Web Store review, update
  cadence) is out of scope for this design and is a separate operational
  concern.
- **Multi-account browser profiles**: if a user runs multiple JobSearch
  accounts from the same browser, each would need its own paired extension
  credential; this design assumes one paired credential per browser
  profile and does not attempt to solve multi-account-in-one-browser-
  profile UX.
- **What happens to an `in_progress` session if the underlying workspace or
  pack artifact is later deleted** is not addressed — deletion of
  artifacts is not currently a capability elsewhere in the codebase, so
  this is deferred rather than designed against a feature that does not
  yet exist.
