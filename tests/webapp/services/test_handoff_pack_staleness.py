"""Phase 4C Task 10 follow-up: confirm_handoff_submission is a SECOND
production entry point (alongside webapp/services/http_api.py::
change_job_status) that can transition a workspace to 'applied' -- it calls
webapp.persistence.workflow.record_status_change directly, so commit
0431ec5's staleness gate on change_job_status never runs on this path.

This module proves confirm_handoff_submission now carries the same gate,
mirroring change_job_status's existing pattern: check_staleness(conn,
workspace_id, "application_pack", ...) is called before record_status_change
whenever mark_workflow_applied=True, and a stale pack is rejected with
HandoffPackStale before ANY side effect (no record_status_change, no
set_handoff_session_status, no create_submission_confirmation, no commit).

The stale-pack fixture is constructed exactly like
tests/webapp/services/test_application_pack_staleness_via_resolved_blocker_answers.py
already does for change_job_status -- a resolved_blocker_answers change
without a Job Fit rerun -- via that file's own
_confirm_pack_then_correct_answer_without_rerun helper, reused here rather
than reimplemented, so both entry points are proven stale via the identical
transitive mechanism.
"""

from __future__ import annotations

import pytest

from webapp.persistence.accounts import DEFAULT_ACCOUNT_ID
from webapp.services.handoff import (
    HandoffPackStale,
    HandoffSessionNotActive,
    confirm_handoff_submission,
    start_handoff_session,
)
from webapp.services.ownership import AccountScope, account_profile_root
from webapp.services.staleness import check_staleness

from tests.webapp.services.test_application_pack_staleness_via_resolved_blocker_answers import (
    _confirm_pack_then_correct_answer_without_rerun,
)


def _default_scope(tmp_path):
    return AccountScope(
        account_id=DEFAULT_ACCOUNT_ID,
        profile_root=account_profile_root(str(tmp_path), DEFAULT_ACCOUNT_ID),
    )


def _start_session_for_pack(conn, tmp_path, workspace_id, pack_artifact_id):
    # This reconstructed Phase-4C-only candidate predates the session-token
    # authorization work (excluded, unrelated stream): confirm_handoff_
    # submission still takes the plain AccountScope every other handoff
    # entry point uses, not a token-derived SessionScope. Session identity
    # is therefore just the same scope used to start the session.
    scope = _default_scope(tmp_path)
    session = start_handoff_session(
        conn, scope, workspace_id=workspace_id, pack_artifact_id=pack_artifact_id,
        target_url="https://boards.greenhouse.io/acme/jobs/1",
        target_domain="boards.greenhouse.io", ats_adapter_id="greenhouse",
        ats_adapter_version="greenhouse@1",
    )
    return session, scope


def _row_counts(conn, session_id):
    (workflow_events,) = conn.execute(
        "SELECT COUNT(*) FROM workflow_events"
    ).fetchone()
    (confirmations,) = conn.execute(
        "SELECT COUNT(*) FROM submission_confirmations WHERE handoff_session_id = ?",
        (session_id,),
    ).fetchone()
    return workflow_events, confirmations


def test_confirm_handoff_submission_rejects_applied_when_pack_is_stale(
    tmp_path, webapp_profile_root,
):
    conn, workspace_id, pack_artifact_id = _confirm_pack_then_correct_answer_without_rerun(
        tmp_path, webapp_profile_root,
    )
    staleness = check_staleness(conn, workspace_id, "application_pack")
    assert staleness["stale"] is True

    session, session_scope = _start_session_for_pack(
        conn, tmp_path, workspace_id, pack_artifact_id,
    )
    workflow_events_before, confirmations_before = _row_counts(conn, session["id"])

    with pytest.raises(HandoffPackStale, match="stale"):
        confirm_handoff_submission(
            conn, session_scope, handoff_session_id=session["id"],
            mark_workflow_applied=True, effective_date="2026-09-16",
        )

    # No side effect of any kind happened: the session is still
    # in_progress (not user_confirmed_submitted), no submission_confirmations
    # row was created, and no new workflow_events row was recorded.
    from webapp.persistence.handoff import get_handoff_session

    reloaded = get_handoff_session(conn, session["id"])
    assert reloaded["status"] == "in_progress"

    workflow_events_after, confirmations_after = _row_counts(conn, session["id"])
    assert workflow_events_after == workflow_events_before
    assert confirmations_after == confirmations_before == 0

    conn.close()


def test_confirm_handoff_submission_allows_applied_when_pack_is_current(tmp_path):
    # Reuses test_application_pack.py's own _workspace/_seed_completion_ready/
    # confirm_application_pack fixtures to build a REAL, fully-fingerprinted,
    # non-stale pack -- a hand-built application_pack artifact with no
    # dependency fingerprints (as in test_handoff.py's _workspace_with_pack)
    # is itself seen as stale by check_staleness (missing required
    # fingerprints), which would make this "fresh pack succeeds" case
    # indistinguishable from the stale case it's meant to contrast with.
    from tests.webapp.services.test_application_pack import (
        _seed_completion_ready,
        _workspace,
    )
    from webapp.services.application_pack import confirm_application_pack

    conn, workspace_id = _workspace(tmp_path)
    _seed_completion_ready(conn, workspace_id)
    confirmed = confirm_application_pack(
        conn, workspace_id, effective_date="2026-09-15",
        documents_root=tmp_path / "documents",
    )
    pack_artifact_id = confirmed["artifact"]["id"]

    staleness = check_staleness(conn, workspace_id, "application_pack")
    assert staleness["stale"] is False

    session, session_scope = _start_session_for_pack(
        conn, tmp_path, workspace_id, pack_artifact_id,
    )

    result = confirm_handoff_submission(
        conn, session_scope, handoff_session_id=session["id"],
        mark_workflow_applied=True, effective_date="2026-09-16",
    )
    assert result["session"]["status"] == "user_confirmed_submitted"
    assert result["workflow_event"]["new_status"] == "applied"
    assert result["confirmation"]["handoff_session_id"] == session["id"]
    conn.close()


def test_confirm_handoff_submission_without_workflow_update_is_unaffected_by_staleness(
    tmp_path, webapp_profile_root,
):
    """mark_workflow_applied=False must never even reach the staleness
    check -- it lives strictly inside the `if mark_workflow_applied:`
    block -- so a stale pack must not block the "just confirm the
    session" path."""
    conn, workspace_id, pack_artifact_id = _confirm_pack_then_correct_answer_without_rerun(
        tmp_path, webapp_profile_root,
    )
    staleness = check_staleness(conn, workspace_id, "application_pack")
    assert staleness["stale"] is True

    session, session_scope = _start_session_for_pack(
        conn, tmp_path, workspace_id, pack_artifact_id,
    )

    result = confirm_handoff_submission(
        conn, session_scope, handoff_session_id=session["id"],
        mark_workflow_applied=False,
    )
    assert result["session"]["status"] == "user_confirmed_submitted"
    assert result["workflow_event"] is None
    conn.close()
