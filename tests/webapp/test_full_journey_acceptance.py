"""Integrated acceptance tests for the Ticket 9 web product workflow.

These tests cross the HTTP, persistence, orchestration, and validated product
contracts.  They intentionally use deterministic providers and synthetic data;
the real-browser journey remains the separate Task 16 gate.
"""
from __future__ import annotations

import copy
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from product.application_intelligence_providers import DeterministicFakeProvider as AIFake
from product.job_fit import profile_snapshot_content_id
from product.job_understanding_providers import DeterministicFakeProvider as UnderstandingFake
from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import get_artifact, get_current_artifact, save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, ensure_profile_workspace
from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter
from webapp.services.semantic_proposer_errors import SemanticProposerProviderError
from webapp.services.staleness import check_staleness

from tests.webapp.fixtures.acceptance.fixtures import (
    extension,
    full_fit_proposals,
    provider_candidate,
    ready_content_unit,
    rich_profile,
    source_record,
    transferable_proposal,
    unsupported_content_unit,
)


PROFILE_ROOT = Path(__file__).parent / "fixtures" / "webapp_profile_root"


class _FailingSemanticAdapter:
    def propose(self, **kwargs):
        raise SemanticProposerProviderError("synthetic semantic provider failure")


def _settings(tmp_path: Path, *, profile_root: Path | None = None) -> Settings:
    return Settings(
        db_path=tmp_path / "jobsearch.sqlite3",
        profile_root=str(profile_root or PROFILE_ROOT),
        extensions_dir=tmp_path / "extensions",
        documents_root=tmp_path / "documents",
    )


def _install_extension(settings: Settings, *, conditional: bool = True) -> None:
    target = settings.extensions_dir / "data-transfer"
    target.mkdir(parents=True, exist_ok=True)
    (target / "extension.json").write_text(
        json.dumps(extension(conditional=conditional)), encoding="utf-8"
    )


def _install_profile(settings: Settings, payload: dict | None = None) -> dict:
    profile = copy.deepcopy(payload or rich_profile())
    conn = connect(settings.db_path)
    ensure_profile_workspace(conn)
    artifact = save_artifact(
        conn,
        workspace_id=PROFILE_WORKSPACE_ID,
        artifact_type="profile_snapshot",
        payload=profile,
        content_id=profile_snapshot_content_id(profile),
    )
    conn.close()
    return artifact


