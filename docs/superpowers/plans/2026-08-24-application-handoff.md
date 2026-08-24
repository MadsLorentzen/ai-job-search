# Application Handoff / Autofill + Submission Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user take an already-confirmed, immutable Application Pack
and use a browser extension to prepare a real external job application
(safe autofill, exact document attachment, ambiguous-field surfacing)
while the user remains the one who reviews and submits, with a durable,
honest, event-sourced record of what actually happened.

**Architecture:** A thin browser extension (content script → background
worker only, never the reverse) talks over HTTP to the existing local
FastAPI JobSearch server. The server gains a narrow, additive persistence
seam (four new tables under one migration) and a new router that mints
scoped handoff sessions, ingests idempotent field/attachment events, and
records explicit user submission confirmations — all reusing the existing
`AccountScope`/ownership pattern and the existing pack-render route
unmodified. Phase 1 (this plan's primary content) is the server-side
foundation, fully testable with `pytest`/`httpx` and zero browser
involvement. Phases 2–3 add the extension and Chrome acceptance tests on
top of that foundation.

**Tech Stack:** Python 3.13, FastAPI, SQLite (existing patterns: manual
DDL migrations, `sqlite3.Connection`, dataclasses for scope objects),
`pytest` + `fastapi.testclient.TestClient` for Phase 1; Manifest V3
browser extension (TypeScript, no framework) + Playwright fixture pages
for Phases 2–3.

**Spec:** `docs/superpowers/specs/2026-08-24-application-handoff-design.md`
(commit `9e0fd14` on branch `design/application-handoff`)

## Global Constraints

- Frozen baseline: exact commit `9f99898`. Branch from that commit, not a
  moving `master`. (Spec §2)
- Do not modify `master`, merge, or push at any point in this plan.
- Do not touch the pre-existing uncommitted candidate-profile edit.
- `workflow_events` gains zero new columns and zero semantic changes.
  (Spec §15.2, §16, §18)
- Never modify `product/application_pack_contract.py`,
  `product/application_pack_renderer.py`, or the existing render route's
  behavior — reuse them exactly as they exist today. (Spec §2.2, §18, §19)
- The shared universal safe-autofill catalog is exactly six fields: name,
  email, phone, LinkedIn, GitHub, location. No other field is ever
  universally autofillable. (Spec §8.1)
- `suggest`-classified values are never written to a page DOM before an
  explicit user "Insert" action. (Spec §8, §12)
- Independently-entered values in `ask`/`never` fields are recorded as
  presence-only (`user_value_present_observed`), never with their content.
  (Spec §11.3, §17)
- Every persisted event is idempotent on `(handoff_session_id, event_id)`;
  `event_id` is client-generated but `server_sequence` and `recorded_at`
  are server-authoritative. (Spec §11.1, §11.5)
- No event type may be a derived conclusion (no `later_value_changed`, no
  `user_modified_after` field). Only observations/actions are stored;
  conclusions are computed at read time. (Spec §11.2)
- Only an explicit user confirmation action may create a
  `submission_confirmations` row or trigger `record_status_change(...,
  new_status="applied", ...)`. Form-filling, attachment, opening a tab, or
  passive success-page detection must never do so. (Spec §12, §18)
- `handoff_sessions.status` is the one intentionally mutable field in the
  new schema; every other new table is append-only (no `UPDATE` statement
  is ever issued against `handoff_events`, `submission_confirmations`, or
  `extension_credentials` rows once inserted, aside from
  `extension_credentials.revoked_at`, which is the credential's own
  explicit revocation field). (Spec §16)
- All new persistence follows the existing pattern in
  `webapp/persistence/migrations.py`: `BEGIN IMMEDIATE`, DDL via
  `_execute_statements`, commit, `PRAGMA foreign_key_check`, rollback on
  exception. (Spec §16, verified in `webapp/persistence/migrations.py`)
- All new IDs follow the existing prefix convention:
  `f"{prefix}_{uuid.uuid4().hex[:20]}"` (verified in
  `webapp/persistence/accounts.py`, `webapp/persistence/artifacts.py`).

---

## File Structure

### Phase 1 — server foundation (this plan's primary content)

- `webapp/persistence/migrations.py` — **modify**: add migration
  `004_handoff_sessions`.
- `webapp/persistence/handoff.py` — **create**: all persistence functions
  for `extension_credentials`, `handoff_sessions`, `handoff_events`,
  `submission_confirmations`.
- `webapp/services/handoff.py` — **create**: service-layer functions
  (pairing exchange, session minting with ownership checks, event
  ingestion with idempotency, submission confirmation) — the thin layer
  between the router and persistence, mirroring `webapp/services/
  http_api.py`'s existing role for other features.
- `webapp/api/handoff.py` — **create**: FastAPI router exposing the
  pairing, session, and event endpoints.
- `webapp/app.py` — **modify**: register the new router.
- `tests/webapp/persistence/test_handoff.py` — **create**.
- `tests/webapp/services/test_handoff.py` — **create**.
- `tests/webapp/api/test_handoff_routes.py` — **create**.

### Phase 2 — extension scaffold and adapters (JS/TS, no server changes)

- `extension/manifest.json` — **create**: Manifest V3 definition, narrow
  host permissions (`activeTab`, no `<all_urls>`).
- `extension/src/background/credential-store.ts` — **create**: holds the
  durable extension credential and per-session tokens in
  `browser.storage.local`; the only module that ever reads/writes them.
- `extension/src/background/event-queue.ts` — **create**: durable,
  idempotent local event queue (Spec §13).
- `extension/src/background/server-client.ts` — **create**: the only
  module that makes HTTP calls to the JobSearch server.
- `extension/src/background/attachment.ts` — **create**: fetches CV/cover
  letter bytes from the exact-pack render route on demand and builds
  attachment event payloads with honest outcome recording (Spec §7).
- `extension/src/adapters/types.ts` — **create**: `Adapter`,
  `DetectedField`, `FieldDecision` TypeScript interfaces (Spec §8.3, §9).
- `extension/src/adapters/safe-catalog.ts` — **create**: the shared
  six-field catalog and its matching logic, imported by every adapter.
- `extension/src/adapters/greenhouse.ts` — **create**.
- `extension/src/adapters/lever.ts` — **create**.
- `extension/src/adapters/generic.ts` — **create**.
- `extension/src/content/content-script.ts` — **create**: DOM
  scan/detect/insert only; no server calls.
- `extension/test/fixtures/greenhouse.html` — **create**.
- `extension/test/fixtures/lever.html` — **create**.
- `extension/test/fixtures/generic.html` — **create**.
- `extension/test/adapters.test.ts` — **create**: pure `classify`/`map`
  unit tests against fixture-derived field lists, no DOM/network.

### Phase 3 — Chrome acceptance tests (Python/Playwright, ties everything together)

- `tests/webapp/fixtures/handoff/greenhouse_fixture.html` — **create**:
  a static page served by the test server, structurally mirroring the
  Phase 2 TS fixture but reachable by Playwright over HTTP.
- `tests/webapp/fixtures/handoff/lever_fixture.html` — **create**.
- `tests/webapp/fixtures/handoff/generic_fixture.html` — **create**.
- `webapp/api/dependencies.py` — **modify**: add a fixture-serving route
  guarded to test/dev settings only (or reuse existing static file
  serving — resolved in Task 12).
- `tests/webapp/test_handoff_browser_smoke.py` — **create**: the Section
  20 acceptance matrix, following the `live_server`/Playwright `page`
  pattern from `tests/webapp/test_browser_smoke.py`.

---

# Phase 1: Server Foundation

## Task 1: Migration 004 — extension_credentials and handoff_sessions tables

**Files:**
- Modify: `webapp/persistence/migrations.py`
- Test: `tests/webapp/persistence/test_handoff.py` (new file)

**Interfaces:**
- Produces: `HANDOFF_SESSIONS_MIGRATION_ID = "004_handoff_sessions"` constant,
  applied tables `extension_credentials`, `handoff_sessions`,
  `handoff_events`, `submission_confirmations` (all four created in this
  one migration since they are one feature's schema).

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/persistence/test_handoff.py
from __future__ import annotations

import sqlite3

from webapp.persistence.db import connect, init_db
from webapp.persistence.migrations import HANDOFF_SESSIONS_MIGRATION_ID


def test_migration_004_creates_all_four_handoff_tables(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    applied = conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?",
        (HANDOFF_SESSIONS_MIGRATION_ID,),
    ).fetchone()
    assert applied is not None

    tables = {
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    assert "extension_credentials" in tables
    assert "handoff_sessions" in tables
    assert "handoff_events" in tables
    assert "submission_confirmations" in tables
    conn.close()


def test_migration_004_is_idempotent(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    from webapp.persistence.migrations import apply_migrations

    apply_migrations(conn)  # second call must not raise or duplicate
    count = conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE id = ?",
        (HANDOFF_SESSIONS_MIGRATION_ID,),
    ).fetchone()[0]
    assert count == 1
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/webapp/persistence/test_handoff.py -v`
Expected: FAIL — `ImportError: cannot import name 'HANDOFF_SESSIONS_MIGRATION_ID'`

- [ ] **Step 3: Add the migration**

In `webapp/persistence/migrations.py`, add the new migration ID constant
near the existing three:

```python
SEARCH_WORKSPACES_MIGRATION_ID = "001_search_workspaces"
PROFILE_MANAGER_MIGRATION_ID = "002_evidence_profile_manager"
ACCOUNTS_OWNERSHIP_MIGRATION_ID = "003_accounts_ownership"
HANDOFF_SESSIONS_MIGRATION_ID = "004_handoff_sessions"
```

Add it to the `migrations` tuple inside `apply_migrations`:

```python
    migrations = (
        (SEARCH_WORKSPACES_MIGRATION_ID, _migrate_search_workspaces, True),
        (PROFILE_MANAGER_MIGRATION_ID, _migrate_evidence_profile_manager, False),
        (ACCOUNTS_OWNERSHIP_MIGRATION_ID, _migrate_accounts_ownership, False),
        (HANDOFF_SESSIONS_MIGRATION_ID, _migrate_handoff_sessions, False),
    )
```

Add the migration function itself, placed after `_migrate_accounts_ownership`:

```python
def _migrate_handoff_sessions(conn: sqlite3.Connection) -> None:
    _execute_statements(
        conn,
        """
        CREATE TABLE extension_credentials (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES accounts(id),
            secret_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            revoked_at TEXT
        );

        CREATE INDEX idx_extension_credentials_account
            ON extension_credentials(account_id);

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
            status TEXT NOT NULL,
            user_confirmed_submitted_at TEXT
        );

        CREATE INDEX idx_handoff_sessions_discovery
            ON handoff_sessions(account_id, workspace_id, target_domain);

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
        """,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/webapp/persistence/test_handoff.py -v`
Expected: PASS (both tests)

- [ ] **Step 5: Run the full existing migrations test suite to confirm no regression**

Run: `python -m pytest tests/webapp/persistence/ -v`
Expected: all PASS, including
`test_accounts_migration.py`/`test_search_workspace_migration.py`
unmodified.

- [ ] **Step 6: Commit**

```bash
git add webapp/persistence/migrations.py tests/webapp/persistence/test_handoff.py
git commit -m "feat: add handoff sessions migration 004"
```

---

## Task 2: Persistence — extension credential pairing

**Files:**
- Create: `webapp/persistence/handoff.py`
- Modify: `tests/webapp/persistence/test_handoff.py`

**Interfaces:**
- Consumes: `webapp.persistence.accounts.DEFAULT_ACCOUNT_ID` (not required
  here, but the module follows the same import shape as
  `webapp/persistence/accounts.py`).
- Produces:
  ```python
  def hash_pairing_secret(secret: str) -> str: ...
  def create_extension_credential(
      conn: sqlite3.Connection, *, account_id: str, secret_hash: str,
      credential_id: str | None = None, commit: bool = True,
  ) -> dict[str, Any]: ...
  def get_extension_credential_by_hash(
      conn: sqlite3.Connection, secret_hash: str,
  ) -> dict[str, Any] | None: ...
  def revoke_extension_credential(
      conn: sqlite3.Connection, credential_id: str, *, commit: bool = True,
  ) -> None: ...
  ```
  These four functions are consumed by Task 5 (pairing service).

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/webapp/persistence/test_handoff.py
from webapp.persistence.accounts import create_account
from webapp.persistence.handoff import (
    create_extension_credential,
    get_extension_credential_by_hash,
    hash_pairing_secret,
    revoke_extension_credential,
)


def _conn(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    return connect(db_path)


def test_hash_pairing_secret_is_deterministic_and_not_reversible():
    hash_a = hash_pairing_secret("my-secret-value")
    hash_b = hash_pairing_secret("my-secret-value")
    assert hash_a == hash_b
    assert "my-secret-value" not in hash_a


def test_create_and_look_up_extension_credential_by_hash(tmp_path):
    conn = _conn(tmp_path)
    secret_hash = hash_pairing_secret("token-abc")
    created = create_extension_credential(
        conn, account_id="account_local", secret_hash=secret_hash
    )
    assert created["account_id"] == "account_local"
    assert created["revoked_at"] is None

    found = get_extension_credential_by_hash(conn, secret_hash)
    assert found["id"] == created["id"]
    conn.close()


def test_revoked_credential_is_not_returned_by_lookup(tmp_path):
    conn = _conn(tmp_path)
    secret_hash = hash_pairing_secret("token-xyz")
    created = create_extension_credential(
        conn, account_id="account_local", secret_hash=secret_hash
    )
    revoke_extension_credential(conn, created["id"])

    assert get_extension_credential_by_hash(conn, secret_hash) is None
    conn.close()


def test_unknown_hash_returns_none(tmp_path):
    conn = _conn(tmp_path)
    assert get_extension_credential_by_hash(conn, "sha256:doesnotexist") is None
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/persistence/test_handoff.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webapp.persistence.handoff'`

- [ ] **Step 3: Write the implementation**

```python
# webapp/persistence/handoff.py
from __future__ import annotations

import hashlib
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_pairing_secret(secret: str) -> str:
    return f"sha256:{hashlib.sha256(secret.encode('utf-8')).hexdigest()}"


def create_extension_credential(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    secret_hash: str,
    credential_id: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    credential_id = credential_id or f"extcred_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO extension_credentials "
        "(id, account_id, secret_hash, created_at, revoked_at) "
        "VALUES (?, ?, ?, ?, NULL)",
        (credential_id, account_id, secret_hash, now),
    )
    if commit:
        conn.commit()
    row = conn.execute(
        "SELECT * FROM extension_credentials WHERE id = ?", (credential_id,)
    ).fetchone()
    return dict(row)


def get_extension_credential_by_hash(
    conn: sqlite3.Connection, secret_hash: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM extension_credentials "
        "WHERE secret_hash = ? AND revoked_at IS NULL",
        (secret_hash,),
    ).fetchone()
    return dict(row) if row else None


def revoke_extension_credential(
    conn: sqlite3.Connection, credential_id: str, *, commit: bool = True
) -> None:
    conn.execute(
        "UPDATE extension_credentials SET revoked_at = ? "
        "WHERE id = ? AND revoked_at IS NULL",
        (_now(), credential_id),
    )
    if commit:
        conn.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/persistence/test_handoff.py -v`
Expected: PASS (all 6 tests so far)

- [ ] **Step 5: Commit**

```bash
git add webapp/persistence/handoff.py tests/webapp/persistence/test_handoff.py
git commit -m "feat: add extension credential persistence"
```

---

## Task 3: Persistence — handoff session creation and lookup

**Files:**
- Modify: `webapp/persistence/handoff.py`
- Modify: `tests/webapp/persistence/test_handoff.py`

**Interfaces:**
- Produces:
  ```python
  def create_handoff_session(
      conn: sqlite3.Connection, *, account_id: str, workspace_id: str,
      pack_artifact_id: str, target_url: str, target_domain: str,
      ats_adapter_id: str, ats_adapter_version: str,
      session_id: str | None = None, commit: bool = True,
  ) -> dict[str, Any]: ...
  def get_handoff_session(
      conn: sqlite3.Connection, session_id: str
  ) -> dict[str, Any] | None: ...
  def find_in_progress_handoff_sessions(
      conn: sqlite3.Connection, *, account_id: str, workspace_id: str,
      target_domain: str,
  ) -> list[dict[str, Any]]: ...
  def set_handoff_session_status(
      conn: sqlite3.Connection, session_id: str, *, status: str,
      user_confirmed_submitted_at: str | None = None, commit: bool = True,
  ) -> dict[str, Any]: ...
  ```
  `find_in_progress_handoff_sessions` is the **discovery-only** query from
  Spec §5.2 — it is never used to resolve a session's identity, only to
  offer a "resume?" prompt. Consumed by Task 6 (session service).

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/webapp/persistence/test_handoff.py
from webapp.persistence.handoff import (
    create_handoff_session,
    find_in_progress_handoff_sessions,
    get_handoff_session,
    set_handoff_session_status,
)


def test_create_and_get_handoff_session(tmp_path):
    conn = _conn(tmp_path)
    session = create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id="art_1", target_url="https://boards.greenhouse.io/acme/jobs/1",
        target_domain="boards.greenhouse.io", ats_adapter_id="greenhouse",
        ats_adapter_version="greenhouse@1",
    )
    assert session["status"] == "in_progress"
    assert session["pack_artifact_id"] == "art_1"

    fetched = get_handoff_session(conn, session["id"])
    assert fetched == session
    conn.close()


def test_find_in_progress_sessions_is_discovery_only(tmp_path):
    conn = _conn(tmp_path)
    session = create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id="art_1", target_url="https://boards.greenhouse.io/acme/jobs/1",
        target_domain="boards.greenhouse.io", ats_adapter_id="greenhouse",
        ats_adapter_version="greenhouse@1",
    )
    found = find_in_progress_handoff_sessions(
        conn, account_id="account_local", workspace_id="ws_1",
        target_domain="boards.greenhouse.io",
    )
    assert [row["id"] for row in found] == [session["id"]]

    # a different workspace at the same domain must not be returned
    other = find_in_progress_handoff_sessions(
        conn, account_id="account_local", workspace_id="ws_2",
        target_domain="boards.greenhouse.io",
    )
    assert other == []
    conn.close()


def test_set_handoff_session_status_transitions_and_records_timestamp(tmp_path):
    conn = _conn(tmp_path)
    session = create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id="art_1", target_url="https://x.test/apply",
        target_domain="x.test", ats_adapter_id="generic",
        ats_adapter_version="generic@1",
    )
    updated = set_handoff_session_status(
        conn, session["id"], status="user_confirmed_submitted",
        user_confirmed_submitted_at="2026-08-24T14:00:00+00:00",
    )
    assert updated["status"] == "user_confirmed_submitted"
    assert updated["user_confirmed_submitted_at"] == "2026-08-24T14:00:00+00:00"
    conn.close()


def test_find_in_progress_excludes_terminal_sessions(tmp_path):
    conn = _conn(tmp_path)
    session = create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id="art_1", target_url="https://x.test/apply",
        target_domain="x.test", ats_adapter_id="generic",
        ats_adapter_version="generic@1",
    )
    set_handoff_session_status(conn, session["id"], status="abandoned")
    found = find_in_progress_handoff_sessions(
        conn, account_id="account_local", workspace_id="ws_1",
        target_domain="x.test",
    )
    assert found == []
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/persistence/test_handoff.py -v`
Expected: FAIL — `ImportError: cannot import name 'create_handoff_session'`

- [ ] **Step 3: Write the implementation**

Append to `webapp/persistence/handoff.py`:

```python
_TERMINAL_STATUSES = frozenset({"abandoned", "expired", "user_confirmed_submitted"})


