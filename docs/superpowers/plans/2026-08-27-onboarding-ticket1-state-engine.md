# Onboarding Ticket 1: State Model and Walkthrough Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persisted, per-account, per-walkthrough onboarding state
model and a pure state-transition engine (begin/advance/back/interrupt/
resume/complete/skip/replay), plus a minimal HTTP surface so a future
frontend (Ticket 2) can drive it. No overlay UI and no feature-specific
walkthrough content in this ticket — that is Ticket 2 and Tickets 3-6.

**Architecture:** Walkthrough *definitions* (id, version, title, ordered
steps, targets, placement, trigger conditions) are static Python data,
registered in a small in-process registry — never hard-coded modal
components. Walkthrough *progress* (per account_id + walkthrough_id) is
persisted in a new SQLite table via a `webapp/persistence/onboarding.py`
module following this repo's existing persistence conventions. A pure
`product/onboarding.py` module implements the state machine over that
persisted row (no I/O), so its transition logic is unit-testable without a
database. A thin `webapp/services/onboarding.py` wires persistence +
engine + registry together, and `webapp/api/onboarding.py` exposes it over
HTTP scoped by the existing `AccountScope` dependency.

**Tech Stack:** Python 3, FastAPI, sqlite3 (raw SQL, no ORM), pytest.

**Spec:** The Ticket 1 section of the contextual-onboarding stream brief
(conversation-supplied; no separate design doc file — this plan is the
first artifact). Full product invariants (per-user/per-walkthrough state,
first-use behavior, user control, interruption/resume, real-UI-only, fail
safely, no data mutation from explanation alone, accessibility) apply to
the whole stream; Ticket 1 is responsible for the state model and engine
invariants specifically.

## Global Constraints

- Frozen baseline commit: `12224eeb6d401209ed0da6fe1360fc90a722bc98`. Branch
  `feature/contextual-onboarding` in worktree
  `C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`.
  Never touch `master` or any other worktree.
- One completed walkthrough must never mark an unrelated walkthrough
  complete — all state is keyed by `(account_id, walkthrough_id)`.
- Once a walkthrough is completed, it must not auto-trigger again, but must
  always be explicitly replayable. Replay must not destroy prior completion
  history unless the model deliberately tracks replay separately (this plan
  tracks it via `completed_at` + `times_completed`, see Task 1).
- Interrupting a walkthrough (nav away, reload, close) must never silently
  mark it complete. Only an explicit `complete` transition sets `completed`.
- The engine must support: begin, advance, back, interrupt, resume,
  complete, replay/reset — all as explicit, named operations with tests.
- No feature-specific walkthrough content belongs in this ticket. Only the
  representation, the engine, persistence, and the registry mechanism.
- Follow existing repo conventions exactly: `_now()` ISO-8601 UTC helper,
  `id = f"{prefix}_{uuid.uuid4().hex[:20]}"`, `commit: bool = True` kwarg on
  every write function, `dict(row) if row else None` read shape, account
  scoping via `account_id`, migrations appended to the `apply_migrations`
  tuple in `webapp/persistence/migrations.py`, tests under
  `tests/webapp/persistence/`, `tests/webapp/api/`, and `tests/product/`.
- Before the first write in this worktree, and again before every commit,
  verify: `git rev-parse --show-toplevel`, `git branch --show-current`,
  `git rev-parse HEAD`, `git status --short`. Expected: this worktree path,
  branch `feature/contextual-onboarding`, and (until the first commit) HEAD
  `12224eeb6d401209ed0da6fe1360fc90a722bc98` with clean status. Stop on any
  drift.
- Do not push. Do not merge.

---

## File Structure

- **Create:** `product/onboarding.py` — pure walkthrough definition
  dataclasses, the walkthrough registry, and the pure state-transition
  engine (no DB, no FastAPI imports).
- **Create:** `webapp/persistence/onboarding.py` — SQLite CRUD for
  per-account walkthrough progress rows. Same shape as
  `webapp/persistence/handoff.py`.
- **Modify:** `webapp/persistence/migrations.py` — add migration
  `006_onboarding_walkthroughs` creating the `onboarding_progress` table.
- **Create:** `webapp/services/onboarding.py` — wires the registry +
  persistence + pure engine together behind account-scoped functions
  (`get_walkthrough_status`, `begin_walkthrough`, `advance_walkthrough`,
  `go_back_walkthrough`, `interrupt_walkthrough`, `resume_walkthrough`,
  `complete_walkthrough`, `skip_walkthrough`, `replay_walkthrough`,
  `list_walkthrough_statuses`).
- **Create:** `webapp/api/onboarding.py` — FastAPI router exposing the
  service functions as JSON endpoints under `/api/onboarding`.
- **Modify:** `webapp/app.py` — register the new router.
- **Test:** `tests/product/test_onboarding_engine.py` — pure engine unit
  tests (no DB).
- **Test:** `tests/webapp/persistence/test_onboarding_migration.py` —
  migration creates table, is idempotent, upgrades cleanly from 005.
- **Test:** `tests/webapp/persistence/test_onboarding.py` — persistence
  CRUD tests.
- **Test:** `tests/webapp/services/test_onboarding_service.py` — service
  wiring tests (begin/advance/interrupt/resume/complete/skip/replay
  end-to-end against a real sqlite connection).
- **Test:** `tests/webapp/api/test_onboarding_routes.py` — HTTP contract
  tests via `TestClient`.

---

## Domain Model

### Walkthrough definition (static data — `product/onboarding.py`)

```python
@dataclass(frozen=True)
class WalkthroughStep:
    step_id: str
    target: str  # CSS selector or stable data-onboarding-target identifier
    title: str
    body: str
    placement: str = "auto"  # "auto" | "top" | "bottom" | "left" | "right"

@dataclass(frozen=True)
class WalkthroughDefinition:
    walkthrough_id: str
    version: int
    title: str
    steps: tuple[WalkthroughStep, ...]
    trigger: str | None = None  # opaque trigger-condition key, e.g. "first_visit:profile"
```

### Progress state (persisted — one row per `(account_id, walkthrough_id)`)

Status values: `not_started`, `in_progress`, `completed`, `skipped`.
(`skipped` covers both "Skip" mid-tour and "Don't show this automatically
again" — both mean "do not auto-trigger again"; they are distinguished by
a separate `dismissal_reason` column so the policy can differentiate later
without a schema change.)

Columns (see Task 1 for full DDL):
`account_id, walkthrough_id, walkthrough_version, status, current_step_index,
dismissal_reason, started_at, last_interacted_at, completed_at,
times_completed, times_started, updated_at`.