def _create_workspace(client: TestClient) -> str:
    response = client.post(
        "/api/workspaces",
        json={
            "company": "München Evidence Labs",
            "title": "Data Engineer",
            "source_record": source_record(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["workspace"]["id"]


def _review(client: TestClient, workspace_id: str) -> dict:
    response = client.get(f"/api/workspaces/{workspace_id}/review")
    assert response.status_code == 200, response.text
    return response.json()


def _post_decision(
    client: TestClient,
    workspace_id: str,
    *,
    source_artifact_id: str,
    item_type: str,
    item_id: str,
    disposition: str = "acknowledged_and_proceed",
) -> None:
    response = client.post(
        f"/api/workspaces/{workspace_id}/review-decisions",
        json={
            "review_item_type": item_type,
            "source_artifact_id": source_artifact_id,
            "domain_item_id": item_id,
            "disposition": disposition,
            "note": f"Acceptance disposition for {item_id}",
        },
    )
    assert response.status_code == 201, response.text


def _decide_current_review_surface(client: TestClient, workspace_id: str) -> dict:
    view = _review(client, workspace_id)
    fit_artifact = view["job_fit_result"]
    fit = fit_artifact["payload"]
    for gate in fit.get("gate_assessments", []):
        if gate.get("status") in {"FLAG", "UNVERIFIED"}:
            _post_decision(
                client, workspace_id, source_artifact_id=fit_artifact["id"],
                item_type="gate_flag", item_id=f"gate:{gate['gate_id']}",
            )
    for question in fit.get("human_judgment_questions", []):
        _post_decision(
            client, workspace_id, source_artifact_id=fit_artifact["id"],
            item_type="human_judgment_question", item_id=question["question_id"],
        )
    for collection, item_type in (
        ("functionally_equivalent_matches", "functionally_equivalent_match"),
        ("transferable_matches", "transferable_match"),
    ):
        for match in fit.get(collection, []):
            _post_decision(
                client, workspace_id, source_artifact_id=fit_artifact["id"],
                item_type=item_type, item_id=match["match_id"],
            )

    intelligence_artifact = view["application_intelligence_result"]
    intelligence = intelligence_artifact["payload"]
    for collection in ("cv_content", "cover_letter_content"):
        for unit in intelligence.get(collection, []):
            _post_decision(
                client, workspace_id, source_artifact_id=intelligence_artifact["id"],
                item_type="content_unit", item_id=unit["unit_id"],
            )
    return view


def _build_chain(
    tmp_path: Path,
    *,
    ai_units: list[dict] | None = None,
    conditional_extension: bool = True,
    include_transfer: bool = True,
):
    settings = _settings(tmp_path)
    _install_extension(settings, conditional=conditional_extension)
    app = create_app(settings)
    app.state.job_understanding_provider = UnderstandingFake(provider_candidate())
    app.state.semantic_adapter = FakeSemanticProposalAdapter(
        canned_response={"matches": [], "gates": []}
    )
    app.state.application_intelligence_provider = AIFake(
        {"content_units": copy.deepcopy(ai_units or [])}
    )
    client = TestClient(app)
    client.__enter__()
    _install_profile(settings)
    workspace_id = _create_workspace(client)

    understood = client.post(
        f"/api/workspaces/{workspace_id}/understand", json={"request_id": "understand-1"}
    )
    assert understood.status_code == 200, understood.text
    discovered = client.post(
        f"/api/workspaces/{workspace_id}/fit",
        json={"request_id": "fit-discovery", "extension_ids": ["data-transfer"]},
    )
    assert discovered.status_code == 200, discovered.text
    bundle = _review(client, workspace_id)["resolved_job_evidence"]["payload"]
    proposals = full_fit_proposals(bundle)
    if include_transfer:
        transfer_target_id = next(
            item["id"] for item in bundle["evidence"]
            if item["text"] == "German would be an advantage."
        )
        proposals["matches"].append(transferable_proposal(transfer_target_id))
    app.state.semantic_adapter = FakeSemanticProposalAdapter(canned_response=proposals)
    fitted = client.post(
        f"/api/workspaces/{workspace_id}/fit",
        json={"request_id": "fit-final", "extension_ids": ["data-transfer"]},
    )
    assert fitted.status_code == 200, fitted.text
    intelligence = client.post(
        f"/api/workspaces/{workspace_id}/application-intelligence",
        json={"request_id": "intelligence-1"},
    )
    assert intelligence.status_code == 200, intelligence.text
    return client, app, settings, workspace_id


def _close(client: TestClient) -> None:
    client.__exit__(None, None, None)


def test_real_ticket7_and_8_chain_surfaces_direct_functional_transferable_and_review(tmp_path):
    client, _, _, workspace_id = _build_chain(
        tmp_path, ai_units=[ready_content_unit()], conditional_extension=True
    )
    try:
        view = _review(client, workspace_id)
        fit = view["job_fit_result"]["payload"]
        assert len(fit["direct_matches"]) == 1
        functional = fit["functionally_equivalent_matches"][0]
        assert functional["functional_basis"]["title_similarity_only"] is False
        assert functional["profile_evidence_ids"] and functional["job_requirement_ids"]
        transferable = fit["transferable_matches"][0]
        assert transferable["status"] == "NEEDS_REVIEW"
        assert transferable["conditions"] == ["Candidate evidence exists"]
        assert transferable["limitations"] == ["Does not prove employment history"]
        assert transferable["profile_evidence_ids"] and transferable["job_requirement_ids"]
        assert fit["overall_score"] is None and fit["verdict"] is None
        assert any(item["status"] == "NEEDS_REVIEW" for item in fit["dimension_assessments"])
        assert fit["human_judgment_questions"]

        intelligence = view["application_intelligence_result"]["payload"]
        assert intelligence["cv_content"][0]["status"] == "READY"
        _decide_current_review_surface(client, workspace_id)
        pack = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-20"},
        )
        assert pack.status_code == 201, pack.text
    finally:
        _close(client)


def test_affirmative_blocking_gate_nulls_score_and_verdict(tmp_path):
    client, app, _, workspace_id = _build_chain(tmp_path, include_transfer=False)
    try:
        bundle = _review(client, workspace_id)["resolved_job_evidence"]["payload"]
        proposals = full_fit_proposals(bundle)
        proposals["gates"][0]["status"] = "FAIL"
        proposals["gates"][0]["reason"] = "Affirmative incompatibility evidence."
        app.state.semantic_adapter = FakeSemanticProposalAdapter(canned_response=proposals)
        response = client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={"request_id": "fit-blocked", "extension_ids": ["data-transfer"]},
        )
        assert response.status_code == 200, response.text
        result = response.json()["artifact"]["payload"]
        assert result["blocked"] is True
        assert result["blocking_gate_ids"] == ["eligibility"]
        assert result["overall_score"] is None and result["verdict"] is None
        gate = next(item for item in result["gate_assessments"] if item["gate_id"] == "eligibility")
        assert gate["job_evidence_ids"] and gate["profile_evidence_ids"]
    finally:
        _close(client)


def test_needs_review_content_requires_explicit_current_artifact_disposition(tmp_path):
    needs_review = ready_content_unit("cv-needs-review")
    needs_review["atoms"].append(unsupported_content_unit()["atoms"][0])
    client, _, _, workspace_id = _build_chain(tmp_path, ai_units=[needs_review])
    try:
        view = _decide_current_review_surface(client, workspace_id)
        intelligence = view["application_intelligence_result"]["payload"]
        assert intelligence["cv_content"][0]["status"] == "NEEDS_REVIEW"
        pack = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-20"},
        )
        assert pack.status_code == 201, pack.text
        payload = pack.json()["pack"]
        assert payload["cv_content"][0]["unit_id"] == "cv-needs-review"
        assert payload["review_record"]["decisions_consulted"]
    finally:
        _close(client)


