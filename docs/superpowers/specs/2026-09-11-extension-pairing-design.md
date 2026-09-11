# Extension Pairing — Design Specification

## 1. Goal

Let a normal user pair the Application Handoff browser extension with their
local JobSearch web app without DevTools, `curl`, or manually editing
`chrome.storage.local`. `CredentialStore` must be populated through a
supported, user-facing flow.

**Acceptance gate:** *A normal user can pair the extension with the local
JobSearch web app without DevTools, curl, or manually editing
`chrome.storage.local`, and `CredentialStore` is populated through the
supported flow.*

This is Sub-project 1 of two (Approach B, PM-approved 2026-09-11). It does
**not** remove the existing `MANUAL_TEST_SNAPSHOT_KEY` /
`MANUAL_TEST_SESSION_ID_KEY` bridge in `extension/src/background/index.ts`
— that stays until Sub-project 2 (session-start + attachment integration)
replaces it. Section 9 documents Sub-project 2's interface boundary only;
its full implementation spec is written after this sub-project ships and is
verified, against the real merged pairing implementation rather than an
assumed one.

## 2. Verified current state

Investigated at `master` commit `e92334c` (PR #23, extension runtime
wiring, merged).

### 2.1 Server-side pairing already exists, but is not wired to anything

- `webapp/services/handoff.py::generate_pairing_secret()` returns
  `secrets.token_urlsafe(32)`.
- `webapp/services/handoff.py::exchange_pairing_secret_for_credential(conn,
  *, account_id, one_time_secret)` mints a fresh durable secret
  (`secrets.token_urlsafe(32)`), stores only its hash via
  `create_extension_credential`, and returns `{credential_id,
  durable_secret}` to the caller once.
- **Defect found during this design's investigation:** the
  `one_time_secret` parameter is accepted but never checked against
  anything. `generate_pairing_secret()`'s return value is never persisted.
  Any string submitted to `exchange` succeeds and mints a credential, gated
  only by `account_id` (which is always the single configured account —
  see `webapp/api/dependencies.py::get_account_scope`). This means pairing
  today has no actual code-based gate at all. **This design fixes that**
  (Section 5) — confirmed in scope by PM decision, since a pairing UI would
  otherwise visibly not do anything the code claims.
- `webapp/api/handoff.py` already exposes `POST /api/handoff/pairing/generate`
  (guarded by `get_account_scope`) and `POST /api/handoff/pairing/exchange`
  (also guarded by `get_account_scope` — see Section 4 for why this must
  change).
- `webapp/persistence/handoff.py::hash_pairing_secret`,
  `create_extension_credential`, `get_extension_credential_by_hash`,
  `revoke_extension_credential` are complete and unchanged by this design.

### 2.2 Extension side has no popup and no pairing client code

- `extension/manifest.json`'s `action` has no `default_popup` — clicking
  the toolbar icon fires `chrome.action.onClicked`
  (`extension/src/background/index.ts`), which immediately injects the
  candidate snapshot and content-script bundle into the active tab if the
  `MANUAL_TEST_*` storage keys are set.
- `extension/src/background/server-client.ts`'s `ServerClient` class has
  `startSession`, `sendEvent`, `confirmSubmission` — no `exchangePairing`
  method, and no method calls any `/api/handoff/pairing/*` route.
- `extension/src/background/credential-store.ts`'s `CredentialStore` has
  `get`/`set`/`clear` against `chrome.storage.local` key
  `handoff_extension_credential` — already correct and unchanged by this
  design; this is what a real pairing flow must populate.
- No `extension/popup.html` or `extension/src/popup/` directory exists.

### 2.3 Webapp side has no pairing page

- No route in `webapp/api/*.py` renders a pairing page. `webapp/templates/`
  has no `pairing.html`.
- `webapp/templates/base.html`'s nav (line 21) lists: Dashboard, How it
  works, Manage searches, Evidence Profile, Help. No entry for
  extension/pairing.