`times_started` / `times_completed` exist specifically so "replay" can be
distinguished from "first completion" without destroying history, per the
Ticket 7 requirement ("replaying must not destroy ordinary completion
history unless the model deliberately tracks replay separately").

### Pure engine transitions (`product/onboarding.py`)

All transition functions take the current progress dict (a plain
`dict[str, Any]` shaped like the persisted row, so the pure engine has zero
DB coupling) plus a definition, and return a **new** dict — never mutate in
place. This makes the engine trivially unit-testable and keeps the
persistence layer as a dumb save/load shell around it.

- `begin(progress, definition, now) -> dict`
- `advance(progress, definition, now) -> dict`
- `go_back(progress, definition, now) -> dict`
- `interrupt(progress, now) -> dict` (no-op on state machine status; just
  stamps `last_interacted_at` — interruption must never change `status`)
- `resume(progress, definition, now) -> dict`
- `complete(progress, definition, now) -> dict`
- `skip(progress, definition, now, *, reason) -> dict`
- `replay(progress, definition, now) -> dict` (resets to `in_progress`,
  step 0, increments `times_started`, preserves `times_completed`)

Illegal transitions (e.g. `advance` past the last step without `complete`,
or any transition on an unknown walkthrough_id) raise
`OnboardingTransitionError` (defined in the same module).

---

### Task 1: Persistence layer — migration and CRUD

**Files:**
- Modify: `webapp/persistence/migrations.py`
- Create: `webapp/persistence/onboarding.py`
- Test: `tests/webapp/persistence/test_onboarding_migration.py`
- Test: `tests/webapp/persistence/test_onboarding.py`

**Interfaces:**
- Consumes: `webapp.persistence.accounts.DEFAULT_ACCOUNT_ID`,
  `webapp.persistence.db.connect`/`init_db` (existing).
- Produces (for Task 2's pure engine adapter and Task 3's service to use):
  - `get_progress(conn, *, account_id: str, walkthrough_id: str) -> dict | None`
  - `upsert_progress(conn, *, account_id: str, walkthrough_id: str, walkthrough_version: int, status: str, current_step_index: int, dismissal_reason: str | None, started_at: str | None, last_interacted_at: str, completed_at: str | None, times_completed: int, times_started: int, commit: bool = True) -> dict`
  - `list_progress_for_account(conn, *, account_id: str) -> list[dict]`

- [ ] **Step 1: Write the failing migration test**

```python
# tests/webapp/persistence/test_onboarding_migration.py
from __future__ import annotations

from webapp.persistence.db import connect, init_db
from webapp.persistence.migrations import (
    ONBOARDING_WALKTHROUGHS_MIGRATION_ID,
    apply_migrations,
)


def test_migration_006_creates_onboarding_progress_table(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    applied = conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?",
        (ONBOARDING_WALKTHROUGHS_MIGRATION_ID,),
    ).fetchone()
    assert applied is not None

    tables = {
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    assert "onboarding_progress" in tables
    conn.close()


def test_migration_006_is_idempotent(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    apply_migrations(conn)  # second call must not raise or duplicate
    count = conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE id = ?",
        (ONBOARDING_WALKTHROUGHS_MIGRATION_ID,),
    ).fetchone()[0]
    assert count == 1
    conn.close()


def test_onboarding_progress_status_check_constraint(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    import sqlite3
    import pytest

    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO onboarding_progress "
            "(account_id, walkthrough_id, walkthrough_version, status, "
            "current_step_index, dismissal_reason, started_at, "
            "last_interacted_at, completed_at, times_completed, "
            "times_started, updated_at) "
            "VALUES ('account_local', 'dashboard_intro', 1, 'not_a_status', "
            "0, NULL, NULL, 'now', NULL, 0, 0, 'now')"
        )
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/persistence/test_onboarding_migration.py -v`
Expected: FAIL — `ImportError: cannot import name 'ONBOARDING_WALKTHROUGHS_MIGRATION_ID'`

- [ ] **Step 3: Add the migration**

In `webapp/persistence/migrations.py`, add the new migration id near the
other constants:

```python
ONBOARDING_WALKTHROUGHS_MIGRATION_ID = "006_onboarding_walkthroughs"
```

Register it in the `migrations` tuple inside `apply_migrations` (append
after `HANDOFF_SESSIONS_MIGRATION_ID`'s entry, `disable_foreign_keys=False`):

```python
(ONBOARDING_WALKTHROUGHS_MIGRATION_ID, _migrate_onboarding_walkthroughs, False),
```

Add the migration function (place near `_migrate_handoff_sessions`):

```python
def _migrate_onboarding_walkthroughs(conn: sqlite3.Connection) -> None:
    _execute_statements(
        conn,
        """
        CREATE TABLE onboarding_progress (
            account_id TEXT NOT NULL REFERENCES accounts(id),
            walkthrough_id TEXT NOT NULL,
            walkthrough_version INTEGER NOT NULL CHECK (walkthrough_version >= 1),
            status TEXT NOT NULL CHECK (
                status IN ('not_started', 'in_progress', 'completed', 'skipped')
            ),
            current_step_index INTEGER NOT NULL CHECK (current_step_index >= 0),
            dismissal_reason TEXT CHECK (
                dismissal_reason IS NULL
                OR dismissal_reason IN ('skip', 'dont_show_again', 'close')
            ),
            started_at TEXT,
            last_interacted_at TEXT NOT NULL,
            completed_at TEXT,
            times_completed INTEGER NOT NULL DEFAULT 0 CHECK (times_completed >= 0),
            times_started INTEGER NOT NULL DEFAULT 0 CHECK (times_started >= 0),
            updated_at TEXT NOT NULL,
            PRIMARY KEY (account_id, walkthrough_id)
        );

        CREATE INDEX idx_onboarding_progress_account_status
            ON onboarding_progress(account_id, status);
        """,
    )
```

Note: this table is intentionally **not** versioned per-row-per-version —
`walkthrough_version` records which version the stored progress applies
to. If a walkthrough definition's version increases, the service layer
(Task 3) decides whether stale-version progress should be treated as
`not_started` again; the persistence layer just stores whatever version it
is given. This keeps persistence dumb and keeps the version-staleness
policy in one place (the service), matching this repo's convention of
putting policy in `webapp/services/*` and mechanism in
`webapp/persistence/*`.

- [ ] **Step 4: Run migration tests to verify they pass**

Run: `pytest tests/webapp/persistence/test_onboarding_migration.py -v`
Expected: PASS (all three tests)

- [ ] **Step 5: Write the failing persistence CRUD test**

```python
# tests/webapp/persistence/test_onboarding.py
from __future__ import annotations

from webapp.persistence.db import connect, init_db
from webapp.persistence.onboarding import (
    get_progress,
    list_progress_for_account,
    upsert_progress,
)


def _db(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    return connect(db_path)


def test_get_progress_returns_none_when_absent(tmp_path):
    conn = _db(tmp_path)
    assert get_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro"
    ) is None
    conn.close()


def test_upsert_progress_creates_then_updates_same_row(tmp_path):
    conn = _db(tmp_path)
    created = upsert_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="in_progress", current_step_index=0,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:00:00+00:00", completed_at=None,
        times_completed=0, times_started=1,
    )
    assert created["status"] == "in_progress"
    assert created["current_step_index"] == 0

    updated = upsert_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="in_progress", current_step_index=1,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:01:00+00:00", completed_at=None,
        times_completed=0, times_started=1,
    )
    assert updated["current_step_index"] == 1

    fetched = get_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro"
    )
    assert fetched["current_step_index"] == 1

    rows = conn.execute(
        "SELECT COUNT(*) FROM onboarding_progress "
        "WHERE account_id = 'account_local' AND walkthrough_id = 'dashboard_intro'"
    ).fetchone()[0]
    assert rows == 1
    conn.close()


def test_progress_is_isolated_per_walkthrough_id(tmp_path):
    conn = _db(tmp_path)
    upsert_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="completed", current_step_index=2,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:02:00+00:00",
        completed_at="2026-08-27T00:02:00+00:00", times_completed=1,
        times_started=1,
    )
    other = get_progress(
        conn, account_id="account_local", walkthrough_id="profile_intro"
    )
    assert other is None
    conn.close()


def test_list_progress_for_account_returns_only_that_account(tmp_path):
    conn = _db(tmp_path)
    from webapp.persistence.accounts import create_account

    create_account(conn, display_name="Second user", account_id="account_second")
    upsert_progress(
        conn, account_id="account_local", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="completed", current_step_index=2,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:02:00+00:00",
        completed_at="2026-08-27T00:02:00+00:00", times_completed=1,
        times_started=1,
    )
    upsert_progress(
        conn, account_id="account_second", walkthrough_id="dashboard_intro",
        walkthrough_version=1, status="in_progress", current_step_index=0,
        dismissal_reason=None, started_at="2026-08-27T00:00:00+00:00",
        last_interacted_at="2026-08-27T00:00:00+00:00", completed_at=None,
        times_completed=0, times_started=1,
    )

    local_rows = list_progress_for_account(conn, account_id="account_local")
    assert len(local_rows) == 1
    assert local_rows[0]["status"] == "completed"
    conn.close()
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pytest tests/webapp/persistence/test_onboarding.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webapp.persistence.onboarding'`

- [ ] **Step 7: Implement the persistence module**

```python
# webapp/persistence/onboarding.py
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_progress(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM onboarding_progress "
        "WHERE account_id = ? AND walkthrough_id = ?",
        (account_id, walkthrough_id),
    ).fetchone()
    return dict(row) if row else None


def upsert_progress(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    walkthrough_id: str,
    walkthrough_version: int,
    status: str,
    current_step_index: int,
    dismissal_reason: str | None,
    started_at: str | None,
    last_interacted_at: str,
    completed_at: str | None,
    times_completed: int,
    times_started: int,
    commit: bool = True,
) -> dict[str, Any]:
    now = _now()
    conn.execute(
        "INSERT INTO onboarding_progress "
        "(account_id, walkthrough_id, walkthrough_version, status, "
        "current_step_index, dismissal_reason, started_at, "
        "last_interacted_at, completed_at, times_completed, times_started, "
        "updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (account_id, walkthrough_id) DO UPDATE SET "
        "walkthrough_version = excluded.walkthrough_version, "
        "status = excluded.status, "
        "current_step_index = excluded.current_step_index, "
        "dismissal_reason = excluded.dismissal_reason, "
        "started_at = COALESCE(excluded.started_at, onboarding_progress.started_at), "
        "last_interacted_at = excluded.last_interacted_at, "
        "completed_at = excluded.completed_at, "
        "times_completed = excluded.times_completed, "
        "times_started = excluded.times_started, "
        "updated_at = excluded.updated_at",
        (
            account_id, walkthrough_id, walkthrough_version, status,
            current_step_index, dismissal_reason, started_at,
            last_interacted_at, completed_at, times_completed, times_started,
            now,
        ),
    )
    if commit:
        conn.commit()
    return get_progress(conn, account_id=account_id, walkthrough_id=walkthrough_id)


def list_progress_for_account(
    conn: sqlite3.Connection, *, account_id: str
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM onboarding_progress WHERE account_id = ? "
        "ORDER BY walkthrough_id",
        (account_id,),
    ).fetchall()
    return [dict(row) for row in rows]
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pytest tests/webapp/persistence/test_onboarding_migration.py tests/webapp/persistence/test_onboarding.py -v`
Expected: PASS (all tests)

- [ ] **Step 9: Run full persistence regression suite**

Run: `pytest tests/webapp/persistence -v`
Expected: PASS (no regressions in accounts/handoff/etc. migrations)

- [ ] **Step 10: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: worktree path
`C:/Users/smbab/OneDrive/Documents/Projects/ai-job-search-contextual-onboarding`,
branch `feature/contextual-onboarding`, HEAD still the frozen baseline (no
commits yet on this branch), status shows only the new/modified files
above, `git diff --check` empty. Stop on drift.

- [ ] **Step 11: Commit**

```bash
git add webapp/persistence/migrations.py webapp/persistence/onboarding.py \
  tests/webapp/persistence/test_onboarding_migration.py \
  tests/webapp/persistence/test_onboarding.py
git commit -m "feat(onboarding): add per-account walkthrough progress persistence"
```

---

### Task 2: Pure walkthrough definitions and state-transition engine

**Files:**
- Create: `product/onboarding.py`
- Test: `tests/product/test_onboarding_engine.py`

**Interfaces:**
- Consumes: nothing from Task 1 (deliberately DB-free).
- Produces (for Task 3's service layer):
  - `WalkthroughStep`, `WalkthroughDefinition` dataclasses (fields as in
    Domain Model above).
  - `OnboardingTransitionError(Exception)`
  - `initial_progress(definition: WalkthroughDefinition, now: str) -> dict[str, Any]`
    — the `not_started` shape for a walkthrough never begun, matching the
    same dict shape as a persisted row (minus `account_id`/`walkthrough_id`,
    which the service layer adds).
  - `begin(progress: dict, definition: WalkthroughDefinition, now: str) -> dict`
  - `advance(progress: dict, definition: WalkthroughDefinition, now: str) -> dict`
  - `go_back(progress: dict, definition: WalkthroughDefinition, now: str) -> dict`
  - `interrupt(progress: dict, now: str) -> dict`
  - `resume(progress: dict, definition: WalkthroughDefinition, now: str) -> dict`
  - `complete(progress: dict, definition: WalkthroughDefinition, now: str) -> dict`
  - `skip(progress: dict, definition: WalkthroughDefinition, now: str, *, reason: str) -> dict`
  - `replay(progress: dict, definition: WalkthroughDefinition, now: str) -> dict`
  - `WALKTHROUGH_REGISTRY: dict[str, WalkthroughDefinition]` and
    `register_walkthrough(definition: WalkthroughDefinition) -> None` /
    `get_walkthrough(walkthrough_id: str) -> WalkthroughDefinition` (raises
    `KeyError` if unknown) — the mechanism Tickets 3-6 will use to add
    feature-specific walkthroughs as data, not code.

- [ ] **Step 1: Write the failing engine tests**

```python
# tests/product/test_onboarding_engine.py
from __future__ import annotations

import pytest

from product.onboarding import (
    OnboardingTransitionError,
    WalkthroughDefinition,
    WalkthroughStep,
    advance,
    begin,
    complete,
    get_walkthrough,
    go_back,
    initial_progress,
    interrupt,
    register_walkthrough,
    replay,
    resume,
    skip,
)


NOW = "2026-08-27T00:00:00+00:00"
LATER = "2026-08-27T00:05:00+00:00"


def _definition(steps=3, walkthrough_id="test_walkthrough", version=1):
    return WalkthroughDefinition(
        walkthrough_id=walkthrough_id,
        version=version,
        title="Test walkthrough",
        steps=tuple(
            WalkthroughStep(
                step_id=f"step_{i}", target=f"[data-onboarding-target=step-{i}]",
                title=f"Step {i}", body=f"Body {i}",
            )
            for i in range(steps)
        ),
    )


def test_initial_progress_is_not_started_at_step_zero():
    definition = _definition()
    progress = initial_progress(definition, NOW)
    assert progress["status"] == "not_started"
    assert progress["current_step_index"] == 0
    assert progress["times_started"] == 0
    assert progress["times_completed"] == 0


def test_begin_moves_to_in_progress_and_stamps_started_at():
    definition = _definition()
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    assert progress["status"] == "in_progress"
    assert progress["current_step_index"] == 0
    assert progress["started_at"] == NOW
    assert progress["times_started"] == 1


def test_advance_moves_to_next_step():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    assert progress["status"] == "in_progress"
    assert progress["current_step_index"] == 1
    assert progress["last_interacted_at"] == LATER


def test_advance_past_last_step_raises():
    definition = _definition(steps=1)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        advance(progress, definition, LATER)


def test_advance_on_final_step_index_still_requires_explicit_complete():
    # A 1-step walkthrough starts already "on" its only step (index 0).
    # advance() must never silently complete the walkthrough — the caller
    # (frontend "Finish" button) must call complete() explicitly.
    definition = _definition(steps=1)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    assert progress["current_step_index"] == 0
    assert progress["status"] == "in_progress"


def test_go_back_moves_to_previous_step():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    progress = go_back(progress, definition, LATER)
    assert progress["current_step_index"] == 0


def test_go_back_at_step_zero_raises():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        go_back(progress, definition, LATER)


def test_interrupt_never_changes_status_or_step():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    interrupted = interrupt(progress, LATER)
    assert interrupted["status"] == "in_progress"
    assert interrupted["current_step_index"] == 1
    assert interrupted["last_interacted_at"] == LATER


def test_resume_from_in_progress_is_a_no_op_on_step():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    resumed = resume(progress, definition, LATER)
    assert resumed["status"] == "in_progress"
    assert resumed["current_step_index"] == 1


def test_resume_on_not_started_raises():
    definition = _definition()
    progress = initial_progress(definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        resume(progress, definition, LATER)


def test_complete_sets_completed_status_and_increments_counter():
    definition = _definition(steps=2)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    completed = complete(progress, definition, LATER)
    assert completed["status"] == "completed"
    assert completed["completed_at"] == LATER
    assert completed["times_completed"] == 1


def test_complete_before_reaching_final_step_raises():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        complete(progress, definition, LATER)


def test_skip_sets_skipped_status_with_reason_and_never_marks_completed():
    definition = _definition(steps=3)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    skipped = skip(progress, definition, LATER, reason="skip")
    assert skipped["status"] == "skipped"
    assert skipped["dismissal_reason"] == "skip"
    assert skipped["times_completed"] == 0


def test_skip_with_dont_show_again_reason():
    definition = _definition()
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    skipped = skip(progress, definition, LATER, reason="dont_show_again")
    assert skipped["dismissal_reason"] == "dont_show_again"


def test_skip_rejects_unknown_reason():
    definition = _definition()
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    with pytest.raises(OnboardingTransitionError):
        skip(progress, definition, LATER, reason="not_a_real_reason")


def test_replay_after_completion_resets_step_but_preserves_completion_count():
    definition = _definition(steps=2)
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    progress = advance(progress, definition, LATER)
    progress = complete(progress, definition, LATER)
    replayed = replay(progress, definition, LATER)
    assert replayed["status"] == "in_progress"
    assert replayed["current_step_index"] == 0
    assert replayed["times_completed"] == 1  # history preserved
    assert replayed["times_started"] == 2  # replay counts as a new start


def test_replay_after_skip_also_works():
    definition = _definition()
    progress = begin(initial_progress(definition, NOW), definition, NOW)
    skipped = skip(progress, definition, LATER, reason="skip")
    replayed = replay(skipped, definition, LATER)
    assert replayed["status"] == "in_progress"
    assert replayed["current_step_index"] == 0


def test_registry_round_trip():
    definition = _definition(walkthrough_id="registry_test_walkthrough")
    register_walkthrough(definition)
    assert get_walkthrough("registry_test_walkthrough") is definition


def test_get_unknown_walkthrough_raises_key_error():
    with pytest.raises(KeyError):
        get_walkthrough("does_not_exist_walkthrough_id")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/product/test_onboarding_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'product.onboarding'`

- [ ] **Step 3: Implement the pure engine module**

```python
# product/onboarding.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class OnboardingTransitionError(Exception):
    """Raised when a walkthrough state transition is not legal from the
    current state. The caller (service layer / API) is responsible for
    translating this into a 4xx response — the engine itself has no
    knowledge of HTTP."""


_VALID_DISMISSAL_REASONS = frozenset({"skip", "dont_show_again", "close"})


@dataclass(frozen=True)
class WalkthroughStep:
    step_id: str
    target: str
    title: str
    body: str
    placement: str = "auto"


@dataclass(frozen=True)
class WalkthroughDefinition:
    walkthrough_id: str
    version: int
    title: str
    steps: tuple[WalkthroughStep, ...]
    trigger: str | None = None

    def __post_init__(self) -> None:
        if not self.steps:
            raise ValueError("a walkthrough must have at least one step")


def initial_progress(definition: WalkthroughDefinition, now: str) -> dict[str, Any]:
    return {
        "walkthrough_version": definition.version,
        "status": "not_started",
        "current_step_index": 0,
        "dismissal_reason": None,
        "started_at": None,
        "last_interacted_at": now,
        "completed_at": None,
        "times_completed": 0,
        "times_started": 0,
    }


def begin(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    if progress["status"] == "in_progress":
        raise OnboardingTransitionError("walkthrough is already in progress")
    return {
        **progress,
        "walkthrough_version": definition.version,
        "status": "in_progress",
        "current_step_index": 0,
        "dismissal_reason": None,
        "started_at": now,
        "last_interacted_at": now,
        "times_started": progress["times_started"] + 1,
    }


def advance(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    _require_in_progress(progress)
    next_index = progress["current_step_index"] + 1
    if next_index >= len(definition.steps):
        raise OnboardingTransitionError(
            "no further step to advance to; call complete() on the final step"
        )
    return {
        **progress,
        "current_step_index": next_index,
        "last_interacted_at": now,
    }


def go_back(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    _require_in_progress(progress)
    if progress["current_step_index"] == 0:
        raise OnboardingTransitionError("already at the first step")
    return {
        **progress,
        "current_step_index": progress["current_step_index"] - 1,
        "last_interacted_at": now,
    }


def interrupt(progress: dict[str, Any], now: str) -> dict[str, Any]:
    # Deliberately a near no-op: interruption (nav away, reload, close)
    # must never change status or step. It only records that contact
    # happened, so "resume" has a timestamp to reason about.
    return {**progress, "last_interacted_at": now}


def resume(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    if progress["status"] != "in_progress":
        raise OnboardingTransitionError(
            "only an in_progress walkthrough can be resumed"
        )
    return {**progress, "last_interacted_at": now}


def complete(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    _require_in_progress(progress)
    if progress["current_step_index"] != len(definition.steps) - 1:
        raise OnboardingTransitionError(
            "cannot complete before reaching the final step"
        )
    return {
        **progress,
        "status": "completed",
        "dismissal_reason": None,
        "last_interacted_at": now,
        "completed_at": now,
        "times_completed": progress["times_completed"] + 1,
    }


def skip(
    progress: dict[str, Any],
    definition: WalkthroughDefinition,
    now: str,
    *,
    reason: str,
) -> dict[str, Any]:
    _require_in_progress(progress)
    if reason not in _VALID_DISMISSAL_REASONS:
        raise OnboardingTransitionError(f"unknown dismissal reason: {reason!r}")
    return {
        **progress,
        "status": "skipped",
        "dismissal_reason": reason,
        "last_interacted_at": now,
    }


def replay(
    progress: dict[str, Any], definition: WalkthroughDefinition, now: str
) -> dict[str, Any]:
    if progress["status"] not in ("completed", "skipped"):
        raise OnboardingTransitionError(
            "only a completed or skipped walkthrough can be replayed"
        )
    return {
        **progress,
        "walkthrough_version": definition.version,
        "status": "in_progress",
        "current_step_index": 0,
        "dismissal_reason": None,
        "started_at": now,
        "last_interacted_at": now,
        "times_started": progress["times_started"] + 1,
    }


def _require_in_progress(progress: dict[str, Any]) -> None:
    if progress["status"] != "in_progress":
        raise OnboardingTransitionError(
            f"walkthrough must be in_progress for this transition, "
            f"got {progress['status']!r}"
        )


WALKTHROUGH_REGISTRY: dict[str, WalkthroughDefinition] = {}


def register_walkthrough(definition: WalkthroughDefinition) -> None:
    WALKTHROUGH_REGISTRY[definition.walkthrough_id] = definition


def get_walkthrough(walkthrough_id: str) -> WalkthroughDefinition:
    return WALKTHROUGH_REGISTRY[walkthrough_id]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/product/test_onboarding_engine.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Run full product regression suite**

Run: `pytest tests/product -v`
Expected: PASS (no regressions)

- [ ] **Step 6: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: same worktree/branch, HEAD now one commit ahead of the frozen
baseline (Task 1's commit), status shows only `product/onboarding.py` and
its test as new. Stop on drift.

- [ ] **Step 7: Commit**

```bash
git add product/onboarding.py tests/product/test_onboarding_engine.py
git commit -m "feat(onboarding): add pure walkthrough state-transition engine"
```

---

### Task 3: Service layer — wire persistence + engine + registry

**Files:**
- Create: `webapp/services/onboarding.py`
- Test: `tests/webapp/services/test_onboarding_service.py`

**Interfaces:**
- Consumes:
  - From Task 1: `webapp.persistence.onboarding.{get_progress, upsert_progress, list_progress_for_account}`
  - From Task 2: `product.onboarding.{WalkthroughDefinition, WalkthroughStep, OnboardingTransitionError, initial_progress, begin, advance, go_back, interrupt, resume, complete, skip, replay, get_walkthrough, register_walkthrough, WALKTHROUGH_REGISTRY}`
- Produces (for Task 4's API layer):
  - `class WalkthroughNotFound(LookupError)`
  - `get_walkthrough_status(conn, *, account_id: str, walkthrough_id: str) -> dict[str, Any]`
    — returns a merged view: persisted progress if present, else
    `initial_progress()`, always including `walkthrough_id`,
    `walkthrough_version`, `title`, and step count so the frontend has
    everything without a second lookup.
  - `list_walkthrough_statuses(conn, *, account_id: str) -> list[dict[str, Any]]`
    — one row per **registered** walkthrough (not just ones with progress
    rows), so Help → Walkthroughs (Ticket 7) can show "Not started" for
    walkthroughs never begun.
  - `begin_walkthrough(conn, *, account_id: str, walkthrough_id: str) -> dict[str, Any]`
  - `advance_walkthrough(conn, *, account_id: str, walkthrough_id: str) -> dict[str, Any]`
  - `go_back_walkthrough(conn, *, account_id: str, walkthrough_id: str) -> dict[str, Any]`
  - `interrupt_walkthrough(conn, *, account_id: str, walkthrough_id: str) -> dict[str, Any]`
  - `resume_walkthrough(conn, *, account_id: str, walkthrough_id: str) -> dict[str, Any]`
  - `complete_walkthrough(conn, *, account_id: str, walkthrough_id: str) -> dict[str, Any]`
  - `skip_walkthrough(conn, *, account_id: str, walkthrough_id: str, reason: str) -> dict[str, Any]`
  - `replay_walkthrough(conn, *, account_id: str, walkthrough_id: str) -> dict[str, Any]`

  Every mutating function: looks up the definition via `get_walkthrough`
  (raises `WalkthroughNotFound` — translated from `KeyError` — if
  unknown), loads current progress via persistence (or synthesizes
  `initial_progress` if none exists yet), calls the matching pure-engine
  transition, persists the result via `upsert_progress`, and returns the
  merged status dict (same shape as `get_walkthrough_status`).

- [ ] **Step 1: Write the failing service tests**

```python
# tests/webapp/services/test_onboarding_service.py
from __future__ import annotations

import pytest

from product.onboarding import (
    OnboardingTransitionError,
    WalkthroughDefinition,
    WalkthroughStep,
    register_walkthrough,
)
from webapp.persistence.db import connect, init_db
from webapp.services.onboarding import (
    WalkthroughNotFound,
    advance_walkthrough,
    begin_walkthrough,
    complete_walkthrough,
    get_walkthrough_status,
    go_back_walkthrough,
    interrupt_walkthrough,
    list_walkthrough_statuses,
    replay_walkthrough,
    resume_walkthrough,
    skip_walkthrough,
)


@pytest.fixture(autouse=True)
def _register_test_walkthrough():
    register_walkthrough(
        WalkthroughDefinition(
            walkthrough_id="svc_test_walkthrough",
            version=1,
            title="Service test walkthrough",
            steps=(
                WalkthroughStep(
                    step_id="s0", target="[data-onboarding-target=a]",
                    title="A", body="A body",
                ),
                WalkthroughStep(
                    step_id="s1", target="[data-onboarding-target=b]",
                    title="B", body="B body",
                ),
            ),
        )
    )


def _conn(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    return connect(db_path)


def test_status_for_never_started_walkthrough_is_not_started(tmp_path):
    conn = _conn(tmp_path)
    status = get_walkthrough_status(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    assert status["status"] == "not_started"
    assert status["title"] == "Service test walkthrough"
    conn.close()


def test_status_for_unknown_walkthrough_raises(tmp_path):
    conn = _conn(tmp_path)
    with pytest.raises(WalkthroughNotFound):
        get_walkthrough_status(
            conn, account_id="account_local", walkthrough_id="nope"
        )
    conn.close()


def test_begin_advance_complete_round_trip_persists(tmp_path):
    conn = _conn(tmp_path)
    begin_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    advanced = advance_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    assert advanced["current_step_index"] == 1

    completed = complete_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    assert completed["status"] == "completed"

    # A fresh read reflects the persisted, not just in-memory, state.
    reread = get_walkthrough_status(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    assert reread["status"] == "completed"
    conn.close()


def test_interrupt_then_resume_preserves_step(tmp_path):
    conn = _conn(tmp_path)
    begin_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    advance_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    interrupt_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    resumed = resume_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    assert resumed["status"] == "in_progress"
    assert resumed["current_step_index"] == 1
    conn.close()


def test_interrupt_never_marks_complete(tmp_path):
    conn = _conn(tmp_path)
    begin_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    interrupted = interrupt_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    assert interrupted["status"] == "in_progress"
    conn.close()


def test_go_back_after_advance(tmp_path):
    conn = _conn(tmp_path)
    begin_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    advance_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    back = go_back_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    assert back["current_step_index"] == 0
    conn.close()


def test_skip_persists_dismissal_reason(tmp_path):
    conn = _conn(tmp_path)
    begin_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    skipped = skip_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough",
        reason="dont_show_again",
    )
    assert skipped["status"] == "skipped"
    assert skipped["dismissal_reason"] == "dont_show_again"
    conn.close()


def test_replay_after_completion_preserves_times_completed(tmp_path):
    conn = _conn(tmp_path)
    begin_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    advance_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    complete_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    replayed = replay_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    assert replayed["status"] == "in_progress"
    assert replayed["current_step_index"] == 0
    assert replayed["times_completed"] == 1
    conn.close()


def test_illegal_transition_raises_onboarding_transition_error(tmp_path):
    conn = _conn(tmp_path)
    with pytest.raises(OnboardingTransitionError):
        # cannot go back before it has begun
        go_back_walkthrough(
            conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
        )
    conn.close()


def test_progress_is_isolated_per_account(tmp_path):
    conn = _conn(tmp_path)
    from webapp.persistence.accounts import create_account

    create_account(conn, display_name="Second user", account_id="account_second")
    begin_walkthrough(
        conn, account_id="account_local", walkthrough_id="svc_test_walkthrough"
    )
    other_status = get_walkthrough_status(
        conn, account_id="account_second", walkthrough_id="svc_test_walkthrough"
    )
    assert other_status["status"] == "not_started"
    conn.close()


def test_list_walkthrough_statuses_includes_never_started_registered_walkthroughs(tmp_path):
    conn = _conn(tmp_path)
    statuses = list_walkthrough_statuses(conn, account_id="account_local")
    ids = {row["walkthrough_id"] for row in statuses}
    assert "svc_test_walkthrough" in ids
    matching = next(row for row in statuses if row["walkthrough_id"] == "svc_test_walkthrough")
    assert matching["status"] == "not_started"
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/services/test_onboarding_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webapp.services.onboarding'`

- [ ] **Step 3: Implement the service module**

```python
# webapp/services/onboarding.py
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any, Callable

from product.onboarding import (
    OnboardingTransitionError,
    WalkthroughDefinition,
    advance as _advance,
    begin as _begin,
    complete as _complete,
    get_walkthrough,
    go_back as _go_back,
    initial_progress,
    interrupt as _interrupt,
    replay as _replay,
    resume as _resume,
    skip as _skip,
    WALKTHROUGH_REGISTRY,
)
from webapp.persistence.onboarding import (
    get_progress,
    list_progress_for_account,
    upsert_progress,
)


class WalkthroughNotFound(LookupError):
    """Raised for an unknown walkthrough_id, mirroring
    webapp.services.ownership.OwnedResourceNotFound's pattern of giving
    missing-and-unknown resources a single, unambiguous exception type."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_definition(walkthrough_id: str) -> WalkthroughDefinition:
    try:
        return get_walkthrough(walkthrough_id)
    except KeyError as exc:
        raise WalkthroughNotFound(
            f"unknown walkthrough: {walkthrough_id}"
        ) from exc


def _load_progress(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str,
    definition: WalkthroughDefinition,
) -> dict[str, Any]:
    stored = get_progress(conn, account_id=account_id, walkthrough_id=walkthrough_id)
    if stored is not None:
        return stored
    return initial_progress(definition, _now())


def _as_status(
    progress: dict[str, Any], *, walkthrough_id: str, definition: WalkthroughDefinition,
) -> dict[str, Any]:
    return {
        "walkthrough_id": walkthrough_id,
        "title": definition.title,
        "step_count": len(definition.steps),
        **progress,
    }


def get_walkthrough_status(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any]:
    definition = _resolve_definition(walkthrough_id)
    progress = _load_progress(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        definition=definition,
    )
    return _as_status(progress, walkthrough_id=walkthrough_id, definition=definition)


def list_walkthrough_statuses(
    conn: sqlite3.Connection, *, account_id: str
) -> list[dict[str, Any]]:
    persisted = {
        row["walkthrough_id"]: row
        for row in list_progress_for_account(conn, account_id=account_id)
    }
    statuses = []
    for walkthrough_id, definition in WALKTHROUGH_REGISTRY.items():
        progress = persisted.get(walkthrough_id) or initial_progress(definition, _now())
        statuses.append(
            _as_status(progress, walkthrough_id=walkthrough_id, definition=definition)
        )
    return sorted(statuses, key=lambda row: row["walkthrough_id"])


def _apply_transition(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    walkthrough_id: str,
    transition: Callable[[dict[str, Any], WalkthroughDefinition, str], dict[str, Any]],
) -> dict[str, Any]:
    definition = _resolve_definition(walkthrough_id)
    progress = _load_progress(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        definition=definition,
    )
    next_progress = transition(progress, definition, _now())
    saved = upsert_progress(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        **{k: next_progress[k] for k in (
            "walkthrough_version", "status", "current_step_index",
            "dismissal_reason", "started_at", "last_interacted_at",
            "completed_at", "times_completed", "times_started",
        )},
    )
    return _as_status(saved, walkthrough_id=walkthrough_id, definition=definition)


def begin_walkthrough(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any]:
    return _apply_transition(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        transition=_begin,
    )


def advance_walkthrough(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any]:
    return _apply_transition(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        transition=_advance,
    )


def go_back_walkthrough(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any]:
    return _apply_transition(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        transition=_go_back,
    )


def interrupt_walkthrough(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any]:
    return _apply_transition(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        transition=lambda progress, definition, now: _interrupt(progress, now),
    )


def resume_walkthrough(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any]:
    return _apply_transition(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        transition=_resume,
    )


def complete_walkthrough(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any]:
    return _apply_transition(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        transition=_complete,
    )


def skip_walkthrough(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str, reason: str
) -> dict[str, Any]:
    return _apply_transition(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        transition=lambda progress, definition, now: _skip(
            progress, definition, now, reason=reason
        ),
    )


def replay_walkthrough(
    conn: sqlite3.Connection, *, account_id: str, walkthrough_id: str
) -> dict[str, Any]:
    return _apply_transition(
        conn, account_id=account_id, walkthrough_id=walkthrough_id,
        transition=_replay,
    )
```

Note on `OnboardingTransitionError` propagation: it is intentionally
**not** caught here. It propagates to the API layer (Task 4), which
translates it to a 409, exactly mirroring how `webapp/api/handoff.py`'s
`_translate()` maps service-level exceptions to HTTP status codes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/webapp/services/test_onboarding_service.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Run full services regression suite**

Run: `pytest tests/webapp/services -v`
Expected: PASS (no regressions)

- [ ] **Step 6: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now two commits ahead of frozen baseline, status shows only
the new service file and its test. Stop on drift.

- [ ] **Step 7: Commit**

```bash
git add webapp/services/onboarding.py tests/webapp/services/test_onboarding_service.py
git commit -m "feat(onboarding): add service layer wiring engine to persistence"
```

---

### Task 4: HTTP API surface

**Files:**
- Create: `webapp/api/onboarding.py`
- Modify: `webapp/app.py`
- Test: `tests/webapp/api/test_onboarding_routes.py`

**Interfaces:**
- Consumes:
  - From Task 3: every `webapp.services.onboarding.*` function and
    `WalkthroughNotFound`.
  - From Task 2: `OnboardingTransitionError`, plus a test-only registered
    walkthrough via `register_walkthrough`.
  - Existing: `webapp.api.dependencies.{get_account_scope, get_conn}`,
    `webapp.services.ownership.AccountScope`.
- Produces (for Ticket 2's frontend to call — no other in-repo consumer
  yet, so this task's tests are the only proof of contract):
  - `GET /api/onboarding/walkthroughs` → 200, list of status dicts (Help →
    Walkthroughs will consume this in Ticket 7).
  - `GET /api/onboarding/walkthroughs/{walkthrough_id}` → 200 status dict,
    404 if unknown.
  - `POST /api/onboarding/walkthroughs/{walkthrough_id}/begin` → 201
    status dict, 404 if unknown, 409 on illegal transition.
  - `POST .../advance`, `.../back`, `.../interrupt`, `.../resume`,
    `.../complete`, `.../replay` → 200 status dict, 404 if unknown, 409 on
    illegal transition.
  - `POST .../skip` with JSON body `{"reason": "skip" | "dont_show_again" | "close"}`
    → 200 status dict, 404 if unknown, 400 on invalid reason, 409 on
    illegal transition (e.g. skip before begin).

- [ ] **Step 1: Write the failing API tests**

```python
# tests/webapp/api/test_onboarding_routes.py
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from product.onboarding import WalkthroughDefinition, WalkthroughStep, register_walkthrough
from webapp.app import create_app
from webapp.config import Settings


@pytest.fixture(autouse=True)
def _register_route_test_walkthrough():
    register_walkthrough(
        WalkthroughDefinition(
            walkthrough_id="api_test_walkthrough",
            version=1,
            title="API test walkthrough",
            steps=(
                WalkthroughStep(
                    step_id="s0", target="[data-onboarding-target=a]",
                    title="A", body="A body",
                ),
                WalkthroughStep(
                    step_id="s1", target="[data-onboarding-target=b]",
                    title="B", body="B body",
                ),
            ),
        )
    )


def _app(tmp_path):
    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", documents_root=tmp_path / "documents",
    )
    return create_app(settings)


def test_list_walkthroughs_includes_registered_not_started(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/onboarding/walkthroughs")
        assert response.status_code == 200, response.text
        ids = {row["walkthrough_id"] for row in response.json()}
        assert "api_test_walkthrough" in ids


def test_get_single_walkthrough_not_found(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/onboarding/walkthroughs/does_not_exist")
        assert response.status_code == 404


def test_begin_advance_complete_lifecycle_over_http(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        begun = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/begin"
        )
        assert begun.status_code == 201, begun.text
        assert begun.json()["status"] == "in_progress"

        advanced = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/advance"
        )
        assert advanced.status_code == 200, advanced.text
        assert advanced.json()["current_step_index"] == 1

        completed = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/complete"
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "completed"

        fetched = client.get("/api/onboarding/walkthroughs/api_test_walkthrough")
        assert fetched.json()["status"] == "completed"


def test_illegal_transition_returns_409(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/back"
        )
        assert response.status_code == 409, response.text


def test_skip_requires_valid_reason(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/begin")
        bad = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/skip",
            json={"reason": "not_a_real_reason"},
        )
        assert bad.status_code in (400, 409), bad.text

        good = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/skip",
            json={"reason": "dont_show_again"},
        )
        assert good.status_code == 200, good.text
        assert good.json()["dismissal_reason"] == "dont_show_again"


def test_interrupt_then_resume_over_http(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/begin")
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/advance")
        interrupted = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/interrupt"
        )
        assert interrupted.status_code == 200
        assert interrupted.json()["status"] == "in_progress"

        resumed = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/resume"
        )
        assert resumed.status_code == 200
        assert resumed.json()["current_step_index"] == 1


def test_replay_after_completion_over_http(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/begin")
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/advance")
        client.post("/api/onboarding/walkthroughs/api_test_walkthrough/complete")

        replayed = client.post(
            "/api/onboarding/walkthroughs/api_test_walkthrough/replay"
        )
        assert replayed.status_code == 200, replayed.text
        body = replayed.json()
        assert body["status"] == "in_progress"
        assert body["current_step_index"] == 0
        assert body["times_completed"] == 1


def test_begin_unknown_walkthrough_returns_404(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        response = client.post("/api/onboarding/walkthroughs/does_not_exist/begin")
        assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/api/test_onboarding_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'webapp.api.onboarding'`

- [ ] **Step 3: Implement the API router**

```python
# webapp/api/onboarding.py
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from product.onboarding import OnboardingTransitionError
from webapp.api.dependencies import get_account_scope, get_conn
from webapp.services.onboarding import (
    WalkthroughNotFound,
    advance_walkthrough,
    begin_walkthrough,
    complete_walkthrough,
    get_walkthrough_status,
    go_back_walkthrough,
    interrupt_walkthrough,
    list_walkthrough_statuses,
    replay_walkthrough,
    resume_walkthrough,
    skip_walkthrough,
)
from webapp.services.ownership import AccountScope

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SkipBody(StrictBody):
    reason: str


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, WalkthroughNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, OnboardingTransitionError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/walkthroughs")
def list_walkthroughs(
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict]:
    return list_walkthrough_statuses(conn, account_id=scope.account_id)


@router.get("/walkthroughs/{walkthrough_id}")
def get_walkthrough(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return get_walkthrough_status(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except WalkthroughNotFound as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/begin", status_code=201)
def begin(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return begin_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/advance")
def advance(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return advance_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/back")
def back(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return go_back_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/interrupt")
def interrupt(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return interrupt_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/resume")
def resume(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return resume_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/complete")
def complete(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return complete_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/skip")
def skip(
    walkthrough_id: str,
    body: SkipBody,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return skip_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id,
            reason=body.reason,
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc


@router.post("/walkthroughs/{walkthrough_id}/replay")
def replay(
    walkthrough_id: str,
    scope: AccountScope = Depends(get_account_scope),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return replay_walkthrough(
            conn, account_id=scope.account_id, walkthrough_id=walkthrough_id
        )
    except (WalkthroughNotFound, OnboardingTransitionError) as exc:
        raise _translate(exc) from exc
```

Note: `skip`'s invalid-`reason` case raises `OnboardingTransitionError`
from the pure engine (Task 2's `skip()`), which `_translate` maps to 409,
not 400 — the test above accepts either `(400, 409)` to avoid the plan
prescribing a distinction the engine doesn't actually make. This keeps
Task 2 the single source of truth for what "invalid" means instead of
duplicating validation in the API layer.

Register the router in `webapp/app.py`:

```python
from webapp.api.onboarding import router as onboarding_router
```

and, alongside the other `app.include_router(...)` calls:

```python
app.include_router(onboarding_router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/webapp/api/test_onboarding_routes.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Run full webapp regression suite**

Run: `pytest tests/webapp -v`
Expected: PASS (no regressions in any existing route/persistence/service
test)

- [ ] **Step 6: Run the complete test suite**

Run: `pytest -v`
Expected: PASS across `tests/product`, `tests/webapp`, and any other
existing suites. If a pre-existing failure is discovered that is unrelated
to onboarding, stop and report it distinctly rather than folding a fix
into this ticket's diff.

- [ ] **Step 7: Verify worktree state before commit**

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: HEAD now three commits ahead of frozen baseline, status shows
only `webapp/api/onboarding.py`, the modified `webapp/app.py`, and the new
test file. `git diff --check` empty. Stop on drift.

- [ ] **Step 8: Commit**

```bash
git add webapp/api/onboarding.py webapp/app.py tests/webapp/api/test_onboarding_routes.py
git commit -m "feat(onboarding): expose walkthrough state engine over HTTP"
```

---

## Post-Ticket-1 Report Checklist

Before reporting Ticket 1 complete, confirm:
- [ ] All four tasks committed as separate commits on
  `feature/contextual-onboarding`.
- [ ] `git log --oneline 12224eeb6d401209ed0da6fe1360fc90a722bc98..HEAD` shows
  exactly these four commits, nothing else.
- [ ] `git status --short` clean.
- [ ] Full test suite (`pytest -v`) passes.
- [ ] `git diff --check` clean.
- [ ] No file outside `product/onboarding.py`,
  `webapp/persistence/migrations.py`, `webapp/persistence/onboarding.py`,
  `webapp/services/onboarding.py`, `webapp/api/onboarding.py`,
  `webapp/app.py`, and their four test files was touched.
- [ ] Nothing pushed; `master` untouched; no other worktree touched.
- [ ] Stop here and report back before beginning Ticket 2 (shared overlay
  UI), per the stream's explicit sequencing.
