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