- `get_account_scope` (`webapp/api/dependencies.py:30-45`) resolves a
  single hardcoded account — there is no session/login system, and the
  design spec that governs the whole handoff feature
  (`docs/superpowers/specs/2026-08-24-application-handoff-design.md`,
  Section 18) explicitly lists "a general authentication/session system"
  as **out of scope**, deferred to the pairing model itself as the
  boundary. The server binds to `127.0.0.1:8420` only (confirmed in
  `extension/src/background/server-client.ts:3`'s `BASE_URL` and
  `extension/manifest.json`'s `host_permissions`).

## 3. Trust model for this design

Per the existing, already-accepted system trust model (Section 2.3 above),
there is no per-request authentication layer distinguishing "the webapp UI
that showed you the code" from "the extension popup submitting it" —
both run on the same machine, and the server is reachable only via
loopback. Confirmed by PM decision 2026-09-11: **no new auth mechanism is
added.** The one-time pairing code, once made genuinely single-use and
short-lived (Section 5), is the complete security boundary for this
operation — identical in kind to how `CredentialStore`'s durable secret is
the complete boundary for every other handoff API call.

This means `POST /api/handoff/pairing/exchange` changes from requiring
`get_account_scope` (webapp-session-shaped, but actually just
"the one configured account") to requiring **no account-scope dependency
at all** — the account is resolved implicitly by which account's
`pairing_secrets` row the presented code hashes to (Section 5.2), the same
pattern `resolve_account_scope_from_extension_credential` already uses for
`get_extension_scope`. `POST /api/handoff/pairing/generate` keeps
`get_account_scope` — it's invoked by the webapp page itself, which is
already implicitly "logged in" as the one configured account by virtue of
being served at all.

## 4. Popup replaces bare `onClicked`

Chrome fires `chrome.action.onClicked` only when the manifest's `action`
has no `default_popup`. Adding a popup (required to host the paste-code
UI) means the existing single-click "inject and autofill" behavior can no
longer fire directly on icon click.

**Confirmed by PM decision 2026-09-11:** the popup absorbs this. New
behavior:

- Click the toolbar icon → popup opens.
- **If `CredentialStore.get()` returns a credential:** popup shows
  "Paired ✓" plus a **"Run autofill on this tab"** button. Clicking it
  performs exactly what `onClicked` does today — the popup's click handler
  sends a `chrome.runtime` message the background worker already listens
  for (Section 6.3), rather than duplicating the injection logic in the
  popup itself.
- **If `CredentialStore.get()` returns `null`:** popup shows the pairing
  form (paste-code input + "Pair" button) instead.

This is a one-extra-click regression versus today's immediate injection,
accepted as the cost of adding pairing UI at all — not treated as a defect
to work around.

## 5. Server-side: real one-time-secret validation

### 5.1 New table: `pairing_secrets`

Migration `007_pairing_secrets`, following the exact pattern of migration
`005_handoff_sessions`'s `extension_credentials` table
(`webapp/persistence/migrations.py:219-228`):

```sql
CREATE TABLE pairing_secrets (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    secret_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
);

CREATE INDEX idx_pairing_secrets_hash ON pairing_secrets(secret_hash);
```

- `secret_hash` reuses the existing `hash_pairing_secret()` function
  (`webapp/persistence/handoff.py:15-16`) — same `sha256:<hex>` format
  already used for `extension_credentials.secret_hash`. The plaintext code
  is never persisted, matching the existing pattern.
- `expires_at`: `created_at + 10 minutes`. Ten minutes is generous for
  "open a popup and paste a code" while keeping the window meaningfully
  short; not user-configurable at this scope.
- `consumed_at`: set on first successful exchange. A second exchange
  attempt with the same code fails (Section 5.3) — enforces single-use.

### 5.2 `generate_pairing_secret` — now persists

```python
def generate_pairing_secret(
    conn: sqlite3.Connection, *, account_id: str, commit: bool = True,
) -> str:
    secret = secrets.token_urlsafe(32)
    secret_id = f"pairsec_{uuid.uuid4().hex[:20]}"
    now = _now()
    expires_at = (
        datetime.now(timezone.utc) + timedelta(minutes=10)
    ).isoformat()
    conn.execute(
        "INSERT INTO pairing_secrets "
        "(id, account_id, secret_hash, created_at, expires_at, consumed_at) "
        "VALUES (?, ?, ?, ?, ?, NULL)",
        (secret_id, account_id, hash_pairing_secret(secret), now, expires_at),
    )
    if commit:
        conn.commit()
    return secret
```

Signature change from today's zero-argument `generate_pairing_secret()` —
this is a breaking change to that function's callers. The only caller is
`webapp/api/handoff.py::post_generate_pairing` (Section 6.1), updated in
the same change.

### 5.3 `exchange_pairing_secret_for_credential` — now validates

```python
class PairingSecretExpired(HandoffError):
    pass


def exchange_pairing_secret_for_credential(
    conn: sqlite3.Connection, *, one_time_secret: str,
) -> dict[str, Any]:
    secret_hash = hash_pairing_secret(one_time_secret)
    row = conn.execute(
        "SELECT * FROM pairing_secrets WHERE secret_hash = ?", (secret_hash,)
    ).fetchone()
    if row is None:
        raise PairingSecretInvalid("pairing code not recognized")
    if row["consumed_at"] is not None:
        raise PairingSecretInvalid("pairing code already used")
    if row["expires_at"] < _now():
        raise PairingSecretExpired("pairing code expired")

    conn.execute(
        "UPDATE pairing_secrets SET consumed_at = ? WHERE id = ?",
        (_now(), row["id"]),
    )
    durable_secret = secrets.token_urlsafe(32)
    credential = create_extension_credential(
        conn, account_id=row["account_id"],
        secret_hash=hash_pairing_secret(durable_secret),
    )
    conn.commit()
    return {"credential_id": credential["id"], "durable_secret": durable_secret}
```

**Signature change:** drops the `account_id` parameter — the account is
now resolved from the `pairing_secrets` row itself (the account that
generated the code), not from a caller-supplied scope. This is what
removes the `get_account_scope` dependency from the API route
(Section 3, Section 6.2).

`PairingSecretExpired` is a new exception, translated to HTTP 400 by the
existing `_translate` helper (`webapp/api/handoff.py:75-80` already
catches the `HandoffError` base class both new exceptions inherit from —
no change needed to `_translate` itself).

### 5.4 API route changes (`webapp/api/handoff.py`)

```python
@router.post("/pairing/generate", status_code=201)
def post_generate_pairing(
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    return {
        "one_time_secret": generate_pairing_secret(conn, account_id=scope.account_id),
        "account_id": scope.account_id,
    }


@router.post("/pairing/exchange", status_code=201)
def post_exchange_pairing(
    body: ExchangePairingBody,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return exchange_pairing_secret_for_credential(
            conn, one_time_secret=body.one_time_secret,
        )
    except HandoffError as exc:
        raise _translate(exc) from exc
```

`post_generate_pairing` keeps `get_account_scope` (called from the
authenticated-by-being-servable webapp page). `post_exchange_pairing`
drops its `scope` dependency entirely — per Section 3, the extension popup
has no basis to present an `AccountScope`, and none is needed once the
code itself resolves the account.

## 6. Webapp: pairing page

### 6.1 Route

Confirmed against `webapp/api/views.py`: every existing page-rendering
route in this codebase lives in that one file (`/profile`, `/how-it-works`,
`/walkthroughs`, `/search-workspaces`, etc. — `webapp/api/handoff.py` is
API-only/JSON and has no page routes). The new `/pairing` page route goes
in `webapp/api/views.py`, following the exact pattern of
`how_it_works_page` (`webapp/api/views.py:220-227`) — same dependency
style (`request.app.state.templates`, not an imported `templates` object),
same use of the existing `_search_context(conn, scope.account_id)` helper
for nav-context data so the page renders consistently with every other
page's nav bar:

```python
@router.get("/pairing", response_class=HTMLResponse)
def pairing_page(
    request: Request, conn: sqlite3.Connection = Depends(get_conn),
    scope: AccountScope = Depends(get_account_scope),
):
    one_time_secret = generate_pairing_secret(conn, account_id=scope.account_id)
    return request.app.state.templates.TemplateResponse(
        request, "pairing.html",
        {"one_time_secret": one_time_secret, **_search_context(conn, scope.account_id)},
    )
```

A fresh code is generated on every page load/reload — simplest behavior,
consistent with the code being single-use and short-lived (an old code
left on screen after a reload is simply invalid, not confusingly still
"live").

### 6.2 Template

New file `webapp/templates/pairing.html`, extending `base.html` (matching
every other page). Content: the code displayed in a monospace, selectable
block; a "Copy" button (plain JS `navigator.clipboard.writeText`, no new
dependency); plain-language instructions: "Open the JobSearch extension
and paste this code to pair it with your account. This code expires in 10
minutes and can only be used once."

### 6.3 Nav entry

Add one link to `webapp/templates/base.html`'s nav (line 21 currently
ends `...Evidence Profile</a><a href="/walkthroughs">Help</a>`) —
`<a href="/pairing">Pair extension</a>`, placed after "Evidence Profile"
and before "Help", matching the existing flat, unstructured link-list
style already there (no new nav grouping/dropdown introduced).

