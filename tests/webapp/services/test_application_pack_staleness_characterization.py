"""Characterization test for spec Sec15's pack-safety invariant, run before
any Phase 4C implementation. Determines whether confirming an application
pack and then letting its job_fit_result basis change (without a Job Fit
rerun happening automatically -- Phase 4B/4C never fan out reruns) allows
the workspace to still be marked 'applied' on the now-stale pack.

If this test's assertion shows the 'applied' transition is REJECTED once
the basis has gone stale, the existing machinery already enforces the
invariant and Task 10 becomes a no-op verification, not a new fix.
If it shows the transition SUCCEEDS despite staleness, Task 10 must add
the missing check (most likely gating on check_staleness("application_pack")
in webapp/persistence/workflow.py's applied branch).

See docs/superpowers/specs/2026-09-14-phase-4c-blocker-resolution-consumption-resume-design.md
Sec15 and docs/superpowers/plans/2026-09-15-phase-4c-blocker-resolution-consumption-resume.md
Task 1 for the full rationale.

This test builds its Job Fit -> Application Intelligence -> Gate 4 setup by
reusing the exact tested happy-path helpers from
tests/webapp/test_full_journey_acceptance.py (the FastAPI TestClient chain),
because that module is the actual working, tested sequence through Gate 4 --
not a guessed one. It only drops to raw persistence calls (direct SQL, and
webapp.persistence.workflow.record_status_change) for the two things that
have no HTTP surface today: mutating the job posting snapshot to simulate a
changed basis, and observing the raw outcome of the 'applied' transition
without an HTTP 400 wrapper obscuring whether it was a ValueError or
something else.
"""

from __future__ import annotations

from webapp.persistence.db import connect
from webapp.persistence.workflow import record_status_change
from webapp.services.staleness import check_staleness

from tests.webapp.test_full_journey_acceptance import (
    _build_chain,
    _close,
    _decide_current_review_surface,
)
from tests.webapp.fixtures.acceptance.fixtures import completion_ready_content_units


def test_confirming_pack_then_changing_job_fit_basis_and_marking_applied(tmp_path):
    """Confirm a pack (Gate 4), then change the job_fit_result basis behind
    its back (without reconfirming a new pack), and attempt to mark the
    workspace 'applied' while bound to the now-stale pack artifact."""
    client, app, settings, workspace_id = _build_chain(
        tmp_path, ai_units=completion_ready_content_units(),
    )
    try:
        # Drive the tested happy path through Gate 4: acknowledge every
        # review item, then confirm the application pack.
        _decide_current_review_surface(client, workspace_id)
        pack_response = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-09-15"},
        )
        assert pack_response.status_code == 201, pack_response.text
        pack_artifact_id = pack_response.json()["artifact"]["id"]

        conn = connect(settings.db_path)

        # Change the basis: mutate the underlying job_posting_snapshot
        # artifact's payload directly via raw SQL (webapp/persistence/
        # artifacts.py confirms the table is "artifacts" and the payload
        # column is "payload_json"), then rerun Job Fit for the same
        # workspace. This produces a new job_fit_result with a different
        # content_id, without ever going through a Gate-4 reconfirmation --
        # the pack still binds the OLD job_fit_result's content_id.
        conn.execute(
            "UPDATE artifacts SET payload_json = json_set("
            "payload_json, '$.eligibility_requirements', "
            "json('[{\"id\": \"jobev_new_elig\", "
            "\"text\": \"Must have the right to work in the UK.\", "
            "\"kind\": \"required\"}]')) "
            "WHERE workspace_id = ? AND artifact_type = 'job_posting_snapshot'",
            (workspace_id,),
        )
        conn.commit()
        conn.close()

        # resolved_job_evidence's own build validates that its preserved
        # evidence IDs still match the current job_posting_snapshot, so
        # re-running Job Fit alone (without also re-running Understanding)
        # against a snapshot mutated in place fails safe with a construction
        # error rather than silently using stale evidence. Re-run
        # Understanding first to restore a consistent chain -- this still
        # changes the Job Fit basis relative to the confirmed pack, which is
        # all this test needs.
        reunderstand = client.post(
            f"/api/workspaces/{workspace_id}/understand",
            json={"request_id": "understand-basis-changed"},
        )
        assert reunderstand.status_code == 200, reunderstand.text

        refit = client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={"request_id": "fit-basis-changed", "extension_ids": ["data-transfer"]},
        )
        assert refit.status_code == 200, refit.text

        conn = connect(settings.db_path)

        # Sanity check: the dependency graph must actually see the pack as
        # stale now, or this test is not exercising the condition it claims
        # to. This is not the interesting assertion -- it is a guard that
        # the setup above genuinely changed the basis. extensions_dir must
        # be passed explicitly (check_staleness's default of Path("extensions")
        # does not match this test's tmp_path-based settings.extensions_dir,
        # and would otherwise report spurious staleness from an unrelated
        # "active extensions are no longer installed" reason).
        staleness = check_staleness(
            conn, workspace_id, "application_pack",
            extensions_dir=settings.extensions_dir,
        )
        assert staleness["stale"] is True, (
            "setup did not actually make the pack stale -- test is not "
            f"exercising the intended condition: {staleness}"
        )

        # The actual question this task exists to answer: does attempting
        # to mark the workspace 'applied' -- still bound to the OLD,
        # now-stale pack artifact -- succeed or raise?
        #
        # CONFIRMED GAP: record_status_change's "applied" branch
        # (webapp/persistence/workflow.py's _record_status_change_reserved)
        # validates that the bound pack exists, belongs to this workspace,
        # is of type "application_pack", was built under the current
        # completion-contract version, and has completion_status == "READY".
        # It never calls check_staleness. Reading that function confirmed
        # no staleness check exists on this path; running the test below
        # confirmed the transition actually succeeds despite the pack being
        # stale -- this is a real gap per spec Sec15, and Task 10 must add a
        # check_staleness("application_pack") gate to close it.
        event = record_status_change(
            conn, workspace_id=workspace_id, new_status="applied",
            effective_date="2026-09-16",
            submitted_pack_artifact_id=pack_artifact_id,
        )
        assert event["new_status"] == "applied"
        assert event["submitted_pack_artifact_id"] == pack_artifact_id

        conn.close()
    finally:
        _close(client)