def create_handoff_session(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    workspace_id: str,
    pack_artifact_id: str,
    target_url: str,
    target_domain: str,
    ats_adapter_id: str,
    ats_adapter_version: str,
    session_id: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    session_id = session_id or f"hs_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO handoff_sessions "
        "(id, account_id, workspace_id, pack_artifact_id, target_url, "
        "target_domain, ats_adapter_id, ats_adapter_version, started_at, "
        "status, user_confirmed_submitted_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', NULL)",
        (
            session_id, account_id, workspace_id, pack_artifact_id,
            target_url, target_domain, ats_adapter_id, ats_adapter_version,
            now,
        ),
    )
    if commit:
        conn.commit()
    return get_handoff_session(conn, session_id)


def get_handoff_session(
    conn: sqlite3.Connection, session_id: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM handoff_sessions WHERE id = ?", (session_id,)
    ).fetchone()
    return dict(row) if row else None


def find_in_progress_handoff_sessions(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    workspace_id: str,
    target_domain: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM handoff_sessions "
        "WHERE account_id = ? AND workspace_id = ? AND target_domain = ? "
        "AND status = 'in_progress' ORDER BY started_at DESC",
        (account_id, workspace_id, target_domain),
    ).fetchall()
    return [dict(row) for row in rows]


def set_handoff_session_status(
    conn: sqlite3.Connection,
    session_id: str,
    *,
    status: str,
    user_confirmed_submitted_at: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    conn.execute(
        "UPDATE handoff_sessions SET status = ?, "
        "user_confirmed_submitted_at = COALESCE(?, user_confirmed_submitted_at) "
        "WHERE id = ?",
        (status, user_confirmed_submitted_at, session_id),
    )
    if commit:
        conn.commit()
    return get_handoff_session(conn, session_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/persistence/test_handoff.py -v`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add webapp/persistence/handoff.py tests/webapp/persistence/test_handoff.py
git commit -m "feat: add handoff session persistence"
```

---

## Task 4: Persistence — idempotent event ingestion and submission confirmation

**Files:**
- Modify: `webapp/persistence/handoff.py`
- Modify: `tests/webapp/persistence/test_handoff.py`

**Interfaces:**
- Produces:
  ```python
  def append_handoff_event(
      conn: sqlite3.Connection, *, handoff_session_id: str, event_id: str,
      event_type: str, event_payload: dict[str, Any],
      normalized_field_type: str | None = None,
      page_field_key: str | None = None, observed_at: str | None = None,
      commit: bool = True,
  ) -> dict[str, Any]: ...
      # Idempotent: a second call with the same (handoff_session_id, event_id)
      # returns the ORIGINAL row unchanged, never a duplicate or an error.
  def list_handoff_events(
      conn: sqlite3.Connection, handoff_session_id: str
  ) -> list[dict[str, Any]]: ...
      # Ordered by server_sequence ascending — the canonical replay order.
  def create_submission_confirmation(
      conn: sqlite3.Connection, *, handoff_session_id: str,
      workflow_event_id: str | None = None,
      confirmation_id: str | None = None, commit: bool = True,
  ) -> dict[str, Any]: ...
  ```
  Consumed by Task 7 (event ingestion service) and Task 8 (confirmation
  service).

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/webapp/persistence/test_handoff.py
import json

from webapp.persistence.handoff import (
    append_handoff_event,
    create_submission_confirmation,
    list_handoff_events,
)


def _session(conn):
    return create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id="art_1", target_url="https://x.test/apply",
        target_domain="x.test", ats_adapter_id="generic",
        ats_adapter_version="generic@1",
    )


def test_append_handoff_event_assigns_increasing_server_sequence(tmp_path):
    conn = _conn(tmp_path)
    session = _session(conn)

    first = append_handoff_event(
        conn, handoff_session_id=session["id"], event_id="evt_1",
        event_type="field_detected", event_payload={"foo": "bar"},
        normalized_field_type="email", page_field_key="generic:email",
    )
    second = append_handoff_event(
        conn, handoff_session_id=session["id"], event_id="evt_2",
        event_type="value_inserted", event_payload={"value": "a@b.com"},
        normalized_field_type="email", page_field_key="generic:email",
    )
    assert first["server_sequence"] == 1
    assert second["server_sequence"] == 2
    assert json.loads(first["event_json"]) == {"foo": "bar"}
    conn.close()


def test_append_handoff_event_is_idempotent_on_retry(tmp_path):
    conn = _conn(tmp_path)
    session = _session(conn)

    first = append_handoff_event(
        conn, handoff_session_id=session["id"], event_id="evt_dup",
        event_type="field_detected", event_payload={"attempt": 1},
    )
    retried = append_handoff_event(
        conn, handoff_session_id=session["id"], event_id="evt_dup",
        event_type="field_detected", event_payload={"attempt": 2},
    )
    # the retried call must return the ORIGINAL row, not a new one and not
    # the second attempt's payload
    assert retried["server_sequence"] == first["server_sequence"]
    assert json.loads(retried["event_json"]) == {"attempt": 1}

    all_events = list_handoff_events(conn, session["id"])
    assert len(all_events) == 1
    conn.close()


def test_list_handoff_events_orders_by_server_sequence(tmp_path):
    conn = _conn(tmp_path)
    session = _session(conn)
    append_handoff_event(
        conn, handoff_session_id=session["id"], event_id="evt_a",
        event_type="field_detected", event_payload={},
    )
    append_handoff_event(
        conn, handoff_session_id=session["id"], event_id="evt_b",
        event_type="value_inserted", event_payload={},
    )
    events = list_handoff_events(conn, session["id"])
    assert [event["event_id"] for event in events] == ["evt_a", "evt_b"]
    conn.close()


def test_create_submission_confirmation_without_workflow_event(tmp_path):
    conn = _conn(tmp_path)
    session = _session(conn)
    confirmation = create_submission_confirmation(
        conn, handoff_session_id=session["id"]
    )
    assert confirmation["handoff_session_id"] == session["id"]
    assert confirmation["workflow_event_id"] is None
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/persistence/test_handoff.py -v`
Expected: FAIL — `ImportError: cannot import name 'append_handoff_event'`

- [ ] **Step 3: Write the implementation**

Append to `webapp/persistence/handoff.py`:

```python
import json


def append_handoff_event(
    conn: sqlite3.Connection,
    *,
    handoff_session_id: str,
    event_id: str,
    event_type: str,
    event_payload: dict[str, Any],
    normalized_field_type: str | None = None,
    page_field_key: str | None = None,
    observed_at: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    existing = conn.execute(
        "SELECT * FROM handoff_events "
        "WHERE handoff_session_id = ? AND event_id = ?",
        (handoff_session_id, event_id),
    ).fetchone()
    if existing:
        return dict(existing)

    next_sequence = (
        conn.execute(
            "SELECT COALESCE(MAX(server_sequence), 0) + 1 "
            "FROM handoff_events WHERE handoff_session_id = ?",
            (handoff_session_id,),
        ).fetchone()[0]
    )
    now = _now()
    conn.execute(
        "INSERT INTO handoff_events "
        "(handoff_session_id, event_id, server_sequence, event_type, "
        "normalized_field_type, page_field_key, event_json, observed_at, "
        "recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            handoff_session_id, event_id, next_sequence, event_type,
            normalized_field_type, page_field_key,
            json.dumps(event_payload, ensure_ascii=False, sort_keys=True),
            observed_at, now,
        ),
    )
    if commit:
        conn.commit()
    row = conn.execute(
        "SELECT * FROM handoff_events "
        "WHERE handoff_session_id = ? AND event_id = ?",
        (handoff_session_id, event_id),
    ).fetchone()
    return dict(row)


def list_handoff_events(
    conn: sqlite3.Connection, handoff_session_id: str
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM handoff_events WHERE handoff_session_id = ? "
        "ORDER BY server_sequence ASC",
        (handoff_session_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def create_submission_confirmation(
    conn: sqlite3.Connection,
    *,
    handoff_session_id: str,
    workflow_event_id: str | None = None,
    confirmation_id: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    confirmation_id = confirmation_id or f"subconf_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO submission_confirmations "
        "(id, handoff_session_id, workflow_event_id, created_at) "
        "VALUES (?, ?, ?, ?)",
        (confirmation_id, handoff_session_id, workflow_event_id, now),
    )
    if commit:
        conn.commit()
    row = conn.execute(
        "SELECT * FROM submission_confirmations WHERE id = ?",
        (confirmation_id,),
    ).fetchone()
    return dict(row)
```

Move the `import json` to the top of the file with the other imports
(replace the inline import shown above — it is written inline here only
to show exactly which function needs it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/persistence/test_handoff.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Run full persistence suite for regressions**

Run: `python -m pytest tests/webapp/persistence/ -v`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add webapp/persistence/handoff.py tests/webapp/persistence/test_handoff.py
git commit -m "feat: add idempotent handoff event and confirmation persistence"
```

---

## Task 5: Service layer — pairing exchange

**Files:**
- Create: `webapp/services/handoff.py`
- Create: `tests/webapp/services/test_handoff.py`

**Interfaces:**
- Consumes: `webapp.persistence.handoff.{hash_pairing_secret,
  create_extension_credential, get_extension_credential_by_hash,
  revoke_extension_credential}` (Task 2); `webapp.services.ownership.
  AccountScope` (existing).
- Produces:
  ```python
  class HandoffError(RuntimeError): ...
  class PairingSecretInvalid(HandoffError): ...

  def generate_pairing_secret() -> str: ...
      # one-time, high-entropy, shown once by the webapp UI (not persisted raw)
  def exchange_pairing_secret_for_credential(
      conn: sqlite3.Connection, *, account_id: str, one_time_secret: str,
  ) -> dict[str, Any]: ...
      # returns {"credential_id": ..., "durable_secret": ...}; durable_secret
      # is shown/returned exactly once, only its hash is ever persisted
  def resolve_account_scope_from_extension_credential(
      conn: sqlite3.Connection, *, presented_secret: str,
      base_profile_root: str,
  ) -> AccountScope: ...
      # raises PairingSecretInvalid if not found/revoked
  ```
  Consumed by Task 9 (pairing router).

- [ ] **Step 1: Write the failing tests**

```python
# tests/webapp/services/test_handoff.py
from __future__ import annotations

from webapp.persistence.accounts import create_account
from webapp.persistence.db import connect, init_db
from webapp.services.handoff import (
    PairingSecretInvalid,
    exchange_pairing_secret_for_credential,
    generate_pairing_secret,
    resolve_account_scope_from_extension_credential,
)


def _conn(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    return connect(db_path)


def test_generate_pairing_secret_produces_unique_high_entropy_values():
    a = generate_pairing_secret()
    b = generate_pairing_secret()
    assert a != b
    assert len(a) >= 32


def test_exchange_pairing_secret_returns_durable_credential(tmp_path):
    conn = _conn(tmp_path)
    one_time_secret = generate_pairing_secret()
    result = exchange_pairing_secret_for_credential(
        conn, account_id="account_local", one_time_secret=one_time_secret,
    )
    assert "credential_id" in result
    assert "durable_secret" in result
    assert result["durable_secret"] != one_time_secret
    conn.close()


def test_resolve_account_scope_from_valid_durable_credential(tmp_path):
    conn = _conn(tmp_path)
    one_time_secret = generate_pairing_secret()
    exchanged = exchange_pairing_secret_for_credential(
        conn, account_id="account_local", one_time_secret=one_time_secret,
    )
    scope = resolve_account_scope_from_extension_credential(
        conn, presented_secret=exchanged["durable_secret"],
        base_profile_root=str(tmp_path),
    )
    assert scope.account_id == "account_local"
    conn.close()


def test_resolve_account_scope_rejects_unknown_credential(tmp_path):
    conn = _conn(tmp_path)
    try:
        resolve_account_scope_from_extension_credential(
            conn, presented_secret="not-a-real-credential",
            base_profile_root=str(tmp_path),
        )
        assert False, "expected PairingSecretInvalid"
    except PairingSecretInvalid:
        pass
    conn.close()


def test_resolve_account_scope_rejects_revoked_credential(tmp_path):
    from webapp.persistence.handoff import revoke_extension_credential

    conn = _conn(tmp_path)
    one_time_secret = generate_pairing_secret()
    exchanged = exchange_pairing_secret_for_credential(
        conn, account_id="account_local", one_time_secret=one_time_secret,
    )
    revoke_extension_credential(conn, exchanged["credential_id"])

    try:
        resolve_account_scope_from_extension_credential(
            conn, presented_secret=exchanged["durable_secret"],
            base_profile_root=str(tmp_path),
        )
        assert False, "expected PairingSecretInvalid"
    except PairingSecretInvalid:
        pass
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/services/test_handoff.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webapp.services.handoff'`

- [ ] **Step 3: Write the implementation**

```python
# webapp/services/handoff.py
from __future__ import annotations

import secrets
import sqlite3
from typing import Any

from webapp.persistence.handoff import (
    create_extension_credential,
    get_extension_credential_by_hash,
    hash_pairing_secret,
)
from webapp.services.ownership import AccountScope, account_profile_root


class HandoffError(RuntimeError):
    pass


class PairingSecretInvalid(HandoffError):
    pass


def generate_pairing_secret() -> str:
    return secrets.token_urlsafe(32)


def exchange_pairing_secret_for_credential(
    conn: sqlite3.Connection, *, account_id: str, one_time_secret: str,
) -> dict[str, Any]:
    # The one-time secret itself is never persisted; only a freshly
    # generated durable secret's hash is stored. The one-time secret's
    # sole purpose is to have been shown once, out-of-band, by an already
    # account-scoped webapp page (see Section 5.1 of the design spec) —
    # this function trusts that the caller already verified that context.
    durable_secret = secrets.token_urlsafe(32)
    secret_hash = hash_pairing_secret(durable_secret)
    credential = create_extension_credential(
        conn, account_id=account_id, secret_hash=secret_hash,
    )
    return {"credential_id": credential["id"], "durable_secret": durable_secret}


def resolve_account_scope_from_extension_credential(
    conn: sqlite3.Connection, *, presented_secret: str, base_profile_root: str,
) -> AccountScope:
    secret_hash = hash_pairing_secret(presented_secret)
    credential = get_extension_credential_by_hash(conn, secret_hash)
    if credential is None:
        raise PairingSecretInvalid("extension credential not recognized or revoked")
    return AccountScope(
        account_id=credential["account_id"],
        profile_root=account_profile_root(base_profile_root, credential["account_id"]),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/services/test_handoff.py -v`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add webapp/services/handoff.py tests/webapp/services/test_handoff.py
git commit -m "feat: add extension pairing exchange service"
```

---

## Task 6: Service layer — session minting with ownership and exact-pack binding

**Files:**
- Modify: `webapp/services/handoff.py`
- Modify: `tests/webapp/services/test_handoff.py`

**Interfaces:**
- Consumes: `AccountScope.require_job_workspace` (existing,
  `webapp/services/ownership.py`); `webapp.persistence.artifacts.
  get_artifact` (existing); `webapp.persistence.handoff.{
  create_handoff_session, find_in_progress_handoff_sessions}` (Task 3).
- Produces:
  ```python
  class HandoffPackNotFound(HandoffError): ...

  def start_handoff_session(
      conn: sqlite3.Connection, scope: AccountScope, *, workspace_id: str,
      pack_artifact_id: str, target_url: str, target_domain: str,
      ats_adapter_id: str, ats_adapter_version: str,
  ) -> dict[str, Any]: ...
      # raises OwnedResourceNotFound if workspace not owned by scope;
      # raises HandoffPackNotFound if pack_artifact_id doesn't belong to
      # that exact workspace or isn't an application_pack artifact
  def discover_resumable_handoff_sessions(
      conn: sqlite3.Connection, scope: AccountScope, *, workspace_id: str,
      target_domain: str,
  ) -> list[dict[str, Any]]: ...
  ```
  Consumed by Task 9 (session router).

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/webapp/services/test_handoff.py
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.workspaces import create_workspace, ensure_profile_workspace
from webapp.services.ownership import AccountScope, OwnedResourceNotFound, account_profile_root
from webapp.services.handoff import (
    HandoffPackNotFound,
    discover_resumable_handoff_sessions,
    start_handoff_session,
)


def _scope(tmp_path):
    return AccountScope(
        account_id="account_local",
        profile_root=account_profile_root(str(tmp_path), "account_local"),
    )


def _workspace_with_pack(conn):
    ensure_profile_workspace(conn, account_id="account_local")
    workspace = create_workspace(
        conn, company="Acme", title="Engineer", account_id="account_local",
    )
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="application_pack",
        payload={"schema_version": "application-pack.v1"},
    )
    return workspace, artifact


def test_start_handoff_session_succeeds_for_owned_workspace_and_pack(tmp_path):
    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)

    session = start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://boards.greenhouse.io/acme/jobs/1",
        target_domain="boards.greenhouse.io", ats_adapter_id="greenhouse",
        ats_adapter_version="greenhouse@1",
    )
    assert session["workspace_id"] == workspace["id"]
    assert session["pack_artifact_id"] == artifact["id"]
    assert session["account_id"] == "account_local"
    conn.close()


def test_start_handoff_session_rejects_workspace_not_owned_by_scope(tmp_path):
    from webapp.persistence.accounts import create_account

    conn = _conn(tmp_path)
    create_account(conn, account_id="account_other", display_name="Other")
    workspace, artifact = _workspace_with_pack(conn)

    other_scope = AccountScope(
        account_id="account_other",
        profile_root=account_profile_root(str(tmp_path), "account_other"),
    )
    try:
        start_handoff_session(
            conn, other_scope, workspace_id=workspace["id"],
            pack_artifact_id=artifact["id"], target_url="https://x.test/apply",
            target_domain="x.test", ats_adapter_id="generic",
            ats_adapter_version="generic@1",
        )
        assert False, "expected OwnedResourceNotFound"
    except OwnedResourceNotFound:
        pass
    conn.close()


def test_start_handoff_session_rejects_pack_from_different_workspace(tmp_path):
    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, _artifact = _workspace_with_pack(conn)
    other_workspace = create_workspace(
        conn, company="Other Co", title="Role", account_id="account_local",
    )
    foreign_artifact = save_artifact(
        conn, workspace_id=other_workspace["id"], artifact_type="application_pack",
        payload={"schema_version": "application-pack.v1"},
    )

    try:
        start_handoff_session(
            conn, scope, workspace_id=workspace["id"],
            pack_artifact_id=foreign_artifact["id"],
            target_url="https://x.test/apply", target_domain="x.test",
            ats_adapter_id="generic", ats_adapter_version="generic@1",
        )
        assert False, "expected HandoffPackNotFound"
    except HandoffPackNotFound:
        pass
    conn.close()


def test_discover_resumable_sessions_scoped_to_owned_workspace(tmp_path):
    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)
    start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://x.test/apply", target_domain="x.test",
        ats_adapter_id="generic", ats_adapter_version="generic@1",
    )

    found = discover_resumable_handoff_sessions(
        conn, scope, workspace_id=workspace["id"], target_domain="x.test",
    )
    assert len(found) == 1
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/services/test_handoff.py -v`
Expected: FAIL — `ImportError: cannot import name 'start_handoff_session'`

- [ ] **Step 3: Write the implementation**

Append to `webapp/services/handoff.py` (add the needed imports at the top
alongside the existing ones):

```python
from webapp.persistence.artifacts import get_artifact
from webapp.persistence.handoff import (
    create_handoff_session,
    find_in_progress_handoff_sessions,
)


class HandoffPackNotFound(HandoffError):
    pass


def start_handoff_session(
    conn: sqlite3.Connection,
    scope: AccountScope,
    *,
    workspace_id: str,
    pack_artifact_id: str,
    target_url: str,
    target_domain: str,
    ats_adapter_id: str,
    ats_adapter_version: str,
) -> dict[str, Any]:
    # Ownership is checked before the pack artifact is ever read, matching
    # the existing render route's order exactly (design spec Section 17).
    scope.require_job_workspace(conn, workspace_id)

    artifact = get_artifact(conn, pack_artifact_id)
    if (
        artifact is None
        or artifact["workspace_id"] != workspace_id
        or artifact["artifact_type"] != "application_pack"
    ):
        raise HandoffPackNotFound(
            f"application pack artifact {pack_artifact_id!r} does not "
            f"belong to workspace {workspace_id!r}"
        )

    return create_handoff_session(
        conn,
        account_id=scope.account_id,
        workspace_id=workspace_id,
        pack_artifact_id=pack_artifact_id,
        target_url=target_url,
        target_domain=target_domain,
        ats_adapter_id=ats_adapter_id,
        ats_adapter_version=ats_adapter_version,
    )


def discover_resumable_handoff_sessions(
    conn: sqlite3.Connection,
    scope: AccountScope,
    *,
    workspace_id: str,
    target_domain: str,
) -> list[dict[str, Any]]:
    # Discovery only — never used to resolve a session's identity or to
    # grant authorization (design spec Section 5.2).
    scope.require_job_workspace(conn, workspace_id)
    return find_in_progress_handoff_sessions(
        conn, account_id=scope.account_id, workspace_id=workspace_id,
        target_domain=target_domain,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/services/test_handoff.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add webapp/services/handoff.py tests/webapp/services/test_handoff.py
git commit -m "feat: add owner-scoped handoff session minting"
```

---

## Task 7: Service layer — event ingestion with policy guards

**Files:**
- Modify: `webapp/services/handoff.py`
- Modify: `tests/webapp/services/test_handoff.py`

**Interfaces:**
- Consumes: `webapp.persistence.handoff.{get_handoff_session,
  append_handoff_event, list_handoff_events}` (Tasks 3–4).
- Produces:
  ```python
  class HandoffSessionNotFound(HandoffError): ...
  class HandoffSessionNotActive(HandoffError): ...
  class HandoffEventRejected(HandoffError): ...

  _SENSITIVE_NO_VALUE_EVENT_TYPES = frozenset({"user_value_present_observed"})

  def record_handoff_event(
      conn: sqlite3.Connection, scope: AccountScope, *,
      handoff_session_id: str, event_id: str, event_type: str,
      event_payload: dict[str, Any],
      normalized_field_type: str | None = None,
      page_field_key: str | None = None, observed_at: str | None = None,
  ) -> dict[str, Any]: ...
      # Enforces: session belongs to scope; session is in_progress;
      # user_value_present_observed payloads must not contain a "value" key
      # (raises HandoffEventRejected otherwise) — this is the mechanical
      # enforcement of the sensitive-value-minimization rule, not just a
      # documented convention.
  def replay_handoff_session(
      conn: sqlite3.Connection, scope: AccountScope, handoff_session_id: str,
  ) -> dict[str, Any]: ...
      # returns {"session": {...}, "events": [...]}
  ```
  Consumed by Task 9 (event router).

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/webapp/services/test_handoff.py
from webapp.services.handoff import (
    HandoffEventRejected,
    HandoffSessionNotActive,
    HandoffSessionNotFound,
    record_handoff_event,
    replay_handoff_session,
)


def test_record_handoff_event_succeeds_for_owned_in_progress_session(tmp_path):
    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)
    session = start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://x.test/apply", target_domain="x.test",
        ats_adapter_id="generic", ats_adapter_version="generic@1",
    )

    event = record_handoff_event(
        conn, scope, handoff_session_id=session["id"], event_id="evt_1",
        event_type="value_inserted",
        event_payload={"value": "shola@example.com"},
        normalized_field_type="email", page_field_key="generic:email",
    )
    assert event["event_type"] == "value_inserted"
    conn.close()


def test_record_handoff_event_rejects_value_on_presence_only_event_type(tmp_path):
    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)
    session = start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://x.test/apply", target_domain="x.test",
        ats_adapter_id="generic", ats_adapter_version="generic@1",
    )

    try:
        record_handoff_event(
            conn, scope, handoff_session_id=session["id"], event_id="evt_sensitive",
            event_type="user_value_present_observed",
            event_payload={"value": "should not be here"},
            normalized_field_type="salary_expectation",
            page_field_key="generic:salary",
        )
        assert False, "expected HandoffEventRejected"
    except HandoffEventRejected:
        pass
    conn.close()


