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


def test_replay_handoff_session_rejects_session_not_owned_by_scope(tmp_path):
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
        replay_handoff_session(conn, other_scope, session["id"])
        assert False, "expected HandoffSessionNotFound"
    except HandoffSessionNotFound:
        pass
    conn.close()


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