## 7. Extension: popup

### 7.1 Files

- `extension/popup.html` — new. Minimal markup: a container div, one
  `<script type="module" src="popup/index.js">` tag pointing at the
  bundled output (Section 8 covers the build-script addition).
- `extension/src/popup/index.ts` — new. On load: calls
  `CredentialStore.get()`. If non-null, renders the "Paired ✓ / Run
  autofill on this tab" state. If null, renders the pairing form.
- `extension/src/popup/pairing-form.ts` — new. Pure-logic module (matches
  this codebase's established pattern of isolating `chrome.*` calls behind
  thin wrappers, e.g. `snapshot-source.ts`, `message-router.ts`): exports
  a function `attemptPairing(code: string, serverClient: ServerClient,
  credentialStore: CredentialStore): Promise<{ok: true} | {ok: false;
  message: string}>` — calls `serverClient.exchangePairing(code)`, writes
  the result via `credentialStore.set(durableSecret)` on success, returns
  a typed result the popup's DOM-wiring code (untested glue, same
  rationale as `background/index.ts`/`content/index.ts`) renders as a
  success/error message.

### 7.2 `ServerClient` addition

```typescript
async exchangePairing(oneTimeSecret: string): Promise<{ credentialId: string; durableSecret: string }> {
  const response = await fetch(`${BASE_URL}/api/handoff/pairing/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ one_time_secret: oneTimeSecret }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `pairing failed: ${response.status}`);
  }
  const result = await response.json();
  return { credentialId: result.credential_id, durableSecret: result.durable_secret };
}
```

No `X-Handoff-Credential` header — matches Section 3/5.4: this call
happens *before* a credential exists, by construction.

### 7.3 "Run autofill on this tab" message

The popup's paired-state button sends a new message type via
`chrome.runtime.sendMessage({ type: "popup_run_autofill" })`. The
background worker (`extension/src/background/index.ts`) needs a small
addition: its `chrome.runtime.onMessage` listener (currently only handling
`ContentScriptMessage` payloads per the sender/shape guard added in the
final-review fix wave, `extension/src/background/index.ts` per PR #23)
gains a branch recognizing `popup_run_autofill` and invoking exactly the
injection logic currently inside the `chrome.action.onClicked` handler —
refactored into a shared function both the (now-removed) `onClicked`
listener body and this new message branch call, rather than duplicated.
`chrome.action.onClicked` itself is removed from the registration list
(the manifest change in Section 7.4 makes Chrome stop firing it anyway;
removing the dead listener is cleanup, not a functional change).

The popup needs the target tab's id to send in this message — obtained via
`chrome.tabs.query({ active: true, currentWindow: true })` inside the
popup's own script (this is the one legitimate use of a broader tab query
in this codebase; it's scoped to "the currently active tab in the current
window," which is exactly the tab the user is looking at when they open
the popup — not a change to the `activeTab`-only permission model, since
`chrome.tabs.query` with this filter doesn't require `tabs` permission at
all under Manifest V3, only `activeTab`, which is already granted).

### 7.4 Manifest changes

```json
"action": {
  "default_popup": "popup.html",
  "default_title": "JobSearch Handoff",
  "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

No `host_permissions` change — pairing exchange hits the same
`http://127.0.0.1:8420/*` origin already granted in PR #23.

## 8. Build changes

`extension/build.mjs` (added in the local-build sub-project, PR #23) gains
a third esbuild entry point for `src/popup/index.ts` → `dist/popup/index.js`,
following the exact pattern already used for `background/index.ts` and
`content/index.ts`. `popup.html` is copied into `dist/` alongside
`manifest.json` (a `copyFileSync` call, same as the icon-copying already
present). No new build tooling — this is additive to the existing script.

## 9. Sub-project 2 — interface/boundary contract only

This section locks the shape Sub-project 2 (session-start + attachment
integration) must honor, so Sub-project 1 doesn't quietly foreclose
options. **Not a full spec** — Sub-project 2 gets its own detailed design,
written after this sub-project ships and is verified against the real
implementation, per PM decision 2026-09-11.

Sub-project 2 must, at minimum:

- Have the webapp initiate an **"Apply with extension"** action from a
  confirmed Application Pack view (exact page TBD at Sub-project 2 design
  time — likely `workspace_detail.html`, not decided here).
- Have the extension receive or discover the correct `workspace_id` /
  `pack_artifact_id` context — via `GET /api/handoff/sessions/discover`
  (already implemented server-side, unused today) and/or a same-origin
  content-script read of data the webapp page writes, per the earlier
  design-conversation answer in this session ("chrome.storage + extension
  detects webapp tab", narrowly scoped to `http://127.0.0.1:8420/*` in
  `content_scripts` — a new permission surface Sub-project 2 will add,
  not this one).
- Perform session start (`ServerClient.startSession`, already
  implemented), discovery, and resume automatically — no manual
  `handoff_manual_test_session_id` storage key.
- Supply the candidate snapshot automatically — no manual
  `handoff_manual_test_snapshot` storage key. The exact source (a new
  server endpoint returning the current `CandidateSnapshot` for a
  workspace, most likely) is Sub-project 2's decision, not this one's.
- Wire attachment handling (`extension/src/background/attachment.ts`,
  already implemented, currently unused by any entry point) into the live
  flow.
- **Remove** `MANUAL_TEST_SNAPSHOT_KEY` and `MANUAL_TEST_SESSION_ID_KEY`
  from `extension/src/background/index.ts` entirely.
- Require no DevTools/manual storage step for an ordinary user, matching
  this sub-project's own gate in kind.
- Leave every existing evidence/autofill safety rule unchanged — the
  6-field safe-catalog boundary, the `never`/`ask`/`autofill`/`suggest`
  classification model, and the `activeTab`-only injection model (Sections
  4/17 of the original handoff design spec) are not renegotiated by either
  sub-project.

Sub-project 1 leaves `CredentialStore` populated and working
(`ServerClient` calls that require `X-Handoff-Credential` — `sendEvent`,
`confirmSubmission`, and `startSession` once Sub-project 2 calls it — will
succeed once a real credential exists), which is the one piece
Sub-project 2 depends on that this sub-project is responsible for
delivering.

## 10. Testing

**Python** — confirmed existing file locations to extend (found via
`tests/webapp/**/*handoff*`):

- `tests/webapp/services/test_handoff.py` — extend with:
  `generate_pairing_secret` persists a row with the correct `account_id`,
  a hashed (not plaintext) secret, and an `expires_at` ~10 minutes out;
  `exchange_pairing_secret_for_credential` succeeds exactly once for a
  valid, unexpired code, a second attempt with the same code raises
  `PairingSecretInvalid`, an expired code raises `PairingSecretExpired`,
  an unrecognized code raises `PairingSecretInvalid`.
- `tests/webapp/api/test_handoff_routes.py` — extend with: `POST
  /api/handoff/pairing/exchange` no longer requires any
  `AccountScope`-related header/dependency to succeed for a valid code
  (regression test for the Section 3 boundary — this is the test that
  would catch someone accidentally re-adding an auth dependency here).
- New: a page-route test for `GET /pairing` (colocated with the other
  `webapp/api/views.py` page-route tests — find that file via
  `tests/webapp/api/test_views.py`, referenced already in the
  runtime-wiring branch's Codex-owned file list) — renders 200 with a code
  present in the response body.

**TypeScript** (`extension/test/`):

- `test/pairing-form.test.ts` (new) — `attemptPairing` against a
  mocked `ServerClient`/`CredentialStore` (constructor-injected fakes,
  matching every existing test in this suite): success path writes the
  credential and returns `{ok: true}`; a rejected `exchangePairing` call
  returns `{ok: false, message}` without writing anything to
  `CredentialStore`.
- `ServerClient.exchangePairing` test extending the existing
  `server-client` test coverage pattern (mocked `fetch`, same style as
  `attachment.test.ts`'s `vi.stubGlobal("fetch", ...)`).
- `background/index.ts`'s new `popup_run_autofill` message branch and the
  extracted shared injection function: since `background/index.ts` is
  established as untested glue (Sections 3-4 of the original runtime-relay
  plan), this stays untested directly, consistent with that precedent —
  covered instead by the existing manual Chrome smoke-test procedure
  (Lifecycle Step 1, already passed) re-run once this sub-project's
  `dist/` is rebuilt.

## 11. Non-goals (this sub-project)

- Removing the `MANUAL_TEST_*` session-data bridge (Sub-project 2).
- Session start, discovery, resume, snapshot supply, attachment wiring
  (Sub-project 2 — Section 9 only locks the interface).
- Any change to autofill classification, the safe-catalog, or adapter
  logic.
- Credential revocation UI (the server function
  `revoke_extension_credential` already exists and is unused/unchanged;
  building a "revoke" button is out of scope here).
- Multi-account pairing UX (the system is single-account throughout,
  matching the existing `get_account_scope` model).