def test_unsupported_application_content_is_audit_only_and_never_enters_pack(tmp_path):
    client, _, _, workspace_id = _build_chain(
        tmp_path, ai_units=[ready_content_unit(), unsupported_content_unit()]
    )
    try:
        view = _decide_current_review_surface(client, workspace_id)
        intelligence = view["application_intelligence_result"]["payload"]
        assert intelligence["unsupported_claims"]
        pack = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-20"},
        )
        assert pack.status_code == 201, pack.text
        payload = pack.json()["pack"]
        assert all(unit["unit_id"] != "cv-unsupported" for unit in payload["cv_content"])
        audit = payload["review_record"]["informational_items"]
        assert audit["application_intelligence_unsupported_claims"]
    finally:
        _close(client)


def test_global_profile_refresh_genuinely_stales_fit_and_blocks_pack(tmp_path):
    mutable_root = tmp_path / "profile-root"
    shutil.copytree(PROFILE_ROOT, mutable_root)
    settings = _settings(tmp_path, profile_root=mutable_root)
    _install_extension(settings)
    app = create_app(settings)
    app.state.semantic_adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    app.state.application_intelligence_provider = AIFake({"content_units": []})
    with TestClient(app) as client:
        assert client.post("/api/profile/refresh").status_code == 200
        workspace_id = _create_workspace(client)
        assert client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={"request_id": "fit-profile-a", "extension_ids": []},
        ).status_code == 200
        assert client.post(
            f"/api/workspaces/{workspace_id}/application-intelligence",
            json={"request_id": "ai-profile-a"},
        ).status_code == 200
        profile_file = mutable_root / ".claude/skills/job-application-assistant/01-candidate-profile.md"
        profile_file.write_text(
            profile_file.read_text(encoding="utf-8")
            + "\n2. Synthetic Author (2026). New acceptance publication.\n",
            encoding="utf-8",
        )
        assert client.post("/api/profile/refresh").status_code == 200
        conn = connect(settings.db_path)
        assert check_staleness(conn, workspace_id, "job_fit_result")["stale"] is True
        assert check_staleness(conn, workspace_id, "application_intelligence_result")["stale"] is True
        conn.close()
        rejected = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-20"},
        )
        assert rejected.status_code == 400
        assert "stale" in rejected.json()["detail"]