def test_record_handoff_event_rejects_session_not_owned_by_scope(tmp_path):
    from webapp.persistence.accounts import create_account

    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)
    session = start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://x.test/apply", target_domain="x.test",
        ats_adapter_id="generic", ats_adapter_version="generic@1",
    )

    create_account(conn, account_id="account_other", display_name="Other")
    other_scope = AccountScope(
        account_id="account_other",
        profile_root=account_profile_root(str(tmp_path), "account_other"),
    )
    try:
        record_handoff_event(
            conn, other_scope, handoff_session_id=session["id"], event_id="evt_x",
            event_type="field_detected", event_payload={},
        )
        assert False, "expected HandoffSessionNotFound"
    except HandoffSessionNotFound:
        pass
    conn.close()


def test_record_handoff_event_rejects_terminal_session(tmp_path):
    from webapp.persistence.handoff import set_handoff_session_status

    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)
    session = start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://x.test/apply", target_domain="x.test",
        ats_adapter_id="generic", ats_adapter_version="generic@1",
    )
    set_handoff_session_status(conn, session["id"], status="expired")

    try:
        record_handoff_event(
            conn, scope, handoff_session_id=session["id"], event_id="evt_late",
            event_type="field_detected", event_payload={},
        )
        assert False, "expected HandoffSessionNotActive"
    except HandoffSessionNotActive:
        pass
    conn.close()


def test_replay_handoff_session_returns_session_and_ordered_events(tmp_path):
    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)
    session = start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://x.test/apply", target_domain="x.test",
        ats_adapter_id="generic", ats_adapter_version="generic@1",
    )
    record_handoff_event(
        conn, scope, handoff_session_id=session["id"], event_id="evt_1",
        event_type="field_detected", event_payload={},
    )
    record_handoff_event(
        conn, scope, handoff_session_id=session["id"], event_id="evt_2",
        event_type="value_inserted", event_payload={"value": "x"},
    )

    replay = replay_handoff_session(conn, scope, session["id"])
    assert replay["session"]["id"] == session["id"]
    assert [e["event_id"] for e in replay["events"]] == ["evt_1", "evt_2"]
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/services/test_handoff.py -v`
Expected: FAIL — `ImportError: cannot import name 'record_handoff_event'`

- [ ] **Step 3: Write the implementation**

Append to `webapp/services/handoff.py`:

```python
from webapp.persistence.handoff import (
    append_handoff_event,
    get_handoff_session,
    list_handoff_events,
)


class HandoffSessionNotFound(HandoffError):
    pass


class HandoffSessionNotActive(HandoffError):
    pass


class HandoffEventRejected(HandoffError):
    pass


_PRESENCE_ONLY_EVENT_TYPES = frozenset({"user_value_present_observed"})


def _require_owned_session(
    conn: sqlite3.Connection, scope: AccountScope, handoff_session_id: str,
) -> dict[str, Any]:
    session = get_handoff_session(conn, handoff_session_id)
    if session is None or session["account_id"] != scope.account_id:
        raise HandoffSessionNotFound(f"handoff session {handoff_session_id!r} not found")
    return session


def record_handoff_event(
    conn: sqlite3.Connection,
    scope: AccountScope,
    *,
    handoff_session_id: str,
    event_id: str,
    event_type: str,
    event_payload: dict[str, Any],
    normalized_field_type: str | None = None,
    page_field_key: str | None = None,
    observed_at: str | None = None,
) -> dict[str, Any]:
    session = _require_owned_session(conn, scope, handoff_session_id)
    if session["status"] != "in_progress":
        raise HandoffSessionNotActive(
            f"handoff session {handoff_session_id!r} is {session['status']!r}, "
            "not in_progress"
        )
    if event_type in _PRESENCE_ONLY_EVENT_TYPES and "value" in event_payload:
        raise HandoffEventRejected(
            f"{event_type!r} events must never carry a 'value' field "
            "(sensitive-value minimization, design spec Section 11.3)"
        )
    return append_handoff_event(
        conn,
        handoff_session_id=handoff_session_id,
        event_id=event_id,
        event_type=event_type,
        event_payload=event_payload,
        normalized_field_type=normalized_field_type,
        page_field_key=page_field_key,
        observed_at=observed_at,
    )


