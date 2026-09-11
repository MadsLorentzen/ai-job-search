# Extension Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DevTools/`chrome.storage.local`-editing pairing bridge
with a real, user-facing flow: a webapp page shows a one-time pairing code,
the extension's new popup accepts it, and `CredentialStore` is populated
through a supported path — with the one-time code now genuinely validated
server-side (fixing a pre-existing defect where it wasn't checked at all).

**Architecture:** A new `pairing_secrets` table plus rewritten
`generate_pairing_secret`/`exchange_pairing_secret_for_credential`
functions replace today's unvalidated pairing exchange. A new `/pairing`
webapp page (in the existing `views.py` router) displays the code. A new
extension popup (`popup.html` + `src/popup/`) replaces the current bare
`chrome.action.onClicked` behavior: paired users see a "Run autofill"
button, unpaired users see the pairing form. The `onClicked` injection
logic is extracted into a shared function so both the popup's
`popup_run_autofill` message and (implicitly, going forward) any future
caller can reach it without duplication.

**Tech Stack:** Python/FastAPI/SQLite (webapp), TypeScript/Vitest/esbuild
(extension) — matching every existing file in both trees exactly, no new
dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-extension-pairing-design.md`

## Global Constraints

- `POST /api/handoff/pairing/exchange` must NOT depend on
  `get_account_scope` or any `AccountScope` — the account is resolved
  entirely from which `pairing_secrets` row the presented code hashes to.
  This is a deliberate, PM-confirmed removal of an auth dependency, not an
  oversight — do not add it back.
- `POST /api/handoff/pairing/generate` KEEPS `get_account_scope` — it's
  called by the already-servable webapp page.
- No new authentication/session system. The one-time code (now validated
  and single-use) is the complete security boundary for pairing, matching
  every other endpoint's loopback-only trust model in this codebase.
- No `host_permissions` change to `extension/manifest.json` — pairing
  exchange hits the same `http://127.0.0.1:8420/*` origin already granted.
- `chrome.action.onClicked` is removed once `default_popup` is set (Chrome
  stops firing it automatically) — its injection logic must be preserved
  via extraction into a shared function, not deleted.
- Do NOT remove `MANUAL_TEST_SNAPSHOT_KEY` / `MANUAL_TEST_SESSION_ID_KEY`
  from `extension/src/background/index.ts` — that's Sub-project 2's job,
  explicitly out of scope here (spec Section 11).
- Do NOT change autofill classification, the safe-catalog, or any adapter
  — this plan touches pairing and popup wiring only.
- Every new module with `chrome.*` calls must isolate them behind a
  function taking plain arguments, matching the pattern already
  established in `snapshot-source.ts`/`message-router.ts` (pure logic,
  testable via injected fakes) — `background/index.ts` and any
  DOM-wiring-only popup code are the established exceptions (untested
  glue), same rationale as the prior runtime-relay plan.

---

## File Structure

- `.gitignore` (repo root) — **modify**. Add `!extension/icons/**`
  exception to the blanket `*.png` rule, or the icon files Task 0 adds
  will silently never be tracked (Task 0).
- `extension/build.mjs`, `extension/test/build.test.ts`,
  `extension/icons/icon{16,48,128}.png` — **new, landed from a
  previously-uncommitted worktree**. This packaging work was already
  built and manually verified (Chrome Load Unpacked, confirmed PASS in an
  earlier session) but had never been committed to any branch — Task 0
  commits it before anything else in this plan depends on it.
- `webapp/persistence/migrations.py` — **modify**. Add migration
  `007_pairing_secrets` (new `pairing_secrets` table).
- `webapp/services/handoff.py` — **modify**. Rewrite
  `generate_pairing_secret` (new signature: `conn`, `account_id`,
  `commit=True`), rewrite `exchange_pairing_secret_for_credential` (new
  signature: `conn`, `one_time_secret` — drops `account_id`), add
  `PairingSecretExpired` exception class, add `import uuid` and
  `timedelta` to the existing `from datetime import` line.
- `webapp/api/handoff.py` — **modify**. Update `post_generate_pairing` and
  `post_exchange_pairing` to match the new service-function signatures;
  add try/except to `post_exchange_pairing` (currently has none).
- `webapp/api/views.py` — **modify**. Add `pairing_page` route
  (`GET /pairing`), following the exact pattern of `how_it_works_page`.
- `webapp/templates/pairing.html` — **new**. Extends `base.html`; shows
  the code, a copy button, and instructions.
- `webapp/templates/base.html` — **modify**. One new nav link.
- `tests/webapp/services/test_handoff.py` — **modify**. Update 4 existing
  test functions whose calls use the old `generate_pairing_secret()` /
  `exchange_pairing_secret_for_credential(conn, account_id=..., ...)`
  signatures (found via full-repo grep, not mentioned in the spec — see
  Task 2); add new tests for expiry/single-use.
- `tests/webapp/api/test_views.py` — **modify**. Add one new test for
  `GET /pairing`.
- `extension/manifest.json` — **modify**. `action.default_popup` added.
- `extension/popup.html` — **new**.
- `extension/src/popup/index.ts` — **new**. DOM-wiring glue (untested,
  same rationale as `background/index.ts`).
- `extension/src/popup/pairing-form.ts` — **new**. Pure logic:
  `attemptPairing(code, serverClient, credentialStore)`.
- `extension/src/background/server-client.ts` — **modify**. Add
  `exchangePairing(oneTimeSecret)` method.
- `extension/src/background/index.ts` — **modify**. Extract injection
  logic from the `chrome.action.onClicked` handler into a shared function;
  remove the `onClicked` listener registration; add a
  `popup_run_autofill` branch to the existing `onMessage` listener that
  calls the shared function.
- `extension/build.mjs` — **modify**. Add a third esbuild entry point for
  `src/popup/index.ts` → `dist/popup/index.js`; copy `popup.html` into
  `dist/`.
- `extension/test/pairing-form.test.ts` — **new**.
- `extension/test/server-client.test.ts` — **new** (no such file exists
  today — `ServerClient`'s existing methods are only exercised indirectly
  via other tests; this plan adds the first dedicated file for it,
  covering only the new `exchangePairing` method to stay in scope).

---

### Task 0: Land the already-built packaging work first (`build.mjs`, icons, manifest)

**Files:**
- Create: `extension/build.mjs` (copy from the uncommitted worktree)
- Create: `extension/icons/icon16.png`, `icon48.png`, `icon128.png`
  (copy from the uncommitted worktree)
- Create: `extension/test/build.test.ts` (copy from the uncommitted
  worktree)
- Modify: `extension/manifest.json` (icon fields)
- Modify: `extension/package.json` (`build` script)
- Modify: `.gitignore` (repo root)

**Why this task exists:** while researching this plan, found that the
Chrome-Load-Unpacked packaging work (build script, icons, manifest icon
fields) that was already built, tested, and manually verified in Chrome
(Lifecycle Step 1, confirmed PASS earlier) was **never committed to any
branch** — it exists only as uncommitted changes in a separate worktree
(`../ai-job-search-extension-dist-build`, branch
`feature/extension-dist-build`), which itself was branched from `master`
before PR #23 merged and never rebased or PR'd. This plan's later tasks
(especially Task 8) depend on `build.mjs` existing and being correct — so
land it first, as its own reviewable unit, rather than silently
folding still-unreviewed packaging work into a plan that's nominally about
pairing.

**Also found during this same investigation:** the repo's root
`.gitignore` has a blanket `*.png` rule (line 43) that would silently
prevent the icon files from ever being committed — this is why they show
as neither tracked nor listed in `git status` despite existing on disk.
This must be fixed in the same task, or the icon files this task tries to
add will silently fail to be tracked.

**Interfaces:**
- Consumes: nothing new.
- Produces: `extension/build.mjs` (the `npm run build` script bundling
  `background/index.ts`, `content/index.ts` via esbuild, copying
  `manifest.json` and icons into `dist/`), a working `npm run build`.
  Task 8 modifies this file to add a third entry point for the popup —
  Task 8 cannot proceed until this task lands.

- [ ] **Step 1: Fix `.gitignore` to allow extension icons**

In the repo root `.gitignore`, find the block around line 41-44:
```
*.jpg
*.jpeg
*.png
!cover_letters/OpenFonts/fonts/**
```
Add an exception for the extension's icons directory, following the
existing exception's style:
```
*.jpg
*.jpeg
*.png
!cover_letters/OpenFonts/fonts/**
!extension/icons/**
```

- [ ] **Step 2: Copy the build script, test file, and icons from the uncommitted worktree**

The source files already exist, tested and working, at
`../ai-job-search-extension-dist-build/extension/` (a sibling worktree —
adjust the relative path if your worktree layout differs; the absolute
path used during this plan's research was
`C:\Users\smbab\OneDrive\Documents\Projects\ai-job-search-extension-dist-build`).
Copy these exact files into this worktree's `extension/` directory,
unmodified:
- `build.mjs`
- `test/build.test.ts`
- `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

If that worktree is unavailable in your environment: no plan document for
this earlier packaging work exists in this repo (confirmed via search —
it was done as an in-session bounded task, not through the
brainstorming/spec/plan pipeline, so there's no written spec to
reconstruct from). Flag this as BLOCKED and describe exactly what's
missing rather than attempting to regenerate the icon PNGs or rewrite
`build.mjs` from a guess — the controller/user can locate the worktree or
provide the files another way.

- [ ] **Step 3: Apply the manifest.json and package.json changes**

To `extension/manifest.json`, change the `action` block from:
```json
  "action": {
    "default_title": "JobSearch Handoff"
  },
```
to:
```json
  "action": {
    "default_title": "JobSearch Handoff",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
```

To `extension/package.json`'s `scripts` block, add (if not already
present after the copy in Step 2 — `package.json` itself is not copied
wholesale since this repo's `master` version may have diverged slightly;
apply just this one script addition):
```json
    "build": "node build.mjs",
```

- [ ] **Step 4: Verify the build works from a clean state**

Run:
```bash
cd extension
rm -rf dist node_modules
npm ci
npm run build
find dist -type f | sort
```
Expected: succeeds, prints "Built extension/dist/", and lists
`dist/background/index.js`, `dist/content/index.js`, `dist/manifest.json`,
`dist/icons/icon16.png`, `dist/icons/icon48.png`, `dist/icons/icon128.png`.

- [ ] **Step 5: Run the full test suite**

Run: `cd extension && npx vitest run && npx tsc --noEmit`
Expected: all tests pass including the newly-added `build.test.ts`
(7 tests, per the original packaging work's verification), 0 type errors.

- [ ] **Step 6: Verify git actually tracks the icon files this time**

Run: `git add -A extension/ .gitignore && git status --short`
Expected: `extension/icons/icon16.png` etc. appear as new files staged
for commit (not silently excluded) — this is the check that confirms
Step 1's `.gitignore` fix actually worked.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(extension): land packaging build script, icons, and manifest icon fields

This work was already built and manually verified via Chrome Load
Unpacked in a prior session, but was never committed to any branch.
Landing it here as its own unit before building on top of it."
```

---

### Task 1: Server — `pairing_secrets` table and migration

**Files:**
- Modify: `webapp/persistence/migrations.py`

**Interfaces:**
- Consumes: nothing new — follows the exact DDL/registration pattern of
  `_migrate_handoff_sessions` (lines 215-228) and the `MIGRATIONS` tuple
  registration (lines 45-52).
- Produces: a `pairing_secrets` table with columns `id, account_id,
  secret_hash, created_at, expires_at, consumed_at`, migration id
  `"007_pairing_secrets"`. Task 2's service-layer code depends on this
  exact schema.

- [ ] **Step 1: Add the migration ID constant and DDL function**

Add after line 24 (`ONBOARDING_WALKTHROUGHS_MIGRATION_ID = ...`):

```python
PAIRING_SECRETS_MIGRATION_ID = "007_pairing_secrets"
```

Add a new function (place after `_migrate_onboarding_walkthroughs`, or
wherever the file's existing ordering convention puts the newest
migration function — follow whatever's already there):

```python
def _migrate_pairing_secrets(conn: sqlite3.Connection) -> None:
    _execute_statements(
        conn,
        """
        CREATE TABLE pairing_secrets (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES accounts(id),
            secret_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT
        );

        CREATE INDEX idx_pairing_secrets_hash ON pairing_secrets(secret_hash);
        """,
    )
```

- [ ] **Step 2: Register the migration**

In `apply_migrations`'s `migrations` tuple (lines 45-52), add as the last
entry:

```python
        (PAIRING_SECRETS_MIGRATION_ID, _migrate_pairing_secrets, False),
```

- [ ] **Step 3: Verify the migration applies cleanly**

Run: `cd /path/to/repo && python -c "
from webapp.persistence.db import connect, init_db
import tempfile, os
tmp = tempfile.mktemp(suffix='.sqlite3')
init_db(tmp)
conn = connect(tmp)
row = conn.execute(\"SELECT sql FROM sqlite_master WHERE name = 'pairing_secrets'\").fetchone()
print(row[0])
conn.close()
os.remove(tmp)
"`

Expected: prints the `CREATE TABLE pairing_secrets (...)` DDL with no
errors.

- [ ] **Step 4: Run the full migrations test if one exists**

Run: `pytest tests/webapp/persistence/ -k migration -v`
Expected: all pass, including any general "all migrations apply cleanly"
test already in the suite.

- [ ] **Step 5: Commit**

```bash
git add webapp/persistence/migrations.py
git commit -m "feat(webapp): add pairing_secrets table migration"
```

---

### Task 2: Server — real pairing-secret validation in the service layer

**Files:**
- Modify: `webapp/services/handoff.py`
- Modify: `tests/webapp/services/test_handoff.py`

**Interfaces:**
- Consumes: `pairing_secrets` table from Task 1; `hash_pairing_secret`,
  `create_extension_credential` (existing, unchanged, already imported in
  this file).
- Produces: `generate_pairing_secret(conn: sqlite3.Connection, *,
  account_id: str, commit: bool = True) -> str` (BREAKING signature
  change — was zero-argument); `exchange_pairing_secret_for_credential(
  conn: sqlite3.Connection, *, one_time_secret: str) -> dict[str, Any]`
  (BREAKING signature change — no longer takes `account_id`); new
  exception `PairingSecretExpired(HandoffError)`. Task 3 (API routes)
  calls both with these new signatures.

**IMPORTANT — pre-existing tests will break and must be fixed in this
task, not left broken:** a full-repo grep found these existing calls with
the OLD signatures that this task's changes make invalid:
- `tests/webapp/services/test_handoff.py:20-21` —
  `generate_pairing_secret()` (no args) — called twice in
  `test_generate_pairing_secret_produces_unique_high_entropy_values`.
- `tests/webapp/services/test_handoff.py:28` — same function, in
  `test_exchange_pairing_secret_returns_durable_credential`.
- `tests/webapp/services/test_handoff.py:29` —
  `exchange_pairing_secret_for_credential(conn, account_id="account_local",
  one_time_secret=one_time_secret)` — same test.
- `tests/webapp/services/test_handoff.py:40-41` — same two functions, in
  `test_resolve_account_scope_from_valid_durable_credential`.
- `tests/webapp/services/test_handoff.py:69-70` — same two functions, in
  `test_resolve_account_scope_rejects_revoked_credential`.

`webapp/api/handoff.py`'s two route functions also call these — that's
Task 3, not this task.

- [ ] **Step 1: Update imports**

At the top of `webapp/services/handoff.py`, change:

```python
import secrets
import sqlite3
from datetime import datetime, timezone
```

to:

```python
import secrets
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
```

- [ ] **Step 2: Write the failing tests for the new behavior**

Add to `tests/webapp/services/test_handoff.py` (after the existing
pairing-related tests, before the `from webapp.persistence.artifacts
import save_artifact` block that starts the second half of the file):

```python
from datetime import datetime, timedelta, timezone

from webapp.services.handoff import PairingSecretExpired


def test_generate_pairing_secret_persists_row_with_expiry(tmp_path):
    conn = _conn(tmp_path)
    secret = generate_pairing_secret(conn, account_id="account_local")
    row = conn.execute(
        "SELECT * FROM pairing_secrets WHERE account_id = ?", ("account_local",)
    ).fetchone()
    assert row is not None
    assert row["secret_hash"] != secret
    assert row["consumed_at"] is None
    assert row["expires_at"] > row["created_at"]
    conn.close()


def test_exchange_rejects_unrecognized_code(tmp_path):
    conn = _conn(tmp_path)
    try:
        exchange_pairing_secret_for_credential(conn, one_time_secret="not-a-real-code")
        assert False, "expected PairingSecretInvalid"
    except PairingSecretInvalid:
        pass
    conn.close()


def test_exchange_rejects_already_used_code(tmp_path):
    conn = _conn(tmp_path)
    secret = generate_pairing_secret(conn, account_id="account_local")
    exchange_pairing_secret_for_credential(conn, one_time_secret=secret)
    try:
        exchange_pairing_secret_for_credential(conn, one_time_secret=secret)
        assert False, "expected PairingSecretInvalid on reuse"
    except PairingSecretInvalid:
        pass
    conn.close()


def test_exchange_rejects_expired_code(tmp_path):
    conn = _conn(tmp_path)
    secret = generate_pairing_secret(conn, account_id="account_local")
    # Force expiry by rewriting expires_at into the past.
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    conn.execute(
        "UPDATE pairing_secrets SET expires_at = ? WHERE account_id = ?",
        (past, "account_local"),
    )
    conn.commit()
    try:
        exchange_pairing_secret_for_credential(conn, one_time_secret=secret)
        assert False, "expected PairingSecretExpired"
    except PairingSecretExpired:
        pass
    conn.close()
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pytest tests/webapp/services/test_handoff.py -k "persists_row_with_expiry or rejects_unrecognized or rejects_already_used or rejects_expired" -v`
Expected: FAIL — `generate_pairing_secret() missing 1 required keyword-only argument: 'account_id'` (or similar signature-mismatch errors), and `PairingSecretExpired` import error.

- [ ] **Step 4: Rewrite the two functions and add the new exception**

Replace `generate_pairing_secret`:

```python
def generate_pairing_secret(
    conn: sqlite3.Connection, *, account_id: str, commit: bool = True,
) -> str:
    secret = secrets.token_urlsafe(32)
    secret_id = f"pairsec_{uuid.uuid4().hex[:20]}"
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(minutes=10)).isoformat()
    conn.execute(
        "INSERT INTO pairing_secrets "
        "(id, account_id, secret_hash, created_at, expires_at, consumed_at) "
        "VALUES (?, ?, ?, ?, ?, NULL)",
        (secret_id, account_id, hash_pairing_secret(secret), now.isoformat(), expires_at),
    )
    if commit:
        conn.commit()
    return secret
```

Add the new exception class near `PairingSecretInvalid` (line ~29-30):

```python
class PairingSecretExpired(HandoffError):
    pass
```

Replace `exchange_pairing_secret_for_credential`:

```python
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
    now_iso = datetime.now(timezone.utc).isoformat()
    if row["expires_at"] < now_iso:
        raise PairingSecretExpired("pairing code expired")

    conn.execute(
        "UPDATE pairing_secrets SET consumed_at = ? WHERE id = ?",
        (now_iso, row["id"]),
    )
    durable_secret = secrets.token_urlsafe(32)
    credential = create_extension_credential(
        conn, account_id=row["account_id"],
        secret_hash=hash_pairing_secret(durable_secret),
    )
    conn.commit()
    return {"credential_id": credential["id"], "durable_secret": durable_secret}
```

- [ ] **Step 5: Fix the 4 existing tests with old-signature calls**

In `tests/webapp/services/test_handoff.py`:

Replace:
```python
def test_generate_pairing_secret_produces_unique_high_entropy_values():
    a = generate_pairing_secret()
    b = generate_pairing_secret()
    assert a != b
    assert len(a) >= 32
```
with:
```python
def test_generate_pairing_secret_produces_unique_high_entropy_values(tmp_path):
    conn = _conn(tmp_path)
    a = generate_pairing_secret(conn, account_id="account_local")
    b = generate_pairing_secret(conn, account_id="account_local")
    assert a != b
    assert len(a) >= 32
    conn.close()
```

Replace:
```python
def test_exchange_pairing_secret_returns_durable_credential(tmp_path):
    conn = _conn(tmp_path)
    one_time_secret = generate_pairing_secret()
    result = exchange_pairing_secret_for_credential(
        conn, account_id="account_local", one_time_secret=one_time_secret,
    )
```
with:
```python
def test_exchange_pairing_secret_returns_durable_credential(tmp_path):
    conn = _conn(tmp_path)
    one_time_secret = generate_pairing_secret(conn, account_id="account_local")
    result = exchange_pairing_secret_for_credential(
        conn, one_time_secret=one_time_secret,
    )
```

Replace (in `test_resolve_account_scope_from_valid_durable_credential`):
```python
    one_time_secret = generate_pairing_secret()
    exchanged = exchange_pairing_secret_for_credential(
        conn, account_id="account_local", one_time_secret=one_time_secret,
    )
```
with:
```python
    one_time_secret = generate_pairing_secret(conn, account_id="account_local")
    exchanged = exchange_pairing_secret_for_credential(
        conn, one_time_secret=one_time_secret,
    )
```

Replace (in `test_resolve_account_scope_rejects_revoked_credential`):
```python
    one_time_secret = generate_pairing_secret()
    exchanged = exchange_pairing_secret_for_credential(
        conn, account_id="account_local", one_time_secret=one_time_secret,
    )
```
with:
```python
    one_time_secret = generate_pairing_secret(conn, account_id="account_local")
    exchanged = exchange_pairing_secret_for_credential(
        conn, one_time_secret=one_time_secret,
    )
```

`test_resolve_account_scope_rejects_unknown_credential` calls neither
function directly (it calls `resolve_account_scope_from_extension_credential`
with a hardcoded string) — no change needed there.

- [ ] **Step 6: Run the full services test file**

Run: `pytest tests/webapp/services/test_handoff.py -v`
Expected: ALL tests pass (the 4 fixed existing tests + the 4 new tests
from Step 2 + every other test already in this 418-line file untouched by
this task, e.g. `test_start_handoff_session_succeeds_for_owned_workspace_and_pack`
and everything after it).

- [ ] **Step 7: Commit**

```bash
git add webapp/services/handoff.py tests/webapp/services/test_handoff.py
git commit -m "feat(webapp): validate pairing secrets server-side (single-use, 10min expiry)"
```

---

### Task 3: Server — update API routes for the new service signatures

**Files:**
- Modify: `webapp/api/handoff.py`

**Interfaces:**
- Consumes: `generate_pairing_secret(conn, *, account_id, commit=True)`,
  `exchange_pairing_secret_for_credential(conn, *, one_time_secret)` from
  Task 2.
- Produces: `POST /api/handoff/pairing/generate` (unchanged response
  shape: `{one_time_secret, account_id}`), `POST
  /api/handoff/pairing/exchange` (unchanged response shape:
  `{credential_id, durable_secret}`, unchanged request body shape:
  `{one_time_secret}` — only the internal auth dependency changes). Task 4
  (webapp page) and the extension's `ServerClient.exchangePairing`
  (Task 6) both depend on these exact request/response shapes staying the
  same as today.

- [ ] **Step 1: Update `post_generate_pairing`**

Replace:
```python
@router.post("/pairing/generate", status_code=201)
def post_generate_pairing(scope: AccountScope = Depends(get_account_scope)):
    return {"one_time_secret": generate_pairing_secret(), "account_id": scope.account_id}
```
with:
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
```

- [ ] **Step 2: Update `post_exchange_pairing`**

Replace:
```python
@router.post("/pairing/exchange", status_code=201)
def post_exchange_pairing(
    body: ExchangePairingBody,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    result = exchange_pairing_secret_for_credential(
        conn, account_id=scope.account_id, one_time_secret=body.one_time_secret,
    )
    return result
```
with:
```python
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

Note `get_account_scope` and `AccountScope` are still used elsewhere in
this file (e.g. `get_extension_scope`, other routes) — do not remove
their imports, only remove the now-unused `scope` parameter from this one
function.

- [ ] **Step 3: Run the full API route test file**

Run: `pytest tests/webapp/api/test_handoff_routes.py -v`
Expected: all pass, including `test_pairing_generate_and_exchange_round_trip`
and every test using the `_paired_credential` helper (5 call sites,
confirmed via grep — all go through HTTP, unaffected by the internal
signature change as long as request/response JSON shapes are unchanged,
which they are).

- [ ] **Step 4: Run the full webapp test suite as a broader regression check**

Run: `pytest tests/webapp/ -v`
Expected: all pass, zero regressions outside what this task intentionally
changed.

- [ ] **Step 5: Commit**

```bash
git add webapp/api/handoff.py
git commit -m "fix(webapp): drop account-scope dependency from pairing exchange route"
```

---

### Task 4: Server — `/pairing` webapp page

**Files:**
- Modify: `webapp/api/views.py`
- Modify: `webapp/templates/base.html`
- Create: `webapp/templates/pairing.html`
- Modify: `tests/webapp/api/test_views.py`

**Interfaces:**
- Consumes: `generate_pairing_secret(conn, *, account_id, commit=True)`
  from Task 2; `_search_context(conn, account_id)` (existing, unchanged,
  already used by `how_it_works_page` at `webapp/api/views.py:220-227`);
  `get_account_scope`, `get_conn` (existing, already imported in
  `views.py`).
- Produces: `GET /pairing` rendering `pairing.html` with a fresh code on
  every load. No other task depends on this route programmatically (it's
  a human-facing page) — Task 8's manual verification depends on it
  existing and rendering correctly.

- [ ] **Step 1: Add the route to `webapp/api/views.py`**

Find `how_it_works_page` (search for `def how_it_works_page`) and add a
new route function immediately after it, following the identical
structure:

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

Add the import for `generate_pairing_secret` to `views.py`'s existing
import block (check the top of the file for its current
`from webapp.services...` imports and add
`from webapp.services.handoff import generate_pairing_secret` in the same
style).

- [ ] **Step 2: Create `webapp/templates/pairing.html`**

Confirmed against the real `webapp/templates/base.html` and
`webapp/templates/how_it_works.html`: `base.html` defines `{% block title
%}` (in the `<title>` tag) and `{% block content %}` (inside `<main
class="page-shell">`); `how_it_works.html` sets both. Match that exactly:

```html
{% extends "base.html" %}
{% block title %}Pair extension · Job Search Workspace{% endblock %}
{% block content %}
<h1>Pair the extension</h1>
<p>Open the JobSearch Application Handoff extension and paste this code to pair it with your account. This code expires in 10 minutes and can only be used once.</p>
<p>
  <code id="pairing-code" style="font-family: monospace; font-size: 1.25rem; user-select: all;">{{ one_time_secret }}</code>
  <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('pairing-code').textContent)">Copy</button>
</p>
{% endblock %}
```

- [ ] **Step 3: Add the nav link**

In `webapp/templates/base.html`, find the line ending
`...Evidence Profile</a><a href="/walkthroughs">Help</a>` and insert a new
link between them:

```html
<a href="/pairing">Pair extension</a>
```

- [ ] **Step 4: Write the failing test**

Add to `tests/webapp/api/test_views.py`:

```python
def test_pairing_page_renders_a_code(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        response = client.get("/pairing")
        assert response.status_code == 200
        assert "expires in 10 minutes" in response.text
```

- [ ] **Step 5: Run to verify it fails, then passes**

Run: `pytest tests/webapp/api/test_views.py -k pairing_page -v`
Expected: FAIL first (route doesn't exist / 404), then re-run after Steps
1-3 are complete: PASS.

- [ ] **Step 6: Run the full views test file**

Run: `pytest tests/webapp/api/test_views.py -v`
Expected: all pass, zero regressions to existing page routes.

- [ ] **Step 7: Commit**

```bash
git add webapp/api/views.py webapp/templates/pairing.html webapp/templates/base.html tests/webapp/api/test_views.py
git commit -m "feat(webapp): add /pairing page showing a one-time extension pairing code"
```

---

### Task 5: Extension — `ServerClient.exchangePairing`

**Files:**
- Modify: `extension/src/background/server-client.ts`
- Create: `extension/test/server-client.test.ts`

**Interfaces:**
- Consumes: nothing new — `BASE_URL` constant already defined in this
  file.
- Produces: `ServerClient.exchangePairing(oneTimeSecret: string):
  Promise<{credentialId: string; durableSecret: string}>`. Task 6
  (`pairing-form.ts`) calls this method.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/test/server-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { ServerClient } from "../src/background/server-client";

describe("ServerClient.exchangePairing", () => {
  it("posts the one-time secret and returns the durable credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ credential_id: "extcred_1", durable_secret: "durable-abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ServerClient(async () => null);
    const result = await client.exchangePairing("one-time-code");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8420/api/handoff/pairing/exchange",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ one_time_secret: "one-time-code" }),
      }),
    );
    expect(result).toEqual({ credentialId: "extcred_1", durableSecret: "durable-abc" });
    vi.unstubAllGlobals();
  });

  it("throws with the server's detail message on a failed exchange", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "pairing code expired" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ServerClient(async () => null);
    await expect(client.exchangePairing("stale-code")).rejects.toThrow("pairing code expired");
    vi.unstubAllGlobals();
  });

  it("never sends an X-Handoff-Credential header for this call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ credential_id: "extcred_1", durable_secret: "durable-abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ServerClient(async () => { throw new Error("should never be called"); });
    await client.exchangePairing("one-time-code");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).not.toHaveProperty("X-Handoff-Credential");
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd extension && npx vitest run test/server-client.test.ts`
Expected: FAIL — `client.exchangePairing is not a function`.

- [ ] **Step 3: Implement `exchangePairing`**

Add to the `ServerClient` class in
`extension/src/background/server-client.ts` (after the constructor,
before `startSession`):

```typescript
  async exchangePairing(
    oneTimeSecret: string,
  ): Promise<{ credentialId: string; durableSecret: string }> {
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

Note: this method deliberately does NOT call `this.headers()` (which
requires a credential and throws `"extension is not paired"` if absent) —
it builds its own headers object with only `Content-Type`, since pairing
exchange happens before any credential exists.

- [ ] **Step 4: Run to verify it passes**

Run: `cd extension && npx vitest run test/server-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full extension suite**

Run: `cd extension && npx vitest run`
Expected: all pass, zero regressions (85 existing + 3 new = 88).

- [ ] **Step 6: Commit**

```bash
git add extension/src/background/server-client.ts extension/test/server-client.test.ts
git commit -m "feat(extension): add ServerClient.exchangePairing"
```

---

### Task 6: Extension — pairing-form pure logic

**Files:**
- Create: `extension/src/popup/pairing-form.ts`
- Create: `extension/test/pairing-form.test.ts`

**Interfaces:**
- Consumes: `ServerClient.exchangePairing` from Task 5;
  `CredentialStore.set` from `extension/src/background/credential-store.ts`
  (existing, unchanged: `set(credential: string): Promise<void>`).
- Produces: `attemptPairing(code: string, serverClient: ServerClient,
  credentialStore: CredentialStore): Promise<{ok: true} | {ok: false;
  message: string}>`. Task 7 (`popup/index.ts`) calls this function.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/test/pairing-form.test.ts
import { describe, expect, it, vi } from "vitest";
import { attemptPairing } from "../src/popup/pairing-form";
import type { ServerClient } from "../src/background/server-client";
import type { CredentialStore } from "../src/background/credential-store";

function makeServerClient(overrides: Partial<ServerClient> = {}): ServerClient {
  return {
    exchangePairing: vi.fn().mockResolvedValue({ credentialId: "extcred_1", durableSecret: "durable-abc" }),
    ...overrides,
  } as unknown as ServerClient;
}

function makeCredentialStore(): CredentialStore {
  return { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined), clear: vi.fn() } as unknown as CredentialStore;
}

describe("attemptPairing", () => {
  it("writes the durable credential to CredentialStore on success", async () => {
    const serverClient = makeServerClient();
    const credentialStore = makeCredentialStore();

    const result = await attemptPairing("one-time-code", serverClient, credentialStore);

    expect(result).toEqual({ ok: true });
    expect(credentialStore.set).toHaveBeenCalledWith("durable-abc");
    expect(serverClient.exchangePairing).toHaveBeenCalledWith("one-time-code");
  });

  it("returns a failure result without writing to CredentialStore when exchange rejects", async () => {
    const serverClient = makeServerClient({
      exchangePairing: vi.fn().mockRejectedValue(new Error("pairing code expired")),
    });
    const credentialStore = makeCredentialStore();

    const result = await attemptPairing("stale-code", serverClient, credentialStore);

    expect(result).toEqual({ ok: false, message: "pairing code expired" });
    expect(credentialStore.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd extension && npx vitest run test/pairing-form.test.ts`
Expected: FAIL — `Cannot find module '../src/popup/pairing-form'`.

- [ ] **Step 3: Implement `attemptPairing`**

```typescript
// extension/src/popup/pairing-form.ts
import type { ServerClient } from "../background/server-client";
import type { CredentialStore } from "../background/credential-store";

export type PairingResult = { ok: true } | { ok: false; message: string };

export async function attemptPairing(
  code: string,
  serverClient: ServerClient,
  credentialStore: CredentialStore,
): Promise<PairingResult> {
  try {
    const { durableSecret } = await serverClient.exchangePairing(code);
    await credentialStore.set(durableSecret);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd extension && npx vitest run test/pairing-form.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full extension suite**

Run: `cd extension && npx vitest run`
Expected: all pass, zero regressions (88 prior + 2 new = 90).

- [ ] **Step 6: Commit**

```bash
git add extension/src/popup/pairing-form.ts extension/test/pairing-form.test.ts
git commit -m "feat(extension): add attemptPairing pure-logic module"
```

---

### Task 7: Extension — popup UI and background-worker integration

**Files:**
- Create: `extension/popup.html`
- Create: `extension/src/popup/index.ts`
- Modify: `extension/src/background/index.ts`
- Modify: `extension/manifest.json`

**Interfaces:**
- Consumes: `attemptPairing` from Task 6; `CredentialStore`,
  `ServerClient`, `ChromeEventStore`, `DurableEventQueue`, `MessageRouter`
  (all existing, unchanged) from `background/index.ts`'s current
  construction; `INJECTED_SNAPSHOT_KEY` from
  `extension/src/content/snapshot-source.ts` (existing, unchanged).
- Produces: a working popup entry point (bundled by Task 8); a
  `runAutofillOnTab(tabId: number)` function extracted from
  `background/index.ts`'s current `onClicked` handler body, exported for
  the new `onMessage` branch to call. No later task in this plan consumes
  this function directly (Task 8 is build-only), but Sub-project 2 will.

This task requires reading the CURRENT state of
`extension/src/background/index.ts` first (it was written by a prior
plan's subagent, not by this plan's author) — the extraction in Step 2
must match whatever the real current handler body actually is, not a
guess. The description below is accurate as of `master` commit `e92334c`
but re-read the file before editing.

- [ ] **Step 1: Create `extension/popup.html`**

```html
<!doctype html>
<html>
<head><meta charset="utf-8" /><title>JobSearch Handoff</title></head>
<body>
  <div id="app"></div>
  <script type="module" src="popup/index.js"></script>
</body>
</html>
```

- [ ] **Step 2: Extract the injection logic in `background/index.ts` into a named function**

Read the current `chrome.action.onClicked.addListener(async (tab) => {
...body... })` handler in full. Extract its entire body (everything from
the `if (!tab.id) return;` line through the two `executeScript` calls)
into a standalone async function:

```typescript
export async function runAutofillOnTab(tabId: number): Promise<void> {
  // ...exact body of the current onClicked handler, with `tab.id` replaced
  // by the `tabId` parameter throughout...
}
```

Replace the `chrome.action.onClicked.addListener(...)` registration
entirely with a call site removed (see Step 3 — `onClicked` no longer
fires once `default_popup` is set, so keeping the listener registered is
harmless-but-dead code; remove it for clarity, since Chrome will simply
never invoke it).

- [ ] **Step 3: Add the `popup_run_autofill` branch to the existing `onMessage` listener**

Locate the existing `chrome.runtime.onMessage.addListener(...)` in this
file (added by the prior runtime-relay plan, with its sender/shape guard
`isValidContentScriptMessage`). Add a branch before that guard is applied
(this new message type comes from the popup, not a content script, so it
has a different shape and must be checked first):

```typescript
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (
    typeof message === "object" && message !== null &&
    (message as { type?: unknown }).type === "popup_run_autofill" &&
    typeof (message as { tabId?: unknown }).tabId === "number"
  ) {
    void runAutofillOnTab((message as { tabId: number }).tabId).catch(
      (err) => console.warn("[JobSearch Handoff] autofill failed", err),
    );
    return;
  }
  // ...existing isValidContentScriptMessage guard and routing follows...
});
```

Adapt this to fit inside the listener's actual current structure — the
goal is: `popup_run_autofill` messages are recognized and dispatched to
`runAutofillOnTab` before the existing content-script-message validation
runs (since a popup message will never pass a content-script shape
check), without altering the existing content-script-message handling
path at all.

- [ ] **Step 4: Create `extension/src/popup/index.ts`**

```typescript
import { CredentialStore } from "../background/credential-store";
import { ServerClient } from "../background/server-client";
import { attemptPairing } from "./pairing-form";

const credentialStore = new CredentialStore();
const serverClient = new ServerClient(() => credentialStore.get());

async function render(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  const credential = await credentialStore.get();

  if (credential) {
    app.innerHTML = `
      <p>Paired &#x2713;</p>
      <button id="run-autofill">Run autofill on this tab</button>
    `;
    document.getElementById("run-autofill")?.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      chrome.runtime.sendMessage({ type: "popup_run_autofill", tabId: tab.id });
      window.close();
    });
  } else {
    app.innerHTML = `
      <p>Paste the pairing code shown on the JobSearch web app:</p>
      <input id="pairing-code" type="text" />
      <button id="pair-button">Pair</button>
      <p id="pairing-message"></p>
    `;
    document.getElementById("pair-button")?.addEventListener("click", async () => {
      const input = document.getElementById("pairing-code") as HTMLInputElement;
      const messageEl = document.getElementById("pairing-message");
      const result = await attemptPairing(input.value.trim(), serverClient, credentialStore);
      if (result.ok) {
        await render();
      } else if (messageEl) {
        messageEl.textContent = result.message;
      }
    });
  }
}

