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


from webapp.persistence.handoff import (
    create_handoff_session,
    find_in_progress_handoff_sessions,
    get_handoff_session,
    set_handoff_session_status,
)
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.workspaces import create_workspace


def _setup_handoff_session_test(conn, account_id, workspace_id):
    """Create the required workspace and artifact records for a handoff session test."""
    # Create workspace
    create_workspace(
        conn, account_id=account_id, workspace_id=workspace_id,
        company="Test Company", title="Test Job",
    )
    # Create artifact (application_pack type)
    artifact = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_pack",
        payload={},
    )
    return artifact["id"]


def test_create_and_get_handoff_session(tmp_path):
    conn = _conn(tmp_path)
    pack_artifact_id = _setup_handoff_session_test(conn, "account_local", "ws_1")
    session = create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id=pack_artifact_id, target_url="https://boards.greenhouse.io/acme/jobs/1",
        target_domain="boards.greenhouse.io", ats_adapter_id="greenhouse",
        ats_adapter_version="greenhouse@1",
    )
    assert session["status"] == "in_progress"
    assert session["pack_artifact_id"] == pack_artifact_id

    fetched = get_handoff_session(conn, session["id"])
    assert fetched == session
    conn.close()


def test_find_in_progress_sessions_is_discovery_only(tmp_path):
    conn = _conn(tmp_path)
    pack_artifact_id = _setup_handoff_session_test(conn, "account_local", "ws_1")
    session = create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id=pack_artifact_id, target_url="https://boards.greenhouse.io/acme/jobs/1",
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
    pack_artifact_id = _setup_handoff_session_test(conn, "account_local", "ws_1")
    session = create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id=pack_artifact_id, target_url="https://x.test/apply",
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
    pack_artifact_id = _setup_handoff_session_test(conn, "account_local", "ws_1")
    session = create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id=pack_artifact_id, target_url="https://x.test/apply",
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


import json

from webapp.persistence.handoff import (
    append_handoff_event,
    create_submission_confirmation,
    list_handoff_events,
)


def _session(conn):
    pack_artifact_id = _setup_handoff_session_test(conn, "account_local", "ws_1")
    return create_handoff_session(
        conn, account_id="account_local", workspace_id="ws_1",
        pack_artifact_id=pack_artifact_id, target_url="https://x.test/apply",
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