def test_job_and_understanding_changes_stale_the_entire_downstream_chain(tmp_path):
    client, app, settings, workspace_id = _build_chain(tmp_path)
    try:
        rerun = client.post(
            f"/api/workspaces/{workspace_id}/understand",
            json={"request_id": "understand-2"},
        )
        assert rerun.status_code == 200, rerun.text
        conn = connect(settings.db_path)
        assert check_staleness(conn, workspace_id, "resolved_job_evidence")["stale"] is True
        assert check_staleness(conn, workspace_id, "job_fit_result")["stale"] is True
        assert check_staleness(conn, workspace_id, "application_intelligence_result")["stale"] is True
        current_job = get_current_artifact(conn, workspace_id, "job_posting_snapshot")
        changed_job = copy.deepcopy(current_job["payload"])
        changed_job["description"] += " Updated source evidence."
        save_artifact(
            conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
            payload=changed_job, content_id="jobsnap_acceptance_changed",
        )
        assert check_staleness(conn, workspace_id, "job_understanding_result")["stale"] is True
        conn.close()
    finally:
        _close(client)


def test_failed_rerun_restores_every_previous_successful_current_pointer(tmp_path):
    client, app, settings, workspace_id = _build_chain(tmp_path)
    try:
        conn = connect(settings.db_path)
        before = {
            row["artifact_type"]: row["artifact_id"]
            for row in conn.execute(
                "SELECT artifact_type, artifact_id FROM current_artifacts WHERE workspace_id=?",
                (workspace_id,),
            ).fetchall()
        }
        conn.close()
        app.state.semantic_adapter = _FailingSemanticAdapter()
        response = client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={"request_id": "fit-fails", "extension_ids": ["data-transfer"]},
        )
        assert response.status_code == 400
        conn = connect(settings.db_path)
        after = {
            row["artifact_type"]: row["artifact_id"]
            for row in conn.execute(
                "SELECT artifact_type, artifact_id FROM current_artifacts WHERE workspace_id=?",
                (workspace_id,),
            ).fetchall()
        }
        conn.close()
        assert after == before
    finally:
        _close(client)


def test_superseded_intelligence_decision_cannot_authorize_current_content(tmp_path):
    client, _, _, workspace_id = _build_chain(tmp_path, ai_units=[ready_content_unit()])
    try:
        _decide_current_review_surface(client, workspace_id)
        rerun = client.post(
            f"/api/workspaces/{workspace_id}/application-intelligence",
            json={"request_id": "intelligence-2"},
        )
        assert rerun.status_code == 200, rerun.text
        response = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-20"},
        )
        assert response.status_code == 400
        assert "content_unit:cv-ready" in response.json()["detail"]
    finally:
        _close(client)


