"""find_semantic_subject_match: cross-application answer lookup keyed on
semantic_subject_key, not subject_key string equality (Phase 4C spec §5).

Correction (spec §5 point 3 / §17): this function performs exactly ONE
cross-workspace query -- SEARCH_WORKSPACE-scoped resolutions belonging to a
sibling workspace in the same real search workspace. It must never look up
a CANDIDATE_FACT-scoped resolution across workspaces; doing so would rebuild
the shadow candidate-evidence store the design explicitly rules out.
"""

from __future__ import annotations

from webapp.persistence.application_blockers import resolve_application_blocker
from webapp.persistence.application_identity import record_application_origin
from webapp.services.decision_policy import (
    current_application_blockers,
    find_semantic_subject_match,
)

from tests.webapp.services.test_application_blockers import (
    SPONSORSHIP_STATUS_JOB_SNAPSHOT,
    _run_fit,
    _workspace,
)


def _ensure_search_workspace(conn, search_workspace_id):
    """search_workspaces has a real FK from discovery_candidates -- only
    'search_default' exists out of the box (migration 001), so a distinct
    search workspace id used by these tests needs its own row."""

    existing = conn.execute(
        "SELECT 1 FROM search_workspaces WHERE id = ?", (search_workspace_id,)
    ).fetchone()
    if existing:
        return
    conn.execute(
        "INSERT INTO search_workspaces "
        "(id, name, status, revision, created_at, updated_at, archived_at) "
        "VALUES (?, 'Test search', 'active', 1, 'now', 'now', NULL)",
        (search_workspace_id,),
    )
    conn.commit()


def _link_to_search_workspace(conn, workspace_id, *, search_workspace_id, suffix):
    """Real application_workspace_origins row, mirroring
    test_search_workspace_scope_accepted_for_genuinely_linked_search_workspace
    in test_application_blockers.py -- discovery_candidates/discovery_occurrences
    are real foreign keys, not fabricated ids."""

    _ensure_search_workspace(conn, search_workspace_id)
    candidate_id = f"candidate_{suffix}"
    occurrence_id = f"occurrence_{suffix}"
    conn.execute(
        "INSERT INTO discovery_candidates "
        "(id, search_workspace_id, company, title, location, lifecycle_status, "
        "canonical_occurrence_id, promoted_workspace_id, first_seen_at, last_seen_at, updated_at) "
        "VALUES (?, ?, 'Acme', 'Backend Engineer', NULL, "
        "'promoted', ?, ?, 'now', 'now', 'now')",
        (candidate_id, search_workspace_id, occurrence_id, workspace_id),
    )
    conn.execute(
        "INSERT INTO discovery_occurrences "
        "(id, search_workspace_id, candidate_id, run_id, source, source_record_id, "
        "source_url, source_record_json, captured_at, created_at) "
        "VALUES (?, ?, ?, NULL, 'manual', NULL, NULL, '{}', 'now', 'now')",
        (occurrence_id, search_workspace_id, candidate_id),
    )
    conn.commit()
    record_application_origin(
        conn, application_workspace_id=workspace_id, search_workspace_id=search_workspace_id,
        discovery_candidate_id=candidate_id, discovery_occurrence_id=occurrence_id,
        discovery_run_id=None,
    )


def _setup_two_sibling_workspaces(tmp_path, webapp_profile_root, *, search_workspace_id="search_1"):
    conn, workspace_a_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    from webapp.persistence.artifacts import save_artifact
    from webapp.persistence.workspaces import create_workspace

    workspace_b = create_workspace(conn, company="Acme", title="Backend Engineer (Sibling)")
    workspace_b_id = workspace_b["id"]
    save_artifact(
        conn, workspace_id=workspace_b_id, artifact_type="job_posting_snapshot",
        payload=SPONSORSHIP_STATUS_JOB_SNAPSHOT, content_id="jobsnap_sibling",
    )

    _link_to_search_workspace(conn, workspace_a_id, search_workspace_id=search_workspace_id, suffix="a")
    _link_to_search_workspace(conn, workspace_b_id, search_workspace_id=search_workspace_id, suffix="b")

    _run_fit(conn, workspace_a_id, tmp_path, request_id="req_fit_a")
    _run_fit(conn, workspace_b_id, tmp_path, request_id="req_fit_b")

    return conn, workspace_a_id, workspace_b_id


