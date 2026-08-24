from __future__ import annotations

import secrets
import sqlite3
from typing import Any

from webapp.persistence.artifacts import get_artifact
from webapp.persistence.handoff import (
    create_extension_credential,
    create_handoff_session,
    find_in_progress_handoff_sessions,
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