def test_missing_required_dependency_fingerprint_fails_safe(tmp_path):
    client, _, settings, workspace_id = _build_chain(tmp_path)
    try:
        _decide_current_review_surface(client, workspace_id)
        view = _review(client, workspace_id)
        conn = connect(settings.db_path)
        conn.execute(
            "DELETE FROM dependency_fingerprints WHERE artifact_id=? AND upstream_artifact_type='profile_snapshot'",
            (view["application_intelligence_result"]["id"],),
        )
        conn.commit()
        conn.close()
        response = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-20"},
        )
        assert response.status_code == 400
        assert "required fingerprint 'profile_snapshot' is missing" in response.json()["detail"]
    finally:
        _close(client)


def test_pack_a_pack_b_are_immutable_and_applied_binds_exact_current_pack_b(tmp_path):
    client, _, settings, workspace_id = _build_chain(
        tmp_path, ai_units=[ready_content_unit()], conditional_extension=False,
    )
    try:
        _decide_current_review_surface(client, workspace_id)
        before_gate4 = client.get(f"/api/workspaces/{workspace_id}").json()["workspace"]
        assert before_gate4["workflow_status"] is None
        pack_a = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-20"},
        )
        assert pack_a.status_code == 201, pack_a.text
        pack_b = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-21"},
        )
        assert pack_b.status_code == 201, pack_b.text
        a_id = pack_a.json()["artifact"]["id"]
        b_id = pack_b.json()["artifact"]["id"]
        assert a_id != b_id
        a_payload = copy.deepcopy(pack_a.json()["pack"])
        b_payload = copy.deepcopy(pack_b.json()["pack"])

        applied = client.patch(
            f"/api/workspaces/{workspace_id}/status",
            json={"new_status": "applied", "effective_date": "2026-08-22"},
        )
        assert applied.status_code == 200, applied.text
        events = client.get(f"/api/workspaces/{workspace_id}/events").json()["events"]
        applied_event = next(event for event in events if event["new_status"] == "applied")
        assert applied_event["submitted_pack_artifact_id"] == b_id
        conn = connect(settings.db_path)
        assert get_artifact(conn, a_id)["payload"] == a_payload
        assert get_artifact(conn, b_id)["payload"] == b_payload
        conn.close()
        refused = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-23"},
        )
        assert refused.status_code == 400
    finally:
        _close(client)


def test_generation_and_review_do_not_imply_submission_or_applied(tmp_path):
    client, _, _, workspace_id = _build_chain(tmp_path, ai_units=[ready_content_unit()])
    try:
        _decide_current_review_surface(client, workspace_id)
        workspace = client.get(f"/api/workspaces/{workspace_id}").json()["workspace"]
        assert workspace["workflow_status"] is None
        assert not any(
            event["new_status"] == "applied"
            for event in client.get(f"/api/workspaces/{workspace_id}/events").json()["events"]
        )
    finally:
        _close(client)


@pytest.mark.parametrize("stage,body", [
    ("understand", {"request_id": "u"}),
    ("fit", {"request_id": "f", "extension_ids": []}),
    ("application-intelligence", {"request_id": "a"}),
])
def test_profile_pseudo_workspace_is_never_a_job_workflow_target(tmp_path, stage, body):
    settings = _settings(tmp_path)
    app = create_app(settings)
    app.state.job_understanding_provider = UnderstandingFake(provider_candidate())
    app.state.semantic_adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    app.state.application_intelligence_provider = AIFake({"content_units": []})
    with TestClient(app) as client:
        _install_profile(settings)
        assert client.post(f"/api/workspaces/profile/{stage}", json=body).status_code == 404


@pytest.mark.parametrize("field", ["extension_paths", "extension_path", "path", "paths"])
def test_extension_paths_cannot_cross_http_boundary(tmp_path, field):
    settings = _settings(tmp_path)
    app = create_app(settings)
    app.state.semantic_adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    with TestClient(app) as client:
        _install_profile(settings)
        workspace_id = _create_workspace(client)
        response = client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={"request_id": "fit-path-rejected", "extension_ids": [], field: ["C:/private/ext.json"]},
        )
        assert response.status_code == 422
        public = client.get("/api/extensions")
        assert public.status_code == 200
        assert "path" not in public.text
