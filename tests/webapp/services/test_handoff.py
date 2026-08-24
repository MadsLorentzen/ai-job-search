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