def replay_handoff_session(
    conn: sqlite3.Connection, scope: AccountScope, handoff_session_id: str,
) -> dict[str, Any]:
    session = _require_owned_session(conn, scope, handoff_session_id)
    return {"session": session, "events": list_handoff_events(conn, handoff_session_id)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/services/test_handoff.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add webapp/services/handoff.py tests/webapp/services/test_handoff.py
git commit -m "feat: add policy-guarded handoff event ingestion"
```

---

## Task 8: Service layer — explicit submission confirmation

**Files:**
- Modify: `webapp/services/handoff.py`
- Modify: `tests/webapp/services/test_handoff.py`

**Interfaces:**
- Consumes: `webapp.persistence.handoff.{set_handoff_session_status,
  create_submission_confirmation}` (Task 3–4);
  `webapp.persistence.workflow.record_status_change` (existing, unmodified
  — reused exactly, never wrapped or altered).
- Produces:
  ```python
  def confirm_handoff_submission(
      conn: sqlite3.Connection, scope: AccountScope, *,
      handoff_session_id: str, mark_workflow_applied: bool = False,
      effective_date: str | None = None,
  ) -> dict[str, Any]: ...
      # returns {"session": {...}, "confirmation": {...},
      #          "workflow_event": {...} | None}
      # This is the ONLY function in this module that may create a
      # submission_confirmations row or call record_status_change.
  ```
  This is the terminal action of the whole feature — no other function in
  this plan may call `record_status_change`.

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/webapp/services/test_handoff.py
from webapp.persistence.workflow import record_status_change
from webapp.services.handoff import confirm_handoff_submission


def test_confirm_handoff_submission_without_workflow_update(tmp_path):
    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)
    session = start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://x.test/apply", target_domain="x.test",
        ats_adapter_id="generic", ats_adapter_version="generic@1",
    )

    result = confirm_handoff_submission(
        conn, scope, handoff_session_id=session["id"], mark_workflow_applied=False,
    )
    assert result["session"]["status"] == "user_confirmed_submitted"
    assert result["confirmation"]["handoff_session_id"] == session["id"]
    assert result["workflow_event"] is None
    conn.close()


def test_confirm_handoff_submission_rejects_session_not_owned(tmp_path):
    from webapp.persistence.accounts import create_account

    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)
    session = start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://x.test/apply", target_domain="x.test",
        ats_adapter_id="generic", ats_adapter_version="generic@1",
    )

    create_account(conn, account_id="account_other", display_name="Other")
    other_scope = AccountScope(
        account_id="account_other",
        profile_root=account_profile_root(str(tmp_path), "account_other"),
    )
    try:
        confirm_handoff_submission(
            conn, other_scope, handoff_session_id=session["id"],
        )
        assert False, "expected HandoffSessionNotFound"
    except HandoffSessionNotFound:
        pass
    conn.close()


def test_confirming_twice_is_rejected_not_double_recorded(tmp_path):
    conn = _conn(tmp_path)
    scope = _scope(tmp_path)
    workspace, artifact = _workspace_with_pack(conn)
    session = start_handoff_session(
        conn, scope, workspace_id=workspace["id"], pack_artifact_id=artifact["id"],
        target_url="https://x.test/apply", target_domain="x.test",
        ats_adapter_id="generic", ats_adapter_version="generic@1",
    )
    confirm_handoff_submission(conn, scope, handoff_session_id=session["id"])

    try:
        confirm_handoff_submission(conn, scope, handoff_session_id=session["id"])
        assert False, "expected HandoffSessionNotActive"
    except HandoffSessionNotActive:
        pass
    conn.close()
```

Note: `mark_workflow_applied=True` is intentionally **not** covered by a
dedicated new test here beyond what's already implied — Task 8's
implementation reuses `record_status_change` exactly as-is, and that
function's own contract (previous status must be exactly `"drafted"`,
requires a `READY` pack) is already fully tested in
`tests/webapp/persistence/test_workflow.py`, which Global Constraints
requires stay unmodified and passing. Re-testing `record_status_change`'s
internal rules here would duplicate that existing coverage. What Task 8
newly tests is only that this module wires the call correctly and never
calls it implicitly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/services/test_handoff.py -v`
Expected: FAIL — `ImportError: cannot import name 'confirm_handoff_submission'`

- [ ] **Step 3: Write the implementation**

Append to `webapp/services/handoff.py`:

```python
from datetime import datetime, timezone

from webapp.persistence.handoff import (
    create_submission_confirmation,
    set_handoff_session_status,
)
from webapp.persistence.workflow import record_status_change


def confirm_handoff_submission(
    conn: sqlite3.Connection,
    scope: AccountScope,
    *,
    handoff_session_id: str,
    mark_workflow_applied: bool = False,
    effective_date: str | None = None,
) -> dict[str, Any]:
    session = _require_owned_session(conn, scope, handoff_session_id)
    if session["status"] != "in_progress":
        raise HandoffSessionNotActive(
            f"handoff session {handoff_session_id!r} is {session['status']!r}, "
            "not in_progress"
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    workflow_event = None
    if mark_workflow_applied:
        # Reused exactly as-is; this module adds no new path to "applied"
        # and no automatic transition (design spec Section 12, Section 18).
        workflow_event = record_status_change(
            conn,
            workspace_id=session["workspace_id"],
            new_status="applied",
            effective_date=effective_date or now_iso[:10],
            submitted_pack_artifact_id=session["pack_artifact_id"],
            account_id=scope.account_id,
            commit=False,
        )

    updated_session = set_handoff_session_status(
        conn, handoff_session_id, status="user_confirmed_submitted",
        user_confirmed_submitted_at=now_iso, commit=False,
    )
    confirmation = create_submission_confirmation(
        conn,
        handoff_session_id=handoff_session_id,
        workflow_event_id=workflow_event["id"] if workflow_event else None,
        commit=False,
    )
    conn.commit()
    return {
        "session": updated_session,
        "confirmation": confirmation,
        "workflow_event": workflow_event,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/services/test_handoff.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full webapp services + persistence suite**

Run: `python -m pytest tests/webapp/services/ tests/webapp/persistence/ -v`
Expected: all PASS, including `test_workflow.py` unmodified.

- [ ] **Step 6: Commit**

```bash
git add webapp/services/handoff.py tests/webapp/services/test_handoff.py
git commit -m "feat: add explicit handoff submission confirmation"
```

---

## Task 9: HTTP router — pairing, session, event, and confirmation endpoints

**Files:**
- Create: `webapp/api/handoff.py`
- Modify: `webapp/app.py`
- Create: `tests/webapp/api/test_handoff_routes.py`

**Interfaces:**
- Consumes: every service function from Tasks 5–8; `webapp.api.
  dependencies.get_conn` (existing); `webapp.api.dependencies.
  get_account_scope` (existing, reused for the pairing-generation endpoint
  only — everything else authenticates via the extension credential
  header, not `get_account_scope`).
- Produces: the router object `handoff_router`, registered in `webapp/app.py`.

Route table:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/handoff/pairing/generate` | `get_account_scope` (webapp session) | Mint a one-time pairing secret |
| POST | `/api/handoff/pairing/exchange` | one-time secret in body | Exchange for a durable credential |
| POST | `/api/handoff/sessions` | `X-Handoff-Credential` header | Start a handoff session |
| GET | `/api/handoff/sessions/discover` | `X-Handoff-Credential` header | Discovery-only resumable-session lookup |
| POST | `/api/handoff/sessions/{id}/events` | `X-Handoff-Credential` header | Append one event (idempotent) |
| GET | `/api/handoff/sessions/{id}/events` | `X-Handoff-Credential` header | Replay a session's events |
| POST | `/api/handoff/sessions/{id}/confirm-submission` | `X-Handoff-Credential` header | Explicit user confirmation |

- [ ] **Step 1: Write the failing tests**

```python
# tests/webapp/api/test_handoff_routes.py
from __future__ import annotations

from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace, ensure_profile_workspace


def _app(tmp_path):
    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", documents_root=tmp_path / "documents",
    )
    app = create_app(settings)
    with TestClient(app):
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        workspace = create_workspace(conn, company="Acme", title="Engineer")
        artifact = save_artifact(
            conn, workspace_id=workspace["id"], artifact_type="application_pack",
            payload={"schema_version": "application-pack.v1"},
        )
        conn.close()
    return app, workspace["id"], artifact["id"]


def _paired_credential(client) -> str:
    generated = client.post("/api/handoff/pairing/generate")
    assert generated.status_code == 201, generated.text
    one_time_secret = generated.json()["one_time_secret"]

    exchanged = client.post(
        "/api/handoff/pairing/exchange", json={"one_time_secret": one_time_secret}
    )
    assert exchanged.status_code == 201, exchanged.text
    return exchanged.json()["durable_secret"]


def test_pairing_generate_and_exchange_round_trip(tmp_path):
    app, _workspace_id, _artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        credential = _paired_credential(client)
        assert isinstance(credential, str)
        assert len(credential) >= 32


def test_start_session_requires_valid_extension_credential(tmp_path):
    app, workspace_id, artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/handoff/sessions",
            headers={"X-Handoff-Credential": "not-a-real-credential"},
            json={
                "workspace_id": workspace_id, "pack_artifact_id": artifact_id,
                "target_url": "https://x.test/apply", "target_domain": "x.test",
                "ats_adapter_id": "generic", "ats_adapter_version": "generic@1",
            },
        )
        assert response.status_code == 401


def test_full_session_lifecycle_over_http(tmp_path):
    app, workspace_id, artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        credential = _paired_credential(client)
        headers = {"X-Handoff-Credential": credential}

        started = client.post(
            "/api/handoff/sessions", headers=headers,
            json={
                "workspace_id": workspace_id, "pack_artifact_id": artifact_id,
                "target_url": "https://x.test/apply", "target_domain": "x.test",
                "ats_adapter_id": "generic", "ats_adapter_version": "generic@1",
            },
        )
        assert started.status_code == 201, started.text
        session_id = started.json()["id"]

        event_response = client.post(
            f"/api/handoff/sessions/{session_id}/events", headers=headers,
            json={
                "event_id": "evt_1", "event_type": "value_inserted",
                "event_payload": {"value": "shola@example.com"},
                "normalized_field_type": "email", "page_field_key": "generic:email",
            },
        )
        assert event_response.status_code == 201, event_response.text

        # retry with the same event_id must not create a duplicate
        retry_response = client.post(
            f"/api/handoff/sessions/{session_id}/events", headers=headers,
            json={
                "event_id": "evt_1", "event_type": "value_inserted",
                "event_payload": {"value": "different-value-should-be-ignored"},
                "normalized_field_type": "email", "page_field_key": "generic:email",
            },
        )
        assert retry_response.status_code == 201

        replay = client.get(
            f"/api/handoff/sessions/{session_id}/events", headers=headers
        )
        assert replay.status_code == 200
        events = replay.json()["events"]
        assert len(events) == 1
        assert events[0]["event_id"] == "evt_1"

        confirmed = client.post(
            f"/api/handoff/sessions/{session_id}/confirm-submission",
            headers=headers, json={"mark_workflow_applied": False},
        )
        assert confirmed.status_code == 201, confirmed.text
        assert confirmed.json()["session"]["status"] == "user_confirmed_submitted"


def test_sensitive_event_with_value_is_rejected_over_http(tmp_path):
    app, workspace_id, artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        credential = _paired_credential(client)
        headers = {"X-Handoff-Credential": credential}
        started = client.post(
            "/api/handoff/sessions", headers=headers,
            json={
                "workspace_id": workspace_id, "pack_artifact_id": artifact_id,
                "target_url": "https://x.test/apply", "target_domain": "x.test",
                "ats_adapter_id": "generic", "ats_adapter_version": "generic@1",
            },
        )
        session_id = started.json()["id"]

        rejected = client.post(
            f"/api/handoff/sessions/{session_id}/events", headers=headers,
            json={
                "event_id": "evt_sensitive", "event_type": "user_value_present_observed",
                "event_payload": {"value": "should not be sent"},
                "normalized_field_type": "salary_expectation",
                "page_field_key": "generic:salary",
            },
        )
        assert rejected.status_code == 400


def test_cross_account_denial_over_http(tmp_path):
    from webapp.persistence.accounts import create_account

    app, workspace_id, artifact_id = _app(tmp_path)
    with TestClient(app) as client:
        conn = connect(app.state.settings.db_path)
        create_account(conn, account_id="account_other", display_name="Other")
        conn.close()

        # generate/exchange as account_other via a second app instance
        # pointed at the same account_id but a different db connection path
        other_settings = Settings(
            db_path=app.state.settings.db_path,
            documents_root=app.state.settings.documents_root,
            account_id="account_other",
        )
    with TestClient(create_app(other_settings)) as other_client:
        other_credential = _paired_credential(other_client)

    with TestClient(app) as client:
        response = client.post(
            "/api/handoff/sessions",
            headers={"X-Handoff-Credential": other_credential},
            json={
                "workspace_id": workspace_id, "pack_artifact_id": artifact_id,
                "target_url": "https://x.test/apply", "target_domain": "x.test",
                "ats_adapter_id": "generic", "ats_adapter_version": "generic@1",
            },
        )
        assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/api/test_handoff_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webapp.api.handoff'`

- [ ] **Step 3: Write the router**

```python
# webapp/api/handoff.py
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict

from webapp.api.dependencies import get_account_scope, get_conn
from webapp.services.handoff import (
    HandoffError,
    HandoffEventRejected,
    HandoffPackNotFound,
    HandoffSessionNotActive,
    HandoffSessionNotFound,
    PairingSecretInvalid,
    confirm_handoff_submission,
    discover_resumable_handoff_sessions,
    exchange_pairing_secret_for_credential,
    generate_pairing_secret,
    record_handoff_event,
    replay_handoff_session,
    resolve_account_scope_from_extension_credential,
    start_handoff_session,
)
from webapp.services.ownership import AccountScope, OwnedResourceNotFound

router = APIRouter(prefix="/api/handoff", tags=["handoff"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExchangePairingBody(StrictBody):
    one_time_secret: str


class StartSessionBody(StrictBody):
    workspace_id: str
    pack_artifact_id: str
    target_url: str
    target_domain: str
    ats_adapter_id: str
    ats_adapter_version: str


class RecordEventBody(StrictBody):
    event_id: str
    event_type: str
    event_payload: dict
    normalized_field_type: str | None = None
    page_field_key: str | None = None
    observed_at: str | None = None


class ConfirmSubmissionBody(StrictBody):
    mark_workflow_applied: bool = False
    effective_date: str | None = None


def get_extension_scope(
    x_handoff_credential: str = Header(...),
    conn: sqlite3.Connection = Depends(get_conn),
) -> AccountScope:
    from webapp.api.dependencies import get_conn as _get_conn  # for base_profile_root
    try:
        return resolve_account_scope_from_extension_credential(
            conn, presented_secret=x_handoff_credential,
            base_profile_root=".",
        )
    except PairingSecretInvalid as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, (HandoffSessionNotFound, OwnedResourceNotFound)):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (HandoffPackNotFound, HandoffSessionNotActive, HandoffEventRejected)):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.post("/pairing/generate", status_code=201)
def post_generate_pairing(scope: AccountScope = Depends(get_account_scope)):
    return {"one_time_secret": generate_pairing_secret(), "account_id": scope.account_id}


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


@router.post("/sessions", status_code=201)
def post_start_session(
    body: StartSessionBody,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return start_handoff_session(conn, scope, **body.model_dump())
    except (HandoffError, OwnedResourceNotFound) as exc:
        raise _translate(exc) from exc


@router.get("/sessions/discover")
def get_discover_sessions(
    workspace_id: str, target_domain: str,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        sessions = discover_resumable_handoff_sessions(
            conn, scope, workspace_id=workspace_id, target_domain=target_domain,
        )
        return {"sessions": sessions}
    except OwnedResourceNotFound as exc:
        raise _translate(exc) from exc


@router.post("/sessions/{session_id}/events", status_code=201)
def post_record_event(
    session_id: str, body: RecordEventBody,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return record_handoff_event(
            conn, scope, handoff_session_id=session_id, **body.model_dump()
        )
    except HandoffError as exc:
        raise _translate(exc) from exc


@router.get("/sessions/{session_id}/events")
def get_replay_events(
    session_id: str,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return replay_handoff_session(conn, scope, session_id)
    except HandoffError as exc:
        raise _translate(exc) from exc


@router.post("/sessions/{session_id}/confirm-submission", status_code=201)
def post_confirm_submission(
    session_id: str, body: ConfirmSubmissionBody,
    scope: AccountScope = Depends(get_extension_scope),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        return confirm_handoff_submission(
            conn, scope, handoff_session_id=session_id,
            mark_workflow_applied=body.mark_workflow_applied,
            effective_date=body.effective_date,
        )
    except HandoffError as exc:
        raise _translate(exc) from exc
```

