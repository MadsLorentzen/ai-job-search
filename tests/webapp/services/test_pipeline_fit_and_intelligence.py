import json

import pytest

from webapp.persistence.db import init_db, connect
from webapp.persistence.artifacts import save_artifact, get_current_artifact
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.provider_audits import list_provider_audits
from webapp.persistence.user_profile import save_user_profile
from webapp.services.pipeline import refresh_profile, run_job_fit, run_application_intelligence, PipelineError
from webapp.services.staleness import check_staleness
from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter
from webapp.services.semantic_proposer_errors import SemanticProposerProviderError
from webapp.services.input_identity import (
    application_intelligence_generation_contract_identity,
    content_identity,
)


FIXTURE_PROFILE_ROOT = None  # set in Step 0 below to the same fixture Task 9 created


def _workspace_with_profile_and_job(tmp_path, profile_root):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    refresh_profile(conn, root=str(profile_root))

    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    job_snapshot = {
        "schema_version": "job-posting-snapshot.v0", "job_id": "jobsrc_test0000000000",
        "source": "manual", "captured_at": "2026-08-18T00:00:00Z",
        "company": "Acme", "title": "Backend Engineer",
        "requirements": [], "responsibilities": [], "language_requirements": [],
        "eligibility_requirements": [], "logistics_requirements": [],
        "metadata": {"ingestion": {}},
    }
    save_artifact(conn, workspace_id=ws["id"], artifact_type="job_posting_snapshot",
                   payload=job_snapshot, content_id="jobsnap_test")
    return conn, ws["id"]


def test_run_job_fit_persists_request_result_and_resolved_evidence(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})

    saved = run_job_fit(conn, workspace_id, adapter, request_id="req_fit_1")

    assert saved["artifact_type"] == "job_fit_result"
    assert get_current_artifact(conn, workspace_id, "job_fit_request") is not None
    assert get_current_artifact(conn, workspace_id, "resolved_job_evidence") is not None
    fingerprint_types = {
        row["upstream_artifact_type"]
        for row in conn.execute(
            "SELECT upstream_artifact_type FROM dependency_fingerprints WHERE artifact_id = ?",
            (saved["id"],),
        ).fetchall()
    }
    assert fingerprint_types == {"profile_snapshot", "resolved_job_evidence", "job_fit_request"}
    request = get_current_artifact(conn, workspace_id, "job_fit_request")
    request_fingerprints = {
        row["upstream_artifact_type"]
        for row in conn.execute(
            "SELECT upstream_artifact_type FROM dependency_fingerprints WHERE artifact_id = ?",
            (request["id"],),
        ).fetchall()
    }
    assert request_fingerprints == {
        "profile_snapshot", "resolved_job_evidence", "server:active_extensions",
        "server:evaluation_policy", "server:semantic_fit_policy",
        "server:semantic_proposer_policy",
        "server:semantic_proposals",
    }
    fingerprint_values = {
        row["upstream_artifact_type"]: row["upstream_content_id"]
        for row in conn.execute(
            "SELECT upstream_artifact_type, upstream_content_id FROM dependency_fingerprints "
            "WHERE artifact_id = ?", (request["id"],),
        ).fetchall()
    }
    assert fingerprint_values["server:evaluation_policy"] == content_identity(
        "evalpolicy_", request["payload"]["evaluation_policy"]
    )
    assert fingerprint_values["server:semantic_fit_policy"] == content_identity(
        "semfitpolicy_", request["payload"]["semantic_fit_policy"]
    )
    conn.close()