def test_search_workspace_answer_on_a_is_found_for_b_by_semantic_subject(
    tmp_path, webapp_profile_root,
):
    conn, workspace_a_id, workspace_b_id = _setup_two_sibling_workspaces(tmp_path, webapp_profile_root)

    from webapp.persistence.artifacts import get_current_artifact

    fit_artifact_a = get_current_artifact(conn, workspace_a_id, "job_fit_result")
    blocker_a = next(
        b for b in current_application_blockers(conn, workspace_a_id, fit_artifact_a["id"])
        if b["subject_key"] == "gate:eligibility"
    )
    resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="SEARCH_WORKSPACE", resolved_by="user_1",
    )

    match = find_semantic_subject_match(
        conn, workspace_id=workspace_b_id,
        semantic_subject_key="work_authorization.sponsorship_required",
    )
    assert match is not None
    assert match["answer_scope"] == "SEARCH_WORKSPACE"
    conn.close()


def test_no_match_when_semantic_subject_key_is_none(tmp_path, webapp_profile_root):
    conn, workspace_a_id, workspace_b_id = _setup_two_sibling_workspaces(tmp_path, webapp_profile_root)
    match = find_semantic_subject_match(conn, workspace_id=workspace_b_id, semantic_subject_key=None)
    assert match is None
    conn.close()


def test_no_match_across_different_search_workspaces(tmp_path, webapp_profile_root):
    conn, workspace_a_id = _workspace(
        tmp_path, webapp_profile_root, job_snapshot=SPONSORSHIP_STATUS_JOB_SNAPSHOT
    )
    from webapp.persistence.artifacts import save_artifact
    from webapp.persistence.workspaces import create_workspace

    workspace_b = create_workspace(conn, company="Acme", title="Backend Engineer (Other Search)")
    workspace_b_id = workspace_b["id"]
    save_artifact(
        conn, workspace_id=workspace_b_id, artifact_type="job_posting_snapshot",
        payload=SPONSORSHIP_STATUS_JOB_SNAPSHOT, content_id="jobsnap_other_search",
    )

    _link_to_search_workspace(conn, workspace_a_id, search_workspace_id="search_1", suffix="a2")
    _link_to_search_workspace(conn, workspace_b_id, search_workspace_id="search_2", suffix="b2")

    _run_fit(conn, workspace_a_id, tmp_path, request_id="req_fit_a2")
    _run_fit(conn, workspace_b_id, tmp_path, request_id="req_fit_b2")

    from webapp.persistence.artifacts import get_current_artifact

    fit_artifact_a = get_current_artifact(conn, workspace_a_id, "job_fit_result")
    blocker_a = next(
        b for b in current_application_blockers(conn, workspace_a_id, fit_artifact_a["id"])
        if b["subject_key"] == "gate:eligibility"
    )
    resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="SEARCH_WORKSPACE", resolved_by="user_1",
    )

    match = find_semantic_subject_match(
        conn, workspace_id=workspace_b_id,
        semantic_subject_key="work_authorization.sponsorship_required",
    )
    assert match is None
    conn.close()


def test_candidate_fact_answer_on_sibling_is_never_matched(tmp_path, webapp_profile_root):
    # Correction per spec §5 point 3 / §17: find_semantic_subject_match
    # performs NO cross-workspace lookup for CANDIDATE_FACT at all -- not
    # even for a genuine SEARCH_WORKSPACE sibling. A CANDIDATE_FACT answer
    # is invisible outside its own originating workspace in Phase 4C,
    # full stop, to avoid rebuilding a shadow candidate-evidence store.
    conn, workspace_a_id, workspace_b_id = _setup_two_sibling_workspaces(tmp_path, webapp_profile_root)

    from webapp.persistence.artifacts import get_current_artifact

    fit_artifact_a = get_current_artifact(conn, workspace_a_id, "job_fit_result")
    blocker_a = next(
        b for b in current_application_blockers(conn, workspace_a_id, fit_artifact_a["id"])
        if b["subject_key"] == "gate:eligibility"
    )
    resolve_application_blocker(
        conn, blocker_id=blocker_a["id"], request_id="req-answer-1",
        answer_value={"type": "boolean", "value": False},
        answer_scope="CANDIDATE_FACT", resolved_by="user_1",
    )

    match = find_semantic_subject_match(
        conn, workspace_id=workspace_b_id,
        semantic_subject_key="work_authorization.sponsorship_required",
    )
    assert match is None
    conn.close()