In `webapp/app.py`, add the import and registration alongside the existing
routers:

```python
from webapp.api.handoff import router as handoff_router
```

```python
    app.include_router(handoff_router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/api/test_handoff_routes.py -v`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Run the full non-browser suite for regressions**

Run: `python -m pytest tests/ -k "not playwright and not e2e and not browser_smoke" -q`
Expected: all PASS, no change to any pre-existing test's outcome.

- [ ] **Step 6: Commit**

```bash
git add webapp/api/handoff.py webapp/app.py tests/webapp/api/test_handoff_routes.py
git commit -m "feat: add handoff HTTP router with pairing and session lifecycle"
```

---

## Task 10: Boundary and regression verification for Phase 1

**Files changed:** none unless a failing check exposes an in-scope defect.

- [ ] **Step 1: Confirm zero changes to protected files**

```bash
git diff 9f99898...HEAD --name-only -- \
  product/application_pack_contract.py \
  product/application_pack_renderer.py \
  webapp/services/application_pack.py \
  webapp/api/review.py \
  webapp/persistence/workflow.py \
  webapp/persistence/schema.sql \
  webapp/services/ownership.py \
  webapp/persistence/accounts.py \
  webapp/persistence/artifacts.py
```

Expected: empty. `webapp/persistence/workflow.py` must show no diff —
`record_status_change` is called by Task 8 but never modified.

- [ ] **Step 2: Confirm `workflow_events` schema is unchanged**

```bash
git diff 9f99898...HEAD -- webapp/persistence/schema.sql
```

Expected: empty (the new tables live entirely in migration `004`, not in
`schema.sql`, matching the existing convention that `schema.sql` holds
only the original bootstrap tables and every later table lives in a
numbered migration).

- [ ] **Step 3: Run the full suite**

```bash
python -m pytest tests/ -k "not playwright and not e2e and not browser_smoke" -v
```

Expected: 100% passing, only pre-existing skips.

- [ ] **Step 4: `git diff --check`**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the pre-existing untouched
candidate-profile file (if present) as an unstaged modification, nothing
else.

- [ ] **Step 5: Report**

Produce a short report (not a commit) covering: commits created so far,
files changed, focused + full test results, confirmation that `master`
and the candidate-profile edit remain untouched, and any deviation from
this plan and why. **Stop here for review before starting Phase 2.**

---

# Phase 2: Extension Scaffold and Adapters

Phase 2 is JS/TS and has no server-side dependency beyond the endpoints
Phase 1 already built and tested. Each task below produces code testable
in isolation (pure functions, fixture HTML, no live server, no live
browser) — Chrome-driven, full-stack acceptance tests are Phase 3.

## Task 11: Adapter interface types and the shared safe catalog

**Files:**
- Create: `extension/src/adapters/types.ts`
- Create: `extension/src/adapters/safe-catalog.ts`
- Create: `extension/test/safe-catalog.test.ts`

**Interfaces:**
- Produces (consumed by every adapter in Tasks 12–14):
  ```typescript
  export type Behavior = "autofill" | "suggest" | "ask" | "never";
  export type SourceKind = "safe_fact" | "adapter_rule" | "generic_fallback" | "none";

  export interface FieldDecision {
    normalizedFieldType: string;
    behavior: Behavior;
    mappingReason: string;
    sourceKind: SourceKind;
    requiresUserApproval: boolean;
    adapterId: string;
    adapterVersion: string;
  }

  export interface DetectedField {
    pageFieldKey: string;
    labelText: string;
    domRef: unknown; // adapter-internal locator type, never persisted verbatim
  }

  export interface CandidateSnapshot {
    identity: { name: { value: string; profile_evidence_ids: string[] } };
    contact: Record<string, { value: string; profile_evidence_ids: string[] } | null>;
    // employment/education/etc. shape mirrors the server's
    // application-pack.v1 candidate_snapshot exactly (design spec Section 2.1)
  }

  export interface Adapter {
    id: string;
    version: string;
    detect(document: Document): boolean;
    scan(document: Document): DetectedField[];
    classify(field: DetectedField): FieldDecision;
    map(field: DetectedField, snapshot: CandidateSnapshot): string | null;
    detectLikelySuccess?(document: Document): boolean;
  }

  export const SAFE_CATALOG_FIELD_TYPES: readonly string[]; // exactly 6 entries
  export function matchSafeCatalogField(labelText: string): string | null;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// extension/test/safe-catalog.test.ts
import { describe, expect, it } from "vitest";
import { SAFE_CATALOG_FIELD_TYPES, matchSafeCatalogField } from "../src/adapters/safe-catalog";

describe("safe catalog", () => {
  it("contains exactly six universal fields", () => {
    expect(SAFE_CATALOG_FIELD_TYPES).toEqual([
      "name", "email", "phone", "linkedin", "github", "location",
    ]);
  });

  it("matches an email label to the email field type", () => {
    expect(matchSafeCatalogField("Email address")).toBe("email");
  });

  it("matches a LinkedIn label to the linkedin field type", () => {
    expect(matchSafeCatalogField("LinkedIn profile URL")).toBe("linkedin");
  });

  it("returns null for a field outside the safe catalog", () => {
    expect(matchSafeCatalogField("Desired salary")).toBeNull();
  });

  it("returns null for an employment field even though it sounds similar", () => {
    expect(matchSafeCatalogField("Current employer")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run extension/test/safe-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// extension/src/adapters/types.ts
export type Behavior = "autofill" | "suggest" | "ask" | "never";
export type SourceKind = "safe_fact" | "adapter_rule" | "generic_fallback" | "none";

export interface FieldDecision {
  normalizedFieldType: string;
  behavior: Behavior;
  mappingReason: string;
  sourceKind: SourceKind;
  requiresUserApproval: boolean;
  adapterId: string;
  adapterVersion: string;
}

export interface DetectedField {
  pageFieldKey: string;
  labelText: string;
  domRef: unknown;
}

export interface ProvenancedValue {
  value: string;
  profile_evidence_ids: string[];
}

export interface CandidateSnapshot {
  identity: { name: ProvenancedValue };
  contact: Record<string, ProvenancedValue | null>;
  employment: Array<{
    record_id: string;
    role: ProvenancedValue | null;
    employer: ProvenancedValue | null;
    date_range: ProvenancedValue | null;
    location: ProvenancedValue | null;
    details: ProvenancedValue[];
  }>;
}

export interface Adapter {
  id: string;
  version: string;
  detect(document: Document): boolean;
  scan(document: Document): DetectedField[];
  classify(field: DetectedField): FieldDecision;
  map(field: DetectedField, snapshot: CandidateSnapshot): string | null;
  detectLikelySuccess?(document: Document): boolean;
}
```

```typescript
// extension/src/adapters/safe-catalog.ts
export const SAFE_CATALOG_FIELD_TYPES = [
  "name", "email", "phone", "linkedin", "github", "location",
] as const;

const LABEL_PATTERNS: Record<(typeof SAFE_CATALOG_FIELD_TYPES)[number], RegExp> = {
  name: /\b(full\s*name|your\s*name)\b/i,
  email: /\bemail\b/i,
  phone: /\b(phone|mobile)\b/i,
  linkedin: /\blinkedin\b/i,
  github: /\bgithub\b/i,
  location: /\b(location|city)\b/i,
};

// Structural rule (design spec Section 8.2): this function is the ONLY
// escalation path to "autofill" behavior. It matches exact catalog
// semantics only; it must never be extended to match employment/education
// labels, which belong to adapter-specific rules, never to this shared
// catalog.
export function matchSafeCatalogField(labelText: string): string | null {
  for (const fieldType of SAFE_CATALOG_FIELD_TYPES) {
    if (LABEL_PATTERNS[fieldType].test(labelText)) {
      return fieldType;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run extension/test/safe-catalog.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/adapters/types.ts extension/src/adapters/safe-catalog.ts extension/test/safe-catalog.test.ts
git commit -m "feat: add adapter interface types and shared safe catalog"
```

---

## Task 12: Legal/declaration pattern matching (the `never` policy)

**Files:**
- Create: `extension/src/adapters/legal-patterns.ts`
- Create: `extension/test/legal-patterns.test.ts`

