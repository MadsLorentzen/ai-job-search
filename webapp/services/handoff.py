from __future__ import annotations

import secrets
import sqlite3
from typing import Any

from webapp.persistence.artifacts import get_artifact
from webapp.persistence.handoff import (
    append_handoff_event,
    create_extension_credential,
    create_handoff_session,
    find_in_progress_handoff_sessions,
    get_extension_credential_by_hash,
    get_handoff_session,
    hash_pairing_secret,
    list_handoff_events,
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
