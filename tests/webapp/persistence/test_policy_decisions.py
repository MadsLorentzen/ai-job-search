from __future__ import annotations

import pytest

from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.review import save_review_decision, list_review_decisions
from webapp.persistence.policy_decisions import (
    get_policy_decision,
    list_policy_decisions,
    save_policy_decision,
)


def _setup(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    artifact = save_artifact(
        conn, workspace_id=ws["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    return conn, ws["id"], artifact["id"]


def test_insert_read_round_trip_preserves_all_durable_fields(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    saved = save_policy_decision(
        conn,
        workspace_id=workspace_id,
        stage="fit",
        source_artifact_id=artifact_id,
        review_item_type="gate_flag",
        subject_key="gate:eligibility",
        domain_item_id="gate:eligibility",
        outcome="AUTO_PROCEED",
        policy_version="application-decision-policy.v0",
        policy_fingerprint="appdecpolicy_abc123",
        evidence_ids=["jev_1", "jev_2"],
        supported_facts=["Candidate is a British Citizen"],
        recorded_gaps=[],
        reason_code="gate_material_supportive",
        reason="Validated, non-conflicted supportive evidence.",
        confidence=None,
        blocking=False,
    )

    fetched = get_policy_decision(conn, saved["id"])
    assert fetched is not None
    assert fetched["workspace_id"] == workspace_id
    assert fetched["stage"] == "fit"
    assert fetched["source_artifact_id"] == artifact_id
    assert fetched["review_item_type"] == "gate_flag"
    assert fetched["subject_key"] == "gate:eligibility"
    assert fetched["domain_item_id"] == "gate:eligibility"
    assert fetched["outcome"] == "AUTO_PROCEED"
    assert fetched["policy_version"] == "application-decision-policy.v0"
    assert fetched["policy_fingerprint"] == "appdecpolicy_abc123"
    # JSON-list fields round-trip without losing order or namespace.
    assert fetched["evidence_ids"] == ["jev_1", "jev_2"]
    assert fetched["supported_facts"] == ["Candidate is a British Citizen"]
    assert fetched["recorded_gaps"] == []
    assert fetched["reason_code"] == "gate_material_supportive"
    assert fetched["reason"] == "Validated, non-conflicted supportive evidence."
    assert fetched["confidence"] is None
    assert fetched["blocking"] is False
    assert fetched["created_at"]
    conn.close()


def test_json_list_fields_preserve_order(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    saved = save_policy_decision(
        conn, workspace_id=workspace_id, stage="fit", source_artifact_id=artifact_id,
        review_item_type="human_judgment_question", subject_key="dimension:technical_skills",
        outcome="AUTO_PROCEED_WITH_GAPS", policy_version="application-decision-policy.v0",
        policy_fingerprint="appdecpolicy_x", reason_code="dimension_partial_coverage",
        reason="7/8 matched.", blocking=False,
        evidence_ids=["jreq_3", "jreq_1", "jreq_2"],
        recorded_gaps=["jreq_8"],
    )
    fetched = get_policy_decision(conn, saved["id"])
    assert fetched["evidence_ids"] == ["jreq_3", "jreq_1", "jreq_2"]
    assert fetched["recorded_gaps"] == ["jreq_8"]
    conn.close()


def test_identical_applicability_key_inserted_twice_yields_one_row(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    kwargs = dict(
        workspace_id=workspace_id, stage="fit", source_artifact_id=artifact_id,
        review_item_type="gate_flag", subject_key="gate:eligibility",
        outcome="AUTO_PROCEED", policy_version="application-decision-policy.v0",
        policy_fingerprint="appdecpolicy_abc", reason_code="gate_material_supportive",
        reason="Supportive.", blocking=False,
    )
    first = save_policy_decision(conn, **kwargs)
    second = save_policy_decision(conn, **kwargs)

    assert first["id"] == second["id"]
    rows = list_policy_decisions(conn, workspace_id, source_artifact_id=artifact_id)
    assert len(rows) == 1
    conn.close()


def test_different_policy_fingerprint_permits_new_decision(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    common = dict(
        workspace_id=workspace_id, stage="fit", source_artifact_id=artifact_id,
        review_item_type="gate_flag", subject_key="gate:eligibility",
        outcome="AUTO_PROCEED", policy_version="application-decision-policy.v0",
        reason_code="gate_material_supportive", reason="Supportive.", blocking=False,
    )
    save_policy_decision(conn, policy_fingerprint="appdecpolicy_v1", **common)
    save_policy_decision(conn, policy_fingerprint="appdecpolicy_v2", **common)

    rows = list_policy_decisions(conn, workspace_id, source_artifact_id=artifact_id)
    assert len(rows) == 2
    conn.close()


def test_different_source_artifact_permits_new_historical_decision(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    other_artifact = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result", payload={"gaps": []}
    )
    common = dict(
        workspace_id=workspace_id, stage="fit", review_item_type="gate_flag",
        subject_key="gate:eligibility", outcome="AUTO_PROCEED",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_supportive", reason="Supportive.", blocking=False,
    )
    save_policy_decision(conn, source_artifact_id=artifact_id, **common)
    save_policy_decision(conn, source_artifact_id=other_artifact["id"], **common)

    # Both remain permanently queryable: rerunning an upstream artifact
    # never deletes or supersedes the prior artifact's decisions.
    all_rows = list_policy_decisions(conn, workspace_id)
    assert len(all_rows) == 2
    assert {row["source_artifact_id"] for row in all_rows} == {artifact_id, other_artifact["id"]}
    conn.close()


def test_two_different_subject_keys_under_same_artifact_remain_distinct(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    common = dict(
        workspace_id=workspace_id, stage="fit", source_artifact_id=artifact_id,
        review_item_type="gate_flag", outcome="AUTO_PROCEED",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_supportive", reason="Supportive.", blocking=False,
    )
    save_policy_decision(conn, subject_key="gate:eligibility", **common)
    save_policy_decision(conn, subject_key="gate:language", **common)

    rows = list_policy_decisions(conn, workspace_id, source_artifact_id=artifact_id)
    assert len(rows) == 2
    assert {row["subject_key"] for row in rows} == {"gate:eligibility", "gate:language"}
    conn.close()


def test_stage_level_decision_uses_explicit_subject_key_not_empty(tmp_path):
    """A stage-level decision with no natural per-item domain_item_id must
    still supply a stable, non-empty subject_key (e.g. "stage") --
    matching the NOT NULL / non-empty contract even when there is no
    natural domain item."""
    conn, workspace_id, artifact_id = _setup(tmp_path)
    saved = save_policy_decision(
        conn, workspace_id=workspace_id, stage="understanding", source_artifact_id=artifact_id,
        review_item_type="understanding_suggestion", subject_key="stage", domain_item_id=None,
        outcome="AUTO_OMIT", policy_version="application-decision-policy.v0",
        policy_fingerprint="appdecpolicy_x", reason_code="suggestion_non_material",
        reason="Non-material suggestion, recorded and continued.", blocking=False,
    )
    assert saved["subject_key"] == "stage"
    assert saved["domain_item_id"] is None
    conn.close()


def test_empty_subject_key_rejected_by_persistence_function(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    with pytest.raises(ValueError, match="subject_key"):
        save_policy_decision(
            conn, workspace_id=workspace_id, stage="fit", source_artifact_id=artifact_id,
            review_item_type="gate_flag", subject_key="", outcome="AUTO_PROCEED",
            policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
            reason_code="gate_material_supportive", reason="Supportive.", blocking=False,
        )
    conn.close()


def test_unknown_outcome_rejected_by_persistence_function(tmp_path):
    """Persistence rejects malformed durable records rather than silently
    accepting an arbitrary string where a closed product contract
    (product.application_decision_policy.OUTCOMES) already exists."""
    conn, workspace_id, artifact_id = _setup(tmp_path)
    with pytest.raises(ValueError, match="outcome"):
        save_policy_decision(
            conn, workspace_id=workspace_id, stage="fit", source_artifact_id=artifact_id,
            review_item_type="gate_flag", subject_key="gate:eligibility",
            outcome="NOT_A_REAL_OUTCOME", policy_version="application-decision-policy.v0",
            policy_fingerprint="appdecpolicy_x", reason_code="reason_code", reason="reason",
            blocking=False,
        )
    conn.close()


def test_unknown_stage_rejected_by_persistence_function(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    with pytest.raises(ValueError, match="stage"):
        save_policy_decision(
            conn, workspace_id=workspace_id, stage="not_a_real_stage",
            source_artifact_id=artifact_id, review_item_type="gate_flag",
            subject_key="gate:eligibility", outcome="AUTO_PROCEED",
            policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
            reason_code="reason_code", reason="reason", blocking=False,
        )
    conn.close()


def test_list_policy_decisions_filters_by_workspace_and_artifact(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    other_ws = create_workspace(conn, company="Other Co", title="Other Role")
    other_artifact = save_artifact(
        conn, workspace_id=other_ws["id"], artifact_type="job_fit_result", payload={"gaps": []}
    )
    save_policy_decision(
        conn, workspace_id=workspace_id, stage="fit", source_artifact_id=artifact_id,
        review_item_type="gate_flag", subject_key="gate:eligibility", outcome="AUTO_PROCEED",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_supportive", reason="Supportive.", blocking=False,
    )
    save_policy_decision(
        conn, workspace_id=other_ws["id"], stage="fit", source_artifact_id=other_artifact["id"],
        review_item_type="gate_flag", subject_key="gate:eligibility", outcome="AUTO_OMIT",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_non_material_absent", reason="Omit.", blocking=False,
    )

    # Account/workspace isolation: listing one workspace never returns
    # another workspace's decisions, even under the same policy fingerprint.
    rows = list_policy_decisions(conn, workspace_id)
    assert len(rows) == 1
    assert rows[0]["workspace_id"] == workspace_id
    conn.close()


def test_policy_decisions_do_not_alter_which_review_decision_governs(tmp_path):
    """Phase 3 must not change workflow behavior: writing to the new
    policy_decisions table (or leaving it empty) has zero effect on
    list_review_decisions / the existing human-click governance path --
    workspace_view.py's _latest_decisions reads only review_decisions and
    is untouched in this phase. Confirmed end to end: a human decision's
    visibility through list_review_decisions is identical before and
    after inserting unrelated policy_decisions rows for the same
    workspace/artifact/subject."""
    conn, workspace_id, artifact_id = _setup(tmp_path)
    human_decision = save_review_decision(
        conn, workspace_id=workspace_id, review_item_type="gate_flag",
        source_artifact_id=artifact_id, domain_item_id="gate:eligibility",
        disposition="acknowledged_and_proceed",
    )
    before = list_review_decisions(conn, workspace_id, source_artifact_id=artifact_id)
    assert len(before) == 1
    assert before[0]["id"] == human_decision["id"]

    save_policy_decision(
        conn, workspace_id=workspace_id, stage="fit", source_artifact_id=artifact_id,
        review_item_type="gate_flag", subject_key="gate:eligibility", outcome="AUTO_PROCEED",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_supportive", reason="Supportive.", blocking=False,
    )

    after = list_review_decisions(conn, workspace_id, source_artifact_id=artifact_id)
    assert after == before
    conn.close()