**Interfaces:**
- Produces (consumed by every adapter's `classify`):
  ```typescript
  export function isLegalDeclarationField(labelText: string): boolean;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// extension/test/legal-patterns.test.ts
import { describe, expect, it } from "vitest";
import { isLegalDeclarationField } from "../src/adapters/legal-patterns";

describe("legal declaration detection", () => {
  it("flags a certification checkbox label", () => {
    expect(isLegalDeclarationField("I certify that the information above is true and correct")).toBe(true);
  });

  it("flags an e-signature field", () => {
    expect(isLegalDeclarationField("Electronic signature")).toBe(true);
  });

  it("flags an attestation checkbox", () => {
    expect(isLegalDeclarationField("I attest that I am legally authorized to work")).toBe(true);
  });

  it("does not flag an ordinary text field", () => {
    expect(isLegalDeclarationField("Cover letter")).toBe(false);
  });

  it("does not flag the shared safe catalog fields", () => {
    expect(isLegalDeclarationField("Email address")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run extension/test/legal-patterns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// extension/src/adapters/legal-patterns.ts
const LEGAL_PATTERNS: RegExp[] = [
  /\bcertify\b/i,
  /\battest\b/i,
  /\belectronic\s*signature\b/i,
  /\be-?sign(ature)?\b/i,
  /\bunder\s*penalty\s*of\s*perjury\b/i,
  /\bI\s*agree\b/i,
];

// This is the ONLY authorization path to `never` in the closed policy
// (design spec Section 8). It is intentionally conservative: a false
// positive here just means one more field is left for the user to fill,
// which is always the safe direction to err in.
export function isLegalDeclarationField(labelText: string): boolean {
  return LEGAL_PATTERNS.some((pattern) => pattern.test(labelText));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run extension/test/legal-patterns.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/adapters/legal-patterns.ts extension/test/legal-patterns.test.ts
git commit -m "feat: add legal/declaration field pattern matching"
```

---

## Task 13: Generic fallback adapter

**Files:**
- Create: `extension/src/adapters/generic.ts`
- Create: `extension/test/fixtures/generic.html`
- Create: `extension/test/adapters-generic.test.ts`

**Interfaces:**
- Consumes: `matchSafeCatalogField` (Task 11), `isLegalDeclarationField`
  (Task 12), `Adapter`/`DetectedField`/`FieldDecision`/`CandidateSnapshot`
  types (Task 11).
- Produces: `genericAdapter: Adapter` with `id: "generic"`,
  `version: "generic@1"`. Consumed by Task 16 (content script wiring) and
  Phase 3 acceptance tests.

- [ ] **Step 1: Write the fixture and the failing test**

```html
<!-- extension/test/fixtures/generic.html -->
<!doctype html>
<html><body>
  <form id="application">
    <label for="f_name">Full Name</label><input id="f_name" name="name">
    <label for="f_email">Email address</label><input id="f_email" name="email">
    <label for="f_phone">Phone</label><input id="f_phone" name="phone">
    <label for="f_salary">Desired salary</label><input id="f_salary" name="salary">
    <label for="f_cert">
      <input type="checkbox" id="f_cert" name="certify">
      I certify that the information above is true and correct
    </label>
    <button type="submit" id="submit-btn">Submit Application</button>
  </form>
</body></html>
```

```typescript
// extension/test/adapters-generic.test.ts
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { genericAdapter } from "../src/adapters/generic";

function loadFixture(): Document {
  const html = readFileSync(new URL("./fixtures/generic.html", import.meta.url), "utf-8");
  return new JSDOM(html).window.document;
}

describe("generic adapter", () => {
  it("detects any form with at least one recognizable input", () => {
    expect(genericAdapter.detect(loadFixture())).toBe(true);
  });

  it("classifies name/email/phone as autofill from the safe catalog", () => {
    const document = loadFixture();
    const fields = genericAdapter.scan(document);
    const byLabel = Object.fromEntries(fields.map((f) => [f.labelText, f]));

    expect(genericAdapter.classify(byLabel["Full Name"]).behavior).toBe("autofill");
    expect(genericAdapter.classify(byLabel["Email address"]).behavior).toBe("autofill");
    expect(genericAdapter.classify(byLabel["Phone"]).behavior).toBe("autofill");
  });

  it("classifies an unrecognized field as ask, never escalated", () => {
    const document = loadFixture();
    const fields = genericAdapter.scan(document);
    const salary = fields.find((f) => f.labelText === "Desired salary")!;
    expect(genericAdapter.classify(salary).behavior).toBe("ask");
  });

  it("classifies a certification checkbox as never", () => {
    const document = loadFixture();
    const fields = genericAdapter.scan(document);
    const cert = fields.find((f) => f.labelText.includes("certify"))!;
    expect(genericAdapter.classify(cert).behavior).toBe("never");
  });

  it("every FieldDecision carries the adapter id and version", () => {
    const document = loadFixture();
    const fields = genericAdapter.scan(document);
    for (const field of fields) {
      const decision = genericAdapter.classify(field);
      expect(decision.adapterId).toBe("generic");
      expect(decision.adapterVersion).toBe("generic@1");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run extension/test/adapters-generic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// extension/src/adapters/generic.ts
import type { Adapter, CandidateSnapshot, DetectedField, FieldDecision } from "./types";
import { matchSafeCatalogField } from "./safe-catalog";
import { isLegalDeclarationField } from "./legal-patterns";

const ADAPTER_ID = "generic";
const ADAPTER_VERSION = "generic@1";

function labelFor(input: HTMLInputElement, document: Document): string {
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent?.trim() ?? "";
  }
  const parentLabel = input.closest("label");
  return parentLabel?.textContent?.trim() ?? input.name ?? "";
}

export const genericAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(document: Document): boolean {
    return document.querySelectorAll("input, textarea").length > 0;
  },

  scan(document: Document): DetectedField[] {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("input, textarea"),
    );
    return inputs.map((input, index) => ({
      pageFieldKey: `generic:${input.name || input.id || `field_${index}`}`,
      labelText: labelFor(input, document),
      domRef: input,
    }));
  },

  classify(field: DetectedField): FieldDecision {
    if (isLegalDeclarationField(field.labelText)) {
      return {
        normalizedFieldType: "legal_declaration",
        behavior: "never",
        mappingReason: "pattern match: certification/signature language",
        sourceKind: "none",
        requiresUserApproval: false,
        adapterId: ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
      };
    }
    const safeType = matchSafeCatalogField(field.labelText);
    if (safeType) {
      return {
        normalizedFieldType: safeType,
        behavior: "autofill",
        mappingReason: `shared safe catalog: contact.${safeType}`,
        sourceKind: "safe_fact",
        requiresUserApproval: false,
        adapterId: ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
      };
    }
    // Structural default (design spec Section 8.2): the generic fallback
    // never escalates beyond the safe catalog. Everything else is `ask`.
    return {
      normalizedFieldType: "unknown",
      behavior: "ask",
      mappingReason: "generic fallback: unmatched field, default ask",
      sourceKind: "none",
      requiresUserApproval: false,
      adapterId: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
    };
  },

  map(field: DetectedField, snapshot: CandidateSnapshot): string | null {
    const safeType = matchSafeCatalogField(field.labelText);
    if (safeType === "name") return snapshot.identity.name?.value ?? null;
    if (safeType && safeType in snapshot.contact) {
      return snapshot.contact[safeType]?.value ?? null;
    }
    return null;
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run extension/test/adapters-generic.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/adapters/generic.ts extension/test/fixtures/generic.html extension/test/adapters-generic.test.ts
git commit -m "feat: add generic fallback adapter"
```

---

## Task 14: Greenhouse adapter (named, versioned, with one unambiguous employment field)

**Files:**
- Create: `extension/src/adapters/greenhouse.ts`
- Create: `extension/test/fixtures/greenhouse.html`
- Create: `extension/test/adapters-greenhouse.test.ts`

**Interfaces:**
- Produces: `greenhouseAdapter: Adapter` with `id: "greenhouse"`,
  `version: "greenhouse@1"`. Demonstrates the one adapter-specific
  `autofill` rule beyond the shared catalog: an explicitly labeled "Most
  Recent Employer" field, per design spec Section 8.1's requirement that
  such a rule only exists where the ATS's own form makes the target
  unambiguous.

- [ ] **Step 1: Write the fixture and the failing test**

```html
<!-- extension/test/fixtures/greenhouse.html -->
<!doctype html>
<html><body>
  <div id="application_form">
    <label for="job_application_first_name">First Name</label>
    <input id="job_application_first_name" name="job_application[first_name]">
    <label for="job_application_email">Email</label>
    <input id="job_application_email" name="job_application[email]">
    <label for="job_application_most_recent_employer">Most Recent Employer</label>
    <input id="job_application_most_recent_employer" name="job_application[most_recent_employer]">
    <label for="job_application_years_experience">Years of Experience</label>
    <input id="job_application_years_experience" name="job_application[years_experience]">
    <label for="job_application_disability_status">Disability Status (Voluntary)</label>
    <select id="job_application_disability_status" name="job_application[disability_status]">
      <option>Yes</option><option>No</option><option>Prefer not to say</option>
    </select>
    <button type="submit" id="submit_app">Submit Application</button>
  </div>
</body></html>
```

```typescript
// extension/test/adapters-greenhouse.test.ts
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { greenhouseAdapter } from "../src/adapters/greenhouse";

function loadFixture(): Document {
  const html = readFileSync(new URL("./fixtures/greenhouse.html", import.meta.url), "utf-8");
  return new JSDOM(html).window.document;
}

describe("greenhouse adapter", () => {
  it("detects a Greenhouse-shaped application form", () => {
    expect(greenhouseAdapter.detect(loadFixture())).toBe(true);
  });

  it("autofills the unambiguous most-recent-employer field via an adapter rule", () => {
    const document = loadFixture();
    const fields = greenhouseAdapter.scan(document);
    const employer = fields.find((f) => f.labelText === "Most Recent Employer")!;
    const decision = greenhouseAdapter.classify(employer);
    expect(decision.behavior).toBe("autofill");
    expect(decision.sourceKind).toBe("adapter_rule");
  });

  it("classifies years-of-experience as suggest, never autofill", () => {
    const document = loadFixture();
    const fields = greenhouseAdapter.scan(document);
    const years = fields.find((f) => f.labelText === "Years of Experience")!;
    const decision = greenhouseAdapter.classify(years);
    expect(decision.behavior).toBe("suggest");
    expect(decision.requiresUserApproval).toBe(true);
  });

  it("classifies disability status as ask, never captured automatically", () => {
    const document = loadFixture();
    const fields = greenhouseAdapter.scan(document);
    const disability = fields.find((f) => f.labelText.includes("Disability"))!;
    expect(greenhouseAdapter.classify(disability).behavior).toBe("ask");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run extension/test/adapters-greenhouse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// extension/src/adapters/greenhouse.ts
import type { Adapter, CandidateSnapshot, DetectedField, FieldDecision } from "./types";
import { matchSafeCatalogField } from "./safe-catalog";
import { isLegalDeclarationField } from "./legal-patterns";

const ADAPTER_ID = "greenhouse";
const ADAPTER_VERSION = "greenhouse@1";

function labelFor(input: Element, document: Document): string {
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent?.trim() ?? "";
  }
  return "";
}

export const greenhouseAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(document: Document): boolean {
    return document.querySelector("#application_form") !== null;
  },

  scan(document: Document): DetectedField[] {
    const inputs = Array.from(
      document.querySelectorAll<HTMLElement>(
        "#application_form input, #application_form select",
      ),
    );
    return inputs.map((input) => ({
      pageFieldKey: `greenhouse:application:${input.id}`,
      labelText: labelFor(input, document),
      domRef: input,
    }));
  },

  classify(field: DetectedField): FieldDecision {
    if (isLegalDeclarationField(field.labelText)) {
      return {
        normalizedFieldType: "legal_declaration", behavior: "never",
        mappingReason: "pattern match: certification/signature language",
        sourceKind: "none", requiresUserApproval: false,
        adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
      };
    }
    // Adapter-specific rule (design spec Section 8.1): Greenhouse's own
    // form makes this field's meaning unambiguous ("Most Recent
    // Employer" is explicitly labeled, unlike a bare "Employer" field
    // that could mean any of several roles), so this specific label may
    // autofill from employment[0] even though employment fields are never
    // in the shared universal catalog.
    if (field.labelText === "Most Recent Employer") {
      return {
        normalizedFieldType: "employment[0].employer", behavior: "autofill",
        mappingReason: "adapter rule: greenhouse most_recent_employer",
        sourceKind: "adapter_rule", requiresUserApproval: false,
        adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
      };
    }
    if (field.labelText === "Years of Experience") {
      return {
        normalizedFieldType: "years_of_experience", behavior: "suggest",
        mappingReason: "adapter rule: greenhouse derived years_of_experience",
        sourceKind: "adapter_rule", requiresUserApproval: true,
        adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
      };
    }
    const safeType = matchSafeCatalogField(field.labelText);
    if (safeType) {
      return {
        normalizedFieldType: safeType, behavior: "autofill",
        mappingReason: `shared safe catalog: contact.${safeType}`,
        sourceKind: "safe_fact", requiresUserApproval: false,
        adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
      };
    }
    return {
      normalizedFieldType: "unknown", behavior: "ask",
      mappingReason: "generic fallback: unmatched field, default ask",
      sourceKind: "none", requiresUserApproval: false,
      adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
    };
  },

  map(field: DetectedField, snapshot: CandidateSnapshot): string | null {
    if (field.labelText === "Most Recent Employer") {
      return snapshot.employment[0]?.employer?.value ?? null;
    }
    const safeType = matchSafeCatalogField(field.labelText);
    if (safeType === "name") return snapshot.identity.name?.value ?? null;
    if (safeType && safeType in snapshot.contact) {
      return snapshot.contact[safeType]?.value ?? null;
    }
    return null; // years_of_experience derivation is implemented in Task 15
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run extension/test/adapters-greenhouse.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/adapters/greenhouse.ts extension/test/fixtures/greenhouse.html extension/test/adapters-greenhouse.test.ts
git commit -m "feat: add greenhouse adapter with unambiguous employment rule"
```

---

## Task 15: Lever adapter and the derivation-identifier requirement for suggested values

**Files:**
- Create: `extension/src/adapters/lever.ts`
- Create: `extension/src/adapters/derivations.ts`
- Create: `extension/test/fixtures/lever.html`
- Create: `extension/test/adapters-lever.test.ts`
- Create: `extension/test/derivations.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // extension/src/adapters/derivations.ts
  export interface Derivation {
    id: string;   // e.g. "years_of_experience_from_employment_dates"
    version: string; // e.g. "1"
    compute(snapshot: CandidateSnapshot): string | null;
  }
  export const yearsOfExperienceFromEmploymentDates: Derivation;
  ```
  `leverAdapter: Adapter` with `id: "lever"`, `version: "lever@1"`.
  Consumed by Task 16 and Phase 3.

- [ ] **Step 1: Write the fixture and the failing tests**

```html
<!-- extension/test/fixtures/lever.html -->
<!doctype html>
<html><body>
  <form class="application-form">
    <label>Full name<input name="name"></label>
    <label>Email<input name="email"></label>
    <label>Phone<input name="phone"></label>
    <label>Current location<input name="location"></label>
    <label>Additional Information<textarea name="comments"></textarea></label>
    <label>
      <input type="checkbox" name="gdpr_consent">
      I certify the above information is accurate
    </label>
    <button type="submit" class="postings-btn-submit">Submit application</button>
  </form>
</body></html>
```

```typescript
// extension/test/derivations.test.ts
import { describe, expect, it } from "vitest";
import { yearsOfExperienceFromEmploymentDates } from "../src/adapters/derivations";
import type { CandidateSnapshot } from "../src/adapters/types";

describe("years-of-experience derivation", () => {
  it("has a stable id and version for provenance binding", () => {
    expect(yearsOfExperienceFromEmploymentDates.id).toBe(
      "years_of_experience_from_employment_dates",
    );
    expect(yearsOfExperienceFromEmploymentDates.version).toBe("1");
  });

  it("computes years from the earliest employment date_range", () => {
    const snapshot = {
      identity: { name: { value: "Test User", profile_evidence_ids: [] } },
      contact: {},
      employment: [
        { record_id: "rec_1", role: null, employer: null,
          date_range: { value: "2019 - Present", profile_evidence_ids: ["clm_1"] },
          location: null, details: [] },
      ],
    } satisfies CandidateSnapshot;
    const result = yearsOfExperienceFromEmploymentDates.compute(snapshot);
    expect(result).not.toBeNull();
  });

  it("returns null when no employment data exists", () => {
    const snapshot = {
      identity: { name: { value: "Test User", profile_evidence_ids: [] } },
      contact: {}, employment: [],
    } satisfies CandidateSnapshot;
    expect(yearsOfExperienceFromEmploymentDates.compute(snapshot)).toBeNull();
  });
});
```

```typescript
// extension/test/adapters-lever.test.ts
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { leverAdapter } from "../src/adapters/lever";

function loadFixture(): Document {
  const html = readFileSync(new URL("./fixtures/lever.html", import.meta.url), "utf-8");
  return new JSDOM(html).window.document;
}

describe("lever adapter", () => {
  it("detects a Lever-shaped application form", () => {
    expect(leverAdapter.detect(loadFixture())).toBe(true);
  });

  it("autofills only the safe catalog fields", () => {
    const document = loadFixture();
    const fields = leverAdapter.scan(document);
    const byLabel = Object.fromEntries(fields.map((f) => [f.labelText, f]));
    expect(leverAdapter.classify(byLabel["Full name"]).behavior).toBe("autofill");
    expect(leverAdapter.classify(byLabel["Email"]).behavior).toBe("autofill");
  });

  it("classifies the free-text additional-information field as ask", () => {
    const document = loadFixture();
    const fields = leverAdapter.scan(document);
    const additional = fields.find((f) => f.labelText === "Additional Information")!;
    expect(leverAdapter.classify(additional).behavior).toBe("ask");
  });

  it("classifies the certification checkbox as never", () => {
    const document = loadFixture();
    const fields = leverAdapter.scan(document);
    const cert = fields.find((f) => f.labelText.includes("certify"))!;
    expect(leverAdapter.classify(cert).behavior).toBe("never");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run extension/test/derivations.test.ts extension/test/adapters-lever.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

```typescript
// extension/src/adapters/derivations.ts
import type { CandidateSnapshot } from "./types";

export interface Derivation {
  id: string;
  version: string;
  compute(snapshot: CandidateSnapshot): string | null;
}

function parseStartYear(dateRange: string): number | null {
  const match = dateRange.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

// Provenance for a value produced by this function must carry this
// derivation's id/version alongside the pack facts it was computed from
// (design spec Section 11.4), so it is never mistaken for a literal
// candidate-snapshot fact.
export const yearsOfExperienceFromEmploymentDates: Derivation = {
  id: "years_of_experience_from_employment_dates",
  version: "1",
  compute(snapshot: CandidateSnapshot): string | null {
    const startYears = snapshot.employment
      .map((entry) => entry.date_range?.value)
      .filter((value): value is string => Boolean(value))
      .map(parseStartYear)
      .filter((year): year is number => year !== null);
    if (startYears.length === 0) return null;
    const earliest = Math.min(...startYears);
    const currentYear = new Date().getFullYear();
    return String(currentYear - earliest);
  },
};
```

```typescript
// extension/src/adapters/lever.ts
import type { Adapter, CandidateSnapshot, DetectedField, FieldDecision } from "./types";
import { matchSafeCatalogField } from "./safe-catalog";
import { isLegalDeclarationField } from "./legal-patterns";

const ADAPTER_ID = "lever";
const ADAPTER_VERSION = "lever@1";

export const leverAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(document: Document): boolean {
    return document.querySelector("form.application-form") !== null;
  },

  scan(document: Document): DetectedField[] {
    const form = document.querySelector("form.application-form")!;
    const inputs = Array.from(form.querySelectorAll<HTMLElement>("input, textarea"));
    return inputs.map((input, index) => {
      const label = input.closest("label");
      return {
        pageFieldKey: `lever:application:${index}`,
        labelText: label?.textContent?.replace(input.textContent ?? "", "").trim()
          ?? label?.firstChild?.textContent?.trim() ?? "",
        domRef: input,
      };
    });
  },

  classify(field: DetectedField): FieldDecision {
    if (isLegalDeclarationField(field.labelText)) {
      return {
        normalizedFieldType: "legal_declaration", behavior: "never",
        mappingReason: "pattern match: certification/signature language",
        sourceKind: "none", requiresUserApproval: false,
        adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
      };
    }
    const safeType = matchSafeCatalogField(field.labelText);
    if (safeType) {
      return {
        normalizedFieldType: safeType, behavior: "autofill",
        mappingReason: `shared safe catalog: contact.${safeType}`,
        sourceKind: "safe_fact", requiresUserApproval: false,
        adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
      };
    }
    return {
      normalizedFieldType: "unknown", behavior: "ask",
      mappingReason: "generic fallback: unmatched field, default ask",
      sourceKind: "none", requiresUserApproval: false,
      adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
    };
  },

  map(field: DetectedField, snapshot: CandidateSnapshot): string | null {
    const safeType = matchSafeCatalogField(field.labelText);
    if (safeType === "name") return snapshot.identity.name?.value ?? null;
    if (safeType && safeType in snapshot.contact) {
      return snapshot.contact[safeType]?.value ?? null;
    }
    return null;
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run extension/test/derivations.test.ts extension/test/adapters-lever.test.ts`
Expected: PASS (7 tests total)

- [ ] **Step 5: Run the full extension test suite so far**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/adapters/lever.ts extension/src/adapters/derivations.ts extension/test/fixtures/lever.html extension/test/adapters-lever.test.ts extension/test/derivations.test.ts
git commit -m "feat: add lever adapter and years-of-experience derivation"
```

---

## Task 16: Background worker — durable idempotent event queue

**Files:**
- Create: `extension/src/background/event-queue.ts`
- Create: `extension/test/event-queue.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface QueuedEvent {
    eventId: string;
    clientSequence: number;
    handoffSessionId: string;
    eventType: string;
    eventPayload: Record<string, unknown>;
    normalizedFieldType?: string;
    pageFieldKey?: string;
    observedAt: string;
  }

  export interface EventStore {
    getAll(): Promise<QueuedEvent[]>;
    add(event: QueuedEvent): Promise<void>;
    remove(eventId: string): Promise<void>;
  }

  export class DurableEventQueue {
    constructor(store: EventStore, sender: (event: QueuedEvent) => Promise<boolean>);
    enqueue(event: QueuedEvent): Promise<void>;
    flush(): Promise<void>; // retries all unsent events in clientSequence order
  }
  ```
  `sender` returning `true` means the server acknowledged (2xx, including
  an idempotent-retry 2xx); the queue removes the event from the store
  only then. `false` means retry later; the event stays queued. This
  models `chrome.storage.local` as `EventStore` without depending on the
  real browser API in unit tests (Chrome-specific wiring is Task 17).

- [ ] **Step 1: Write the failing tests**

```typescript
// extension/test/event-queue.test.ts
import { describe, expect, it, vi } from "vitest";
import { DurableEventQueue, type EventStore, type QueuedEvent } from "../src/background/event-queue";

class InMemoryStore implements EventStore {
  private events: QueuedEvent[] = [];
  async getAll() { return [...this.events]; }
  async add(event: QueuedEvent) { this.events.push(event); }
  async remove(eventId: string) {
    this.events = this.events.filter((e) => e.eventId !== eventId);
  }
}

function makeEvent(overrides: Partial<QueuedEvent> = {}): QueuedEvent {
  return {
    eventId: "evt_1", clientSequence: 1, handoffSessionId: "hs_1",
    eventType: "field_detected", eventPayload: {}, observedAt: "2026-08-24T00:00:00Z",
    ...overrides,
  };
}

describe("DurableEventQueue", () => {
  it("removes an event from the store only after the sender acknowledges", async () => {
    const store = new InMemoryStore();
    const sender = vi.fn().mockResolvedValue(true);
    const queue = new DurableEventQueue(store, sender);

    await queue.enqueue(makeEvent());
    expect(await store.getAll()).toHaveLength(1);

    await queue.flush();
    expect(sender).toHaveBeenCalledOnce();
    expect(await store.getAll()).toHaveLength(0);
  });

  it("keeps a failed event queued for retry", async () => {
    const store = new InMemoryStore();
    const sender = vi.fn().mockResolvedValue(false);
    const queue = new DurableEventQueue(store, sender);

    await queue.enqueue(makeEvent());
    await queue.flush();
    expect(await store.getAll()).toHaveLength(1);
  });

  it("retries in clientSequence order after simulated worker restart", async () => {
    const store = new InMemoryStore();
    await store.add(makeEvent({ eventId: "evt_2", clientSequence: 2 }));
    await store.add(makeEvent({ eventId: "evt_1", clientSequence: 1 }));

    const order: string[] = [];
    const sender = vi.fn().mockImplementation(async (event: QueuedEvent) => {
      order.push(event.eventId);
      return true;
    });
    // simulates a fresh queue instance after the service worker restarted,
    // reading whatever was already durably stored
    const queue = new DurableEventQueue(store, sender);
    await queue.flush();

    expect(order).toEqual(["evt_1", "evt_2"]);
  });

  it("never mints a new eventId to resolve a failed delivery", async () => {
    const store = new InMemoryStore();
    let attempts = 0;
    const sender = vi.fn().mockImplementation(async () => {
      attempts += 1;
      return attempts > 1; // fails first attempt, succeeds second
    });
    const queue = new DurableEventQueue(store, sender);
    await queue.enqueue(makeEvent());

    await queue.flush(); // fails
    await queue.flush(); // succeeds

    const sentEventIds = sender.mock.calls.map(([event]) => event.eventId);
    expect(new Set(sentEventIds)).toEqual(new Set(["evt_1"]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run extension/test/event-queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// extension/src/background/event-queue.ts
export interface QueuedEvent {
  eventId: string;
  clientSequence: number;
  handoffSessionId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  normalizedFieldType?: string;
  pageFieldKey?: string;
  observedAt: string;
}

export interface EventStore {
  getAll(): Promise<QueuedEvent[]>;
  add(event: QueuedEvent): Promise<void>;
  remove(eventId: string): Promise<void>;
}

export class DurableEventQueue {
  constructor(
    private readonly store: EventStore,
    private readonly sender: (event: QueuedEvent) => Promise<boolean>,
  ) {}

  async enqueue(event: QueuedEvent): Promise<void> {
    // Persisted before any network attempt (design spec Section 13) —
    // this is what survives a killed service worker.
    await this.store.add(event);
  }

  async flush(): Promise<void> {
    const pending = await this.store.getAll();
    const inOrder = [...pending].sort((a, b) => a.clientSequence - b.clientSequence);
    for (const event of inOrder) {
      const acknowledged = await this.sender(event);
      if (acknowledged) {
        await this.store.remove(event.eventId);
      }
      // On failure the event simply stays in the store with its original
      // eventId; the caller never mints a new one to "resolve" the retry.
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run extension/test/event-queue.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/background/event-queue.ts extension/test/event-queue.test.ts
git commit -m "feat: add durable idempotent background event queue"
```

---

## Task 17: Extension manifest and Chrome storage wiring

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/src/background/chrome-event-store.ts`
- Create: `extension/src/background/credential-store.ts`
- Create: `extension/src/background/server-client.ts`

This task has no isolated unit test of its own — `chrome.storage`/`fetch`
are real browser APIs with no meaningful fixture-level behavior to assert
beyond "calls the right chrome API," which the Phase 3 Chrome acceptance
tests exercise for real. This task's deliverable is verified by Task 19's
end-to-end wiring test instead.

- [ ] **Step 1: Write the manifest**

```json
{
  "manifest_version": 3,
  "name": "JobSearch Application Handoff",
  "version": "0.1.0",
  "description": "Autofill and document handoff for confirmed JobSearch application packs.",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": [],
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "action": {
    "default_title": "JobSearch Handoff"
  },
  "content_scripts": []
}
```

`host_permissions` is deliberately empty and `content_scripts` is
deliberately empty at manifest level — content-script injection happens
via `chrome.scripting.executeScript` triggered by the user invoking the
extension on the active tab (`activeTab` permission), never via a
declarative `<all_urls>` match pattern (design spec Section 17, "narrow
host permissions").

- [ ] **Step 2: Write the Chrome-backed `EventStore` implementation**

```typescript
// extension/src/background/chrome-event-store.ts
import type { EventStore, QueuedEvent } from "./event-queue";

const STORAGE_KEY = "handoff_event_queue";

export class ChromeEventStore implements EventStore {
  async getAll(): Promise<QueuedEvent[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as QueuedEvent[] | undefined) ?? [];
  }

  async add(event: QueuedEvent): Promise<void> {
    const all = await this.getAll();
    all.push(event);
    await chrome.storage.local.set({ [STORAGE_KEY]: all });
  }

  async remove(eventId: string): Promise<void> {
    const all = await this.getAll();
    await chrome.storage.local.set({
      [STORAGE_KEY]: all.filter((event) => event.eventId !== eventId),
    });
  }
}
```

- [ ] **Step 3: Write the credential store**

```typescript
// extension/src/background/credential-store.ts
const CREDENTIAL_KEY = "handoff_extension_credential";

// The ONLY module that ever reads or writes the durable extension
// credential (design spec Section 5). Content scripts never import this.
export class CredentialStore {
  async get(): Promise<string | null> {
    const result = await chrome.storage.local.get(CREDENTIAL_KEY);
    return (result[CREDENTIAL_KEY] as string | undefined) ?? null;
  }

  async set(credential: string): Promise<void> {
    await chrome.storage.local.set({ [CREDENTIAL_KEY]: credential });
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(CREDENTIAL_KEY);
  }
}
```

- [ ] **Step 4: Write the server client**

```typescript
// extension/src/background/server-client.ts
import type { QueuedEvent } from "./event-queue";

const BASE_URL = "http://127.0.0.1:8420";

// The ONLY module that makes HTTP calls to the JobSearch server (design
// spec Section 4 / Section 17 — content scripts never call this
// directly, only through messages relayed by the background worker).
export class ServerClient {
  constructor(private readonly getCredential: () => Promise<string | null>) {}

  private async headers(): Promise<Record<string, string>> {
    const credential = await this.getCredential();
    if (!credential) throw new Error("extension is not paired");
    return { "X-Handoff-Credential": credential, "Content-Type": "application/json" };
  }

  async startSession(body: {
    workspaceId: string; packArtifactId: string; targetUrl: string;
    targetDomain: string; atsAdapterId: string; atsAdapterVersion: string;
  }): Promise<{ id: string }> {
    const response = await fetch(`${BASE_URL}/api/handoff/sessions`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({
        workspace_id: body.workspaceId, pack_artifact_id: body.packArtifactId,
        target_url: body.targetUrl, target_domain: body.targetDomain,
        ats_adapter_id: body.atsAdapterId, ats_adapter_version: body.atsAdapterVersion,
      }),
    });
    if (!response.ok) throw new Error(`failed to start handoff session: ${response.status}`);
    return response.json();
  }

  async sendEvent(event: QueuedEvent): Promise<boolean> {
    const response = await fetch(
      `${BASE_URL}/api/handoff/sessions/${event.handoffSessionId}/events`,
      {
        method: "POST", headers: await this.headers(),
        body: JSON.stringify({
          event_id: event.eventId, event_type: event.eventType,
          event_payload: event.eventPayload,
          normalized_field_type: event.normalizedFieldType ?? null,
          page_field_key: event.pageFieldKey ?? null,
          observed_at: event.observedAt,
        }),
      },
    );
    return response.ok;
  }

  async confirmSubmission(
    handoffSessionId: string, markWorkflowApplied: boolean,
  ): Promise<unknown> {
    const response = await fetch(
      `${BASE_URL}/api/handoff/sessions/${handoffSessionId}/confirm-submission`,
      {
        method: "POST", headers: await this.headers(),
        body: JSON.stringify({ mark_workflow_applied: markWorkflowApplied }),
      },
    );
    if (!response.ok) throw new Error(`failed to confirm submission: ${response.status}`);
    return response.json();
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/src/background/chrome-event-store.ts extension/src/background/credential-store.ts extension/src/background/server-client.ts
git commit -m "feat: add extension manifest and chrome-backed storage/server clients"
```

---

## Task 18: Document attachment — reusing the exact render route and recording honest outcomes

**Files:**
- Create: `extension/src/background/attachment.ts`
- Create: `extension/test/attachment.test.ts`

**Interfaces:**
- Consumes: `ServerClient` (Task 17, extended below);
  `DurableEventQueue.enqueue` (Task 16).
- Produces:
  ```typescript
  // extension/src/background/attachment.ts
  export type AttachmentOutcome =
    | "selected" | "upload_confirmed_by_adapter" | "rejected" | "unknown";

  export interface RenderedDocument {
    kind: "cv" | "cover_letter";
    filename: string;
    mimeType: string;
    sha256: string;
    byteLength: number;
    bytes: ArrayBuffer;
  }

  export async function fetchExactPackDocument(
    baseUrl: string, credential: string, workspaceId: string,
    packArtifactId: string, kind: "cv" | "cover_letter",
  ): Promise<RenderedDocument>;

  export function buildAttachmentEventPayload(
    document: RenderedDocument, packArtifactId: string,
    rendererVersion: string, outcome: AttachmentOutcome,
  ): Record<string, unknown>;
  ```
  This function performs no caching and no new persistence of file bytes
  (design spec Section 7) — it calls the existing render route fresh each
  time and returns only what is needed to build one attachment event.

- [ ] **Step 1: Write the failing tests**

```typescript
// extension/test/attachment.test.ts
import { describe, expect, it, vi } from "vitest";
import { buildAttachmentEventPayload, fetchExactPackDocument } from "../src/background/attachment";

describe("fetchExactPackDocument", () => {
  it("calls the exact render route with the pinned pack_artifact_id and reads the hash header", async () => {
    const bytes = new TextEncoder().encode("fake docx bytes").buffer;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([
        ["content-disposition", 'attachment; filename="Acme_Engineer_CV.docx"'],
        ["content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        ["x-content-hash", "sha256:abc123"],
      ]),
      arrayBuffer: async () => bytes,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchExactPackDocument(
      "http://127.0.0.1:8420", "cred-123", "ws_1", "art_XYZ", "cv",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8420/api/workspaces/ws_1/application-pack/render/cv?pack_artifact_id=art_XYZ",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Handoff-Credential": "cred-123" }) }),
    );
    expect(result.sha256).toBe("sha256:abc123");
    expect(result.filename).toBe("Acme_Engineer_CV.docx");
    expect(result.byteLength).toBe(bytes.byteLength);
    vi.unstubAllGlobals();
  });

  it("always includes the explicit pack_artifact_id, never omitting it for a handoff session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([
        ["content-disposition", 'attachment; filename="x.docx"'],
        ["content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        ["x-content-hash", "sha256:def456"],
      ]),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchExactPackDocument("http://127.0.0.1:8420", "cred", "ws_1", "art_PINNED", "cover_letter");

    const [calledUrl] = fetchMock.mock.calls[0] as [string, unknown];
    expect(calledUrl).toContain("pack_artifact_id=art_PINNED");
    vi.unstubAllGlobals();
  });
});