void render();
```

- [ ] **Step 5: Update `extension/manifest.json`**

Change the `action` block from:
```json
  "action": {
    "default_title": "JobSearch Handoff",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
```
to:
```json
  "action": {
    "default_popup": "popup.html",
    "default_title": "JobSearch Handoff",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
```

(Verify the exact current key ordering/content of the `action` block by
reading the file first — this plan's earlier local-build sub-project
already added the icon fields; don't duplicate or drop them.)

- [ ] **Step 6: Type-check and run the full suite**

Run: `cd extension && npx tsc --noEmit`
Expected: 0 errors. If `chrome.tabs` typing errors occur, confirm
`@types/chrome` (already a devDependency per PR #23) covers `chrome.tabs`
— it does, as part of the standard `@types/chrome` package; no new
dependency needed.

Run: `cd extension && npx vitest run`
Expected: all pass, zero regressions (90 from Task 6, unchanged — this
task adds no new test file; `background/index.ts` and `popup/index.ts`
remain untested glue per the established precedent, Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add extension/popup.html extension/src/popup/index.ts extension/src/background/index.ts extension/manifest.json
git commit -m "feat(extension): add pairing/autofill popup, replace onClicked with popup-triggered autofill"
```

---

### Task 8: Extension — build script update and manual verification

**Files:**
- Modify: `extension/build.mjs`

**Interfaces:**
- Consumes: `src/popup/index.ts` (Task 7).
- Produces: `dist/popup/index.js`, `dist/popup.html` — no later task
  consumes these programmatically; this is the final build-output step,
  verified manually per Step 4.

- [ ] **Step 1: Read the current `build.mjs`**

Read `extension/build.mjs` in full (it was written by the prior
local-build plan) to see its exact current structure before editing —
the two existing esbuild calls (for `background/index.ts` and
`content/index.ts`) are the pattern to match exactly for the new third
entry point.

- [ ] **Step 2: Add the popup build step**

Add a third `await build({...})` call following the exact same options
shape as the existing two (same `bundle`, `format`, `platform`, `target`
values — check whether the existing calls use `format: "esm"` or
`"iife"` for each and pick whichever the *content* script used, since the
popup, like the content script, is loaded via a `<script type="module">`
tag rather than being a service worker):

```javascript
await build({
  entryPoints: [path.join(extensionRoot, "src/popup/index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome110",
  outfile: path.join(distDir, "popup/index.js"),
});
```

Add a `mkdirSync(path.join(distDir, "popup"), { recursive: true });` call
alongside the existing `mkdirSync` calls for `background`/`content`/`icons`
directories.

Add a `copyFileSync` call for `popup.html`, following the exact pattern
already used for `manifest.json`/icon copying:

```javascript
copyFileSync(
  path.join(extensionRoot, "popup.html"),
  path.join(distDir, "popup.html"),
);
```

- [ ] **Step 3: Run the build and verify output**

Run: `cd extension && npm run build`
Expected: succeeds, prints "Built extension/dist/".

Run: `find extension/dist -type f | sort` (or equivalent `ls -R`)
Expected: includes `dist/popup/index.js`, `dist/popup.html`, alongside the
previously-existing `dist/background/index.js`, `dist/content/index.js`,
`dist/manifest.json`, `dist/icons/*.png`.

- [ ] **Step 4: Run the build verification test suite**

Run: `cd extension && npx vitest run test/build.test.ts`
Expected: PASS — the existing `build.test.ts` (from the local-build plan)
already asserts "every manifest-referenced local file exists in dist/,"
which will now also cover `popup.html`'s reference from
`manifest.json`'s `action.default_popup` automatically, with no test
changes needed (the test reads the manifest's own references generically).

- [ ] **Step 5: Full suite one more time**

Run: `cd extension && npx vitest run && npx tsc --noEmit`
Expected: all tests pass, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add extension/build.mjs
git commit -m "feat(extension): bundle popup entry point in the build script"
```

- [ ] **Step 7: Manual verification (not automatable — document for the user)**

This step has no code changes and no commit. It documents the manual
check needed before this branch is considered done, matching the
established pattern from the prior Chrome Load-Unpacked lifecycle gate:

1. Run the webapp locally (`python -m webapp.main` or whatever this
   repo's existing local-run instructions specify — check `SETUP.md`/
   `README.md` if unfamiliar with the exact command).
2. Navigate to `http://127.0.0.1:8420/pairing` — confirm a code renders.
3. In Chrome, reload the unpacked extension from `extension/dist/`
   (`chrome://extensions` → the extension card → the reload icon) so it
   picks up the new popup/manifest.
4. Click the extension's toolbar icon — confirm the popup shows the
   pairing form (not "Paired ✓", assuming a fresh/cleared
   `CredentialStore`).
5. Paste the code from step 2, click Pair — confirm the popup switches to
   "Paired ✓ / Run autofill on this tab" with no error message.
6. Reload the popup (close and reopen) — confirm it still shows "Paired
   ✓" (proving `CredentialStore` persisted).
7. On the webapp's `/pairing` page, generate a second code but do NOT use
   it — reload the page to get a third code, then try exchanging the
   *second* (skipped) code via the popup's pairing form again (this
   requires temporarily clearing `CredentialStore` via
   `chrome.storage.local.remove("handoff_extension_credential")` in the
   popup's own DevTools console, or via the background worker's console) —
   confirm it's rejected as expired/unrecognized once its window has
   passed, or accepted if still within 10 minutes and unused (adjust
   expectation to whichever is true at test time).

Report back: did each of the 6 numbered checks in steps 4-6 pass, and
what (if anything) step 7 showed.

---

## Self-Review Notes

**Spec coverage:** Every numbered section of the design spec
(`docs/superpowers/specs/2026-09-11-extension-pairing-design.md`) maps to
a task: Section 5 (server validation) → Tasks 1-3; Section 6 (webapp page)
→ Task 4; Section 7 (popup) → Tasks 5-7; Section 8 (build) → Task 8.
Section 9 (Sub-project 2 boundary) is documentation only, not implemented
by this plan, correctly excluded. Section 11 (non-goals) is respected
throughout — no task touches `MANUAL_TEST_*`, adapters, or classification
logic. Task 0 is NOT in the spec at all — it was added during this plan's
own research (see below), not required by the design.

**Real gap found during this plan's own research, not present in the
spec:** while confirming Task 8's assumption that `extension/build.mjs`
already existed on `master` (it doesn't — verified via `git log --all
--oneline -- extension/build.mjs` returning nothing), discovered the
entire prior Chrome-Load-Unpacked packaging deliverable (`build.mjs`,
`test/build.test.ts`, the three icon PNGs, the manifest icon fields) was
built, tested, and manually verified in an earlier session but **never
committed to any branch** — it exists only as uncommitted changes in a
separate worktree. Also found in the same investigation: the repo's root
`.gitignore` has a blanket `*.png` rule that would silently prevent the
icon files from ever being tracked even if someone tried to commit them.
Both are fixed by the new Task 0, inserted before Task 1, so this plan's
later tasks build on committed, real history instead of quietly assuming
uncommitted work from a different worktree will simply be present.

**Placeholder scan:** no TBD/TODO markers. Two intentional
"read-the-current-file-first" instructions (Task 7 Steps 2-3, Task 8 Step
1) are not placeholders — they're honest acknowledgments that
`background/index.ts` and `build.mjs` were written by prior plans this
plan's author didn't re-derive from scratch, with the exact extraction
target described precisely enough to execute against whatever the real
current file contains.

**Deviation from the spec, found and fixed during this plan's own
research (not present in the design spec itself):** the design spec's
Section 5.2/5.3 code samples called a nonexistent `_now()` helper and used
`timedelta`/`uuid` without importing them — this was caught and fixed in
the spec document itself (commit `71721d2`) before this plan was written,
so Task 2's code samples already reflect the corrected version. Also
found during this plan's own research, NOT caught by the spec: 4 existing
test functions in `tests/webapp/services/test_handoff.py` call the old
function signatures and would break silently if not fixed — Task 2
Step 5 handles this explicitly, found via a full-repo grep the spec
didn't perform.

**Type consistency:** `attemptPairing(code, serverClient, credentialStore)`
signature is identical between Task 6's test and Task 7's usage in
`popup/index.ts`. `ServerClient.exchangePairing(oneTimeSecret:
string): Promise<{credentialId, durableSecret}>` is identical between
Task 5's test/implementation and Task 6's usage. `runAutofillOnTab(tabId:
number): Promise<void>` is referenced consistently between Task 7's Step
2 (definition) and Step 3 (call site) — both within the same task, so no
cross-task drift risk.
