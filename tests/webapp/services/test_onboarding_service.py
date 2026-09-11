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
