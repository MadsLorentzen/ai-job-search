from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.policy_decisions import save_policy_decision
from webapp.persistence.review import save_review_decision, list_review_decisions


def _setup(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    artifact = save_artifact(conn, workspace_id=ws["id"], artifact_type="job_fit_result", payload={"gaps": []})
    return conn, ws["id"], artifact["id"]


def test_save_review_decision_roundtrip(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    decision = save_review_decision(
        conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=artifact_id,
        domain_item_id="gap_001", disposition="acknowledged_and_proceed", note="Discussed in interview prep",
    )
    assert decision["disposition"] == "acknowledged_and_proceed"
    decisions = list_review_decisions(conn, workspace_id)
    assert len(decisions) == 1
    assert decisions[0]["domain_item_id"] == "gap_001"
    conn.close()


def test_list_review_decisions_filtered_by_artifact(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    other_artifact = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result", payload={"gaps": []})
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=artifact_id,
                          domain_item_id="gap_001", disposition="acknowledged_and_proceed")
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=other_artifact["id"],
                          domain_item_id="gap_002", disposition="omit_from_positioning")
    filtered = list_review_decisions(conn, workspace_id, source_artifact_id=artifact_id)
    assert len(filtered) == 1
    assert filtered[0]["domain_item_id"] == "gap_001"
    conn.close()


def test_review_decision_resolved_by_and_policy_decision_id_are_optional(tmp_path):
    """Phase 3 schema-only: save_review_decision (still the human-click
    path in this phase) is completely unaffected by the new columns --
    existing human decisions keep writing exactly as before, with
    resolved_by/policy_decision_id simply absent (NULL) on every row it
    produces. Wiring save_review_decision to populate these columns for a
    policy-authored decision is Phase 4 orchestration, not Phase 3."""
    conn, workspace_id, artifact_id = _setup(tmp_path)
    decision = save_review_decision(
        conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=artifact_id,
        domain_item_id="gap_001", disposition="acknowledged_and_proceed",
    )
    assert decision["resolved_by"] is None
    assert decision["policy_decision_id"] is None
    conn.close()


def test_review_decision_can_reference_a_policy_decision_via_raw_column(tmp_path):
    """Proves the new nullable review_decisions.policy_decision_id column
    can actually point at a real policy_decisions row -- the column and
    the FK-shaped reference work end to end, even though no orchestration
    populates it automatically yet in Phase 3."""
    conn, workspace_id, artifact_id = _setup(tmp_path)
    policy_decision = save_policy_decision(
        conn, workspace_id=workspace_id, stage="fit", source_artifact_id=artifact_id,
        review_item_type="gate_flag", subject_key="gate:eligibility", outcome="AUTO_PROCEED",
        policy_version="application-decision-policy.v0", policy_fingerprint="appdecpolicy_x",
        reason_code="gate_material_supportive", reason="Supportive.", blocking=False,
    )
    decision_id = "rev_manual_policy_linked"
    conn.execute(
        "INSERT INTO review_decisions "
        "(id, workspace_id, review_item_type, source_artifact_id, domain_item_id, "
        "disposition, note, created_at, resolved_by, policy_decision_id) "
        "VALUES (?, ?, 'gate_flag', ?, 'gate:eligibility', 'acknowledged_and_proceed', "
        "NULL, 'now', 'policy', ?)",
        (decision_id, workspace_id, artifact_id, policy_decision["id"]),
    )
    conn.commit()
    row = dict(conn.execute("SELECT * FROM review_decisions WHERE id = ?", (decision_id,)).fetchone())
    assert row["resolved_by"] == "policy"
    assert row["policy_decision_id"] == policy_decision["id"]
    conn.close()
