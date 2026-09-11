from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any, Callable

from product.onboarding import (
    WalkthroughDefinition,
    WALKTHROUGH_REGISTRY,
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