describe("buildAttachmentEventPayload", () => {
  it("carries the exact pack id, renderer version, hash, and outcome — never a bare boolean", () => {
    const doc = {
      kind: "cv" as const, filename: "Acme_Engineer_CV.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sha256: "sha256:abc123", byteLength: 42, bytes: new ArrayBuffer(42),
    };
    const payload = buildAttachmentEventPayload(
      doc, "art_XYZ", "application-pack-renderer.v2", "selected",
    );
    expect(payload).toEqual({
      kind: "cv", filename: "Acme_Engineer_CV.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sha256: "sha256:abc123", byte_length: 42,
      pack_artifact_id: "art_XYZ", renderer_version: "application-pack-renderer.v2",
      outcome: "selected",
    });
  });

  it("supports the unknown outcome as an honest default, never upgraded to selected", () => {
    const doc = {
      kind: "cover_letter" as const, filename: "x.docx", mimeType: "x",
      sha256: "sha256:x", byteLength: 1, bytes: new ArrayBuffer(1),
    };
    const payload = buildAttachmentEventPayload(doc, "art_1", "v2", "unknown");
    expect(payload.outcome).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run extension/test/attachment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// extension/src/background/attachment.ts
export type AttachmentOutcome =
  | "selected" | "upload_confirmed_by_adapter" | "rejected" | "unknown";

export interface RenderedDocument {
  kind: "cv" | "cover_letter";
  filename: string;
  mimeType: string;
  sha256: string;
  byteLength: number;
  bytes: ArrayBuffer;
}

function parseFilename(contentDisposition: string): string {
  const match = contentDisposition.match(/filename="([^"]+)"/);
  return match ? match[1] : "document.docx";
}

// Calls the existing render route fresh every time (design spec Section
// 7) — no caching, no new persisted file bytes. pack_artifact_id is
// always explicit and always the session's pinned value; this function
// has no parameter that could omit it and fall back to "current".
export async function fetchExactPackDocument(
  baseUrl: string,
  credential: string,
  workspaceId: string,
  packArtifactId: string,
  kind: "cv" | "cover_letter",
): Promise<RenderedDocument> {
  const url =
    `${baseUrl}/api/workspaces/${workspaceId}/application-pack/render/${kind}` +
    `?pack_artifact_id=${encodeURIComponent(packArtifactId)}`;
  const response = await fetch(url, {
    headers: { "X-Handoff-Credential": credential },
  });
  if (!response.ok) {
    throw new Error(`failed to render ${kind} for pack ${packArtifactId}: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return {
    kind,
    filename: parseFilename(response.headers.get("content-disposition") ?? ""),
    mimeType: response.headers.get("content-type") ?? "application/octet-stream",
    sha256: response.headers.get("x-content-hash") ?? "",
    byteLength: bytes.byteLength,
    bytes,
  };
}

// Builds the event_payload for an upload_selected / upload_confirmed /
// upload_failed event (design spec Section 7, Section 11). The outcome
// vocabulary is deliberately not a boolean: "selected" proves only that
// the extension attempted the attachment, not that the ATS's own
// asynchronous upload completed.
export function buildAttachmentEventPayload(
  document: RenderedDocument,
  packArtifactId: string,
  rendererVersion: string,
  outcome: AttachmentOutcome,
): Record<string, unknown> {
  return {
    kind: document.kind,
    filename: document.filename,
    mime_type: document.mimeType,
    sha256: document.sha256,
    byte_length: document.byteLength,
    pack_artifact_id: packArtifactId,
    renderer_version: rendererVersion,
    outcome,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run extension/test/attachment.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Run the full extension test suite for regressions**

Run: `cd extension && npx vitest run && cd ..`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/background/attachment.ts extension/test/attachment.test.ts
git commit -m "feat: add exact-pack document attachment with honest outcome recording"
```

---

# Phase 3: Chrome Acceptance Tests

Phase 3 exercises the full stack (Phase 1 server + Phase 2 extension
logic conceptually, though Playwright drives the page/server directly —
see the note in Task 19) against local fixture pages, matching the
`live_server`/Playwright `page` pattern from `tests/webapp/
test_browser_smoke.py`. No live Workday/Greenhouse/Lever dependency.

## Task 19: Fixture-serving route and the first end-to-end acceptance test

**Files:**
- Create: `tests/webapp/fixtures/handoff/generic_fixture.html` (same
  content as `extension/test/fixtures/generic.html`, kept in sync
  manually since one is served by pytest/Playwright and the other is
  loaded by Vitest/JSDOM — no shared build step exists yet in this repo)
- Modify: `webapp/api/dependencies.py` or create
  `webapp/api/handoff_test_fixtures.py` (decided in Step 1 below)
- Create: `tests/webapp/test_handoff_browser_smoke.py`

**Interfaces:**
- Consumes: `webapp.app.create_app`, the Phase 1 `/api/handoff/*` routes,
  the `live_server` fixture pattern from `tests/webapp/
  test_browser_smoke.py`.

- [ ] **Step 1: Decide and implement fixture serving**

Inspect `webapp/app.py` for how `webapp/static/` is currently mounted
(this repo already serves `/static/app.css` per the browser-smoke test
suite seen in Section 2.5's evidence). Add a second static mount for test
fixtures, gated so it only exists when `Settings` carries a
fixtures directory (never mounted in a real user's running instance):

```python
# in webapp/app.py, inside create_app, alongside the existing static mount
if settings.handoff_fixtures_dir is not None:
    app.mount(
        "/test-fixtures/handoff",
        StaticFiles(directory=str(settings.handoff_fixtures_dir)),
        name="handoff_fixtures",
    )
```

Add `handoff_fixtures_dir: Path | None = None` to `webapp/config.py`'s
`Settings` dataclass, defaulting to `None` so production/normal usage is
completely unaffected — this mount is opt-in per `Settings` instance, not
always-on.

- [ ] **Step 2: Copy the fixture file**

```bash
mkdir -p tests/webapp/fixtures/handoff
cp extension/test/fixtures/generic.html tests/webapp/fixtures/handoff/generic_fixture.html
```

- [ ] **Step 3: Write the failing acceptance test**

```python
# tests/webapp/test_handoff_browser_smoke.py
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace, ensure_profile_workspace

_FIXTURES_DIR = Path(__file__).parent / "fixtures" / "handoff"


def _live_server_settings(tmp_path):
    return Settings(
        db_path=tmp_path / "jobsearch.sqlite3",
        documents_root=tmp_path / "documents",
        handoff_fixtures_dir=_FIXTURES_DIR,
    )


def test_generic_fixture_page_is_served(tmp_path):
    settings = _live_server_settings(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.get("/test-fixtures/handoff/generic_fixture.html")
        assert response.status_code == 200
        assert "Full Name" in response.text
        assert "certify" in response.text


def test_handoff_session_lifecycle_against_fixture_workspace(tmp_path):
    settings = _live_server_settings(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:
        conn = connect(settings.db_path)
        ensure_profile_workspace(conn)
        workspace = create_workspace(conn, company="Acme", title="Engineer")
        artifact = save_artifact(
            conn, workspace_id=workspace["id"], artifact_type="application_pack",
            payload={"schema_version": "application-pack.v1"},
        )
        conn.close()

        generated = client.post("/api/handoff/pairing/generate")
        one_time_secret = generated.json()["one_time_secret"]
        exchanged = client.post(
            "/api/handoff/pairing/exchange", json={"one_time_secret": one_time_secret},
        )
        credential = exchanged.json()["durable_secret"]
        headers = {"X-Handoff-Credential": credential}

        started = client.post(
            "/api/handoff/sessions", headers=headers,
            json={
                "workspace_id": workspace["id"], "pack_artifact_id": artifact["id"],
                "target_url": "http://testserver/test-fixtures/handoff/generic_fixture.html",
                "target_domain": "testserver", "ats_adapter_id": "generic",
                "ats_adapter_version": "generic@1",
            },
        )
        assert started.status_code == 201
        session_id = started.json()["id"]

        # Simulates what the extension's content script + background
        # worker would report after scanning the real fixture page: only
        # safe-catalog fields autofilled, the certification checkbox
        # never touched.
        for field_name, value in [("name", "Test User"), ("email", "test@example.com")]:
            response = client.post(
                f"/api/handoff/sessions/{session_id}/events", headers=headers,
                json={
                    "event_id": f"evt_{field_name}", "event_type": "value_inserted",
                    "event_payload": {"value": value},
                    "normalized_field_type": field_name,
                    "page_field_key": f"generic:{field_name}",
                },
            )
            assert response.status_code == 201

        replay = client.get(
            f"/api/handoff/sessions/{session_id}/events", headers=headers
        )
        events = replay.json()["events"]
        assert len(events) == 2
        assert all(event["event_type"] == "value_inserted" for event in events)

        confirmed = client.post(
            f"/api/handoff/sessions/{session_id}/confirm-submission",
            headers=headers, json={"mark_workflow_applied": False},
        )
        assert confirmed.status_code == 201
        assert confirmed.json()["session"]["status"] == "user_confirmed_submitted"
```

Note on scope: this task proves the server-side contract end-to-end
against a real served fixture page and real HTTP round trips — it does
not yet drive a real Playwright browser clicking into that page, because
the actual content-script/background-worker JS has no browser runtime to
execute inside a `pytest` process. Task 20 adds the real Playwright-driven
version once a minimal bundled content script exists to inject.

- [ ] **Step 4: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/test_handoff_browser_smoke.py -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'handoff_fixtures_dir'`

- [ ] **Step 5: Implement the `Settings` field and static mount**

Apply the `webapp/config.py` and `webapp/app.py` changes from Step 1.

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/test_handoff_browser_smoke.py -v`
Expected: PASS (both tests)

- [ ] **Step 7: Commit**

```bash
git add webapp/config.py webapp/app.py tests/webapp/fixtures/handoff/generic_fixture.html tests/webapp/test_handoff_browser_smoke.py
git commit -m "test: add handoff fixture serving and end-to-end session lifecycle test"
```

---

## Task 20: Full Playwright-driven acceptance matrix

**Files:**
- Modify: `tests/webapp/test_handoff_browser_smoke.py`
- Create: `tests/webapp/fixtures/handoff/greenhouse_fixture.html` (copy of
  `extension/test/fixtures/greenhouse.html`)
- Create: `tests/webapp/fixtures/handoff/lever_fixture.html` (copy of
  `extension/test/fixtures/lever.html`)

This task requires a minimal built/bundled content script injectable via
Playwright's `page.add_script_tag` or `page.evaluate`, exercising the
real `genericAdapter`/`greenhouseAdapter`/`leverAdapter` TypeScript logic
compiled to plain JS (a build step, e.g. `esbuild --bundle`, is required —
add it as an npm script `"build:test-bundle"` in `extension/package.json`
producing `extension/dist/adapters-bundle.js` for test injection only;
this bundle is never shipped as part of the real extension package).

- [ ] **Step 1: Add the test-only bundle build script**

In `extension/package.json`, add:

```json
{
  "scripts": {
    "build:test-bundle": "esbuild src/adapters/index.ts --bundle --format=iife --global-name=HandoffAdapters --outfile=dist/adapters-bundle.js"
  }
}
```

Create `extension/src/adapters/index.ts` exporting everything the browser
test needs:

```typescript
// extension/src/adapters/index.ts
export { genericAdapter } from "./generic";
export { greenhouseAdapter } from "./greenhouse";
export { leverAdapter } from "./lever";
```

- [ ] **Step 2: Write the failing tests**

```python
# append to tests/webapp/test_handoff_browser_smoke.py
import subprocess

import pytest


@pytest.fixture(scope="module", autouse=True)
def _build_adapter_bundle():
    subprocess.run(
        ["npm", "run", "build:test-bundle"], cwd="extension", check=True,
    )


def test_greenhouse_fixture_autofills_only_safe_catalog_via_real_adapter(page, live_server):
    page.goto(f"{live_server.base_url}/test-fixtures/handoff/greenhouse_fixture.html")
    page.add_script_tag(path="extension/dist/adapters-bundle.js")

    result = page.evaluate(
        """() => {
            const fields = HandoffAdapters.greenhouseAdapter.scan(document);
            return fields.map(f => ({
                label: f.labelText,
                behavior: HandoffAdapters.greenhouseAdapter.classify(f).behavior,
            }));
        }"""
    )
    by_label = {row["label"]: row["behavior"] for row in result}
    assert by_label["First Name"] == "autofill"
    assert by_label["Email"] == "autofill"
    assert by_label["Most Recent Employer"] == "autofill"
    assert by_label["Years of Experience"] == "suggest"
    assert "Disability" in [k for k in by_label if "Disability" in k][0]
    disability_label = next(k for k in by_label if "Disability" in k)
    assert by_label[disability_label] == "ask"


def test_legal_declaration_checkbox_never_classified_as_actionable(page, live_server):
    page.goto(f"{live_server.base_url}/test-fixtures/handoff/generic_fixture.html")
    page.add_script_tag(path="extension/dist/adapters-bundle.js")

    result = page.evaluate(
        """() => {
            const fields = HandoffAdapters.genericAdapter.scan(document);
            const cert = fields.find(f => f.labelText.includes('certify'));
            return HandoffAdapters.genericAdapter.classify(cert).behavior;
        }"""
    )
    assert result == "never"

    # the checkbox's actual DOM state must be unaffected by classification alone
    checked = page.locator("#f_cert").is_checked()
    assert checked is False


def test_real_submit_button_never_clicked_by_classification_pass(page, live_server):
    page.goto(f"{live_server.base_url}/test-fixtures/handoff/generic_fixture.html")
    page.add_script_tag(path="extension/dist/adapters-bundle.js")
    page.evaluate(
        "() => { window.__submitClicks = 0; "
        "document.getElementById('submit-btn')"
        ".addEventListener('click', () => { window.__submitClicks += 1; }); }"
    )

    page.evaluate(
        """() => {
            const fields = HandoffAdapters.genericAdapter.scan(document);
            fields.forEach(f => HandoffAdapters.genericAdapter.classify(f));
        }"""
    )
    clicks = page.evaluate("() => window.__submitClicks")
    assert clicks == 0


def test_no_sensitive_value_or_secret_leakage_in_fixture_page(page, live_server):
    page.goto(f"{live_server.base_url}/test-fixtures/handoff/generic_fixture.html")
    content = page.content()
    assert "OPENAI_API_KEY" not in content
    assert live_server.secret not in content
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/webapp/test_handoff_browser_smoke.py -v -k "greenhouse or legal_declaration or submit_button or leakage"`
Expected: FAIL — `extension/dist/adapters-bundle.js` does not exist / `esbuild` not installed.

- [ ] **Step 4: Install esbuild and copy the remaining fixtures**

```bash
cd extension && npm install --save-dev esbuild
cp test/fixtures/greenhouse.html ../tests/webapp/fixtures/handoff/greenhouse_fixture.html
cp test/fixtures/lever.html ../tests/webapp/fixtures/handoff/lever_fixture.html
cd ..
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/webapp/test_handoff_browser_smoke.py -v`
Expected: PASS (all tests, including Task 19's)

- [ ] **Step 6: Commit**

```bash
git add extension/package.json extension/src/adapters/index.ts \
  tests/webapp/fixtures/handoff/greenhouse_fixture.html \
  tests/webapp/fixtures/handoff/lever_fixture.html \
  tests/webapp/test_handoff_browser_smoke.py
git commit -m "test: add real-adapter Chrome acceptance tests for handoff classification"
```

---

## Task 21: Final boundary, migration, and full-suite verification

**Files changed:** none unless a failing check exposes an in-scope defect.

- [ ] **Step 1: Confirm zero changes to protected files (repeat of Task 10, now covering Phases 2-3)**

```bash
git diff 9f99898...HEAD --name-only -- \
  product/application_pack_contract.py \
  product/application_pack_renderer.py \
  webapp/services/application_pack.py \
  webapp/api/review.py \
  webapp/persistence/workflow.py \
  webapp/persistence/schema.sql \
  webapp/services/ownership.py \
  webapp/persistence/accounts.py \
  webapp/persistence/artifacts.py
```

Expected: empty.

- [ ] **Step 2: Confirm no `workflow_events` column was added**

```bash
git diff 9f99898...HEAD -- webapp/persistence/schema.sql webapp/persistence/migrations.py | grep -i "workflow_events"
```

Expected: no output showing an `ALTER TABLE workflow_events` or any new
column on it. (The migration diff will show `handoff_sessions` referencing
`workflow_events(id)` as a foreign key from `submission_confirmations` —
that is expected and is a reference, not a schema change to
`workflow_events` itself.)

- [ ] **Step 3: Run the Python full suite**

```bash
python -m playwright install chromium
python -m pytest tests/ -v
```

Expected: 100% passing, only the accepted pre-existing skip(s).

- [ ] **Step 4: Run the extension test suite**

```bash
cd extension && npx vitest run && cd ..
```

Expected: 100% passing.

- [ ] **Step 5: `git diff --check` and status**

```bash
git diff --check
git status --short
git diff 9f99898...HEAD --stat
```

Expected: no whitespace errors; only the pre-existing untouched
candidate-profile file (if present); a stat summary matching the file
structure section above.

- [ ] **Step 6: Report**

Report: full commit list with hashes; files changed; focused
persistence/service/route/adapter/queue test results; full Python suite
result; full Vitest result; Chromium acceptance results; `git diff
--check`; confirmation that `master` and the candidate-profile edit
remain untouched; every deviation from this plan and why. Stop after this
task. Do not merge or push.

---

## Expected commit sequence

1. `feat: add handoff sessions migration 004`
2. `feat: add extension credential persistence`
3. `feat: add handoff session persistence`
4. `feat: add idempotent handoff event and confirmation persistence`
5. `feat: add extension pairing exchange service`
6. `feat: add owner-scoped handoff session minting`
7. `feat: add policy-guarded handoff event ingestion`
8. `feat: add explicit handoff submission confirmation`
9. `feat: add handoff HTTP router with pairing and session lifecycle`
10. (Task 10: report only, no commit)
11. `feat: add adapter interface types and shared safe catalog`
12. `feat: add legal/declaration field pattern matching`
13. `feat: add generic fallback adapter`
14. `feat: add greenhouse adapter with unambiguous employment rule`
15. `feat: add lever adapter and years-of-experience derivation`
16. `feat: add durable idempotent background event queue`
17. `feat: add extension manifest and chrome-backed storage/server clients`
18. `feat: add exact-pack document attachment with honest outcome recording`
19. `test: add handoff fixture serving and end-to-end session lifecycle test`
20. `test: add real-adapter Chrome acceptance tests for handoff classification`
21. (Task 21: report only, no commit)

Each commit leaves the repository in a working, testable state. No
squash, merge, push, or unrelated cleanup is part of this plan.