def test_run_job_fit_uses_global_profile_not_a_workspace_local_one(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    # no per-workspace profile_snapshot artifact exists — only the global one
    assert get_current_artifact(conn, workspace_id, "profile_snapshot") is None
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    saved = run_job_fit(conn, workspace_id, adapter, request_id="req_fit_2")
    assert saved["artifact_type"] == "job_fit_result"
    conn.close()


def test_user_profile_preferences_never_enter_or_stale_job_fit(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    evidence_before = get_current_artifact(conn, "profile", "profile_snapshot")
    save_user_profile(conn, {
        "target_roles": ["Project Manager"],
        "locations": ["Aberdeen, UK"],
        "remote_preference": "remote_or_hybrid",
        "recency_days": 14,
    })
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    fit = run_job_fit(conn, workspace_id, adapter, request_id="req_fit_preferences")
    request = get_current_artifact(conn, workspace_id, "job_fit_request")

    assert "user_profile" not in json.dumps(request["payload"])
    fingerprint_types = {
        row["upstream_artifact_type"]
        for row in conn.execute(
            "SELECT upstream_artifact_type FROM dependency_fingerprints WHERE artifact_id = ?",
            (request["id"],),
        ).fetchall()
    }
    assert not any("user_profile" in item for item in fingerprint_types)
    staleness_before_preference_change = check_staleness(
        conn, workspace_id, "job_fit_result"
    )

    save_user_profile(conn, {
        "target_roles": ["Programme Director"],
        "locations": ["Remote"],
        "remote_preference": "remote_only",
        "recency_days": 7,
    })

    evidence_after = get_current_artifact(conn, "profile", "profile_snapshot")
    assert evidence_after["id"] == evidence_before["id"]
    assert evidence_after["content_id"] == evidence_before["content_id"]
    assert get_current_artifact(conn, workspace_id, "job_fit_result")["id"] == fit["id"]
    assert check_staleness(
        conn, workspace_id, "job_fit_result"
    ) == staleness_before_preference_change


def test_run_job_fit_without_profile_raises_pipeline_error(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    save_artifact(conn, workspace_id=ws["id"], artifact_type="job_posting_snapshot",
                   payload={"job_id": "jobsrc_x"}, content_id="jobsnap_x")
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    with pytest.raises(PipelineError):
        run_job_fit(conn, ws["id"], adapter, request_id="req_fit_3")
    conn.close()


class _FailingSemanticAdapter:
    last_audit = {
        "provider_id": "test", "model_id": "test", "model_version": "v1",
        "policy_revision": "policy_test", "attempt_count": 1,
        "provider_response_id": None, "success": False,
        "error_type": "SyntheticFailure", "started_at": "2026-08-20T00:00:00Z",
        "completed_at": "2026-08-20T00:00:01Z",
    }

    def propose(self, **kwargs):
        raise SemanticProposerProviderError("simulated proposer outage")


def test_run_job_fit_proposer_failure_raises_pipeline_error_and_leaves_no_new_result(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    with pytest.raises(PipelineError):
        run_job_fit(conn, workspace_id, _FailingSemanticAdapter(), request_id="req_fit_4")
    assert get_current_artifact(conn, workspace_id, "job_fit_result") is None
    audits = list_provider_audits(conn, workspace_id, "semantic_job_fit_proposal")
    assert len(audits) == 1
    assert audits[0]["metadata"]["success"] is False
    assert audits[0]["request_artifact_id"] is None
    conn.close()


class _AuditedSemanticClient:
    def __init__(self):
        self.last_audit = None

    def complete(self, context):
        self.last_audit = {
            "provider_id": "test", "model_id": "test", "model_version": "v1",
            "policy_revision": "policy_test", "attempt_count": 1,
            "provider_response_id": "response-1", "success": True,
            "error_type": None, "started_at": "2026-08-20T00:00:00Z",
            "completed_at": "2026-08-20T00:00:01Z",
        }
        return {"matches": [], "gates": []}


def test_run_job_fit_persists_sanitized_provider_audit_separately(
    tmp_path, webapp_profile_root,
):
    from webapp.services.semantic_proposal_adapter import SemanticProposalAdapter

    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    saved = run_job_fit(
        conn, workspace_id, SemanticProposalAdapter(_AuditedSemanticClient()),
        request_id="req_fit_audit",
    )
    request = get_current_artifact(conn, workspace_id, "job_fit_request")
    audits = list_provider_audits(conn, workspace_id, "semantic_job_fit_proposal")
    assert len(audits) == 1
    assert audits[0]["request_artifact_id"] == request["id"]
    assert audits[0]["metadata"]["provider_response_id"] == "response-1"
    assert "provider_response_id" not in saved["payload"]


class _FakeApplicationIntelligenceProvider:
    provider_id = "fake"; model_id = "fake-model"; model_version = "fake-model-v0"

    def propose(self, request):
        from product.application_intelligence_providers import ProviderResponse
        return ProviderResponse(payload={"content_units": []})


def test_run_application_intelligence_persists_request_and_result(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    run_job_fit(conn, workspace_id, adapter, request_id="req_fit_5")

    saved = run_application_intelligence(
        conn, workspace_id, _FakeApplicationIntelligenceProvider(), request_id="req_ai_1"
    )
    assert saved["artifact_type"] == "application_intelligence_result"
    assert get_current_artifact(conn, workspace_id, "application_intelligence_request") is not None
    fingerprint_types = {
        row["upstream_artifact_type"]
        for row in conn.execute(
            "SELECT upstream_artifact_type FROM dependency_fingerprints WHERE artifact_id = ?",
            (saved["id"],),
        ).fetchall()
    }
    assert fingerprint_types == {
        "profile_snapshot", "job_fit_result", "application_intelligence_request"
    }
    request = get_current_artifact(conn, workspace_id, "application_intelligence_request")
    request_fingerprints = {
        row["upstream_artifact_type"]
        for row in conn.execute(
            "SELECT upstream_artifact_type FROM dependency_fingerprints WHERE artifact_id = ?",
            (request["id"],),
        ).fetchall()
    }
    assert request_fingerprints == {
        "profile_snapshot", "job_fit_result", "server:application_intelligence_policy",
        "server:application_intelligence_generation_contract",
    }
    policy_fingerprint = conn.execute(
        "SELECT upstream_content_id FROM dependency_fingerprints "
        "WHERE artifact_id=? AND upstream_artifact_type='server:application_intelligence_policy'",
        (request["id"],),
    ).fetchone()["upstream_content_id"]
    assert policy_fingerprint == content_identity(
        "aiintelpolicy_", request["payload"]["policy"]
    )
    generation_contract_fingerprint = conn.execute(
        "SELECT upstream_content_id FROM dependency_fingerprints "
        "WHERE artifact_id=? AND upstream_artifact_type='server:application_intelligence_generation_contract'",
        (request["id"],),
    ).fetchone()["upstream_content_id"]
    assert generation_contract_fingerprint == application_intelligence_generation_contract_identity()
    conn.close()


def test_run_application_intelligence_requires_job_fit_result(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    with pytest.raises(PipelineError):
        run_application_intelligence(
            conn, workspace_id, _FakeApplicationIntelligenceProvider(), request_id="req_ai_2"
        )
    conn.close()
