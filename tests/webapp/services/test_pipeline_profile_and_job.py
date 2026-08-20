from pathlib import Path

import pytest

from webapp.persistence.db import init_db, connect
from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID
from webapp.services.pipeline import (
    refresh_profile,
    get_current_profile_snapshot,
    create_job_from_source_record,
    run_job_understanding,
    PipelineError,
)

FIXTURE_PROFILE_ROOT = Path(__file__).parents[1] / "fixtures" / "webapp_profile_root"


def _conn(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    return connect(db_path)


def test_refresh_profile_saves_under_the_global_profile_workspace(tmp_path):
    conn = _conn(tmp_path)
    saved = refresh_profile(conn, root=str(FIXTURE_PROFILE_ROOT))
    assert saved["workspace_id"] == PROFILE_WORKSPACE_ID
    assert saved["content_id"].startswith("profilesnap_")
    current = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    assert current["id"] == saved["id"]
    conn.close()


def test_job_workspace_reads_the_same_global_profile_snapshot(tmp_path):
    conn = _conn(tmp_path)
    refresh_profile(conn, root=str(FIXTURE_PROFILE_ROOT))
    created = create_job_from_source_record(
        conn, company="Acme", title="Backend Engineer",
        source_record={"schema_version": "job-source-record.v0", "source": "manual",
                        "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer"},
    )
    # the job workspace itself never stores its own profile_snapshot artifact —
    # the global lookup is what pipeline stages must use
    assert get_current_artifact(conn, created["workspace"]["id"], "profile_snapshot") is None
    snapshot = get_current_profile_snapshot(conn)
    assert snapshot["content_id"].startswith("profilesnap_")
    conn.close()


def test_create_job_from_source_record_creates_job_kind_workspace_only(tmp_path):
    conn = _conn(tmp_path)
    result = create_job_from_source_record(
        conn, company="Acme", title="Backend Engineer",
        source_record={"schema_version": "job-source-record.v0", "source": "manual",
                        "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer",
                        "requirements": [{"text": "5 years Python", "kind": "required"}]},
    )
    assert result["workspace"]["kind"] == "job"
    assert result["workspace"]["id"] != PROFILE_WORKSPACE_ID
    assert result["artifact"]["artifact_type"] == "job_posting_snapshot"
    assert result["artifact"]["content_id"].startswith("jobsnap_")
    conn.close()


def test_invalid_source_record_leaves_no_orphan_workspace(tmp_path):
    conn = _conn(tmp_path)
    with pytest.raises(PipelineError, match="job ingestion failed"):
        create_job_from_source_record(
            conn, company="Acme", title="Broken",
            source_record={"schema_version": "wrong-version"},
        )
    assert conn.execute("SELECT COUNT(*) FROM workspaces WHERE kind='job'").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 0


class _FakeJobUnderstandingProvider:
    provider_id = "fake"
    model_id = "fake-model"
    model_version = "fake-model-v0"

    def extract(self, request):
        from product.job_understanding_providers import ProviderResponse
        return ProviderResponse(payload={
            "schema_version": "job-understanding-candidate.v0", "items": [],
            "suggestions": [], "ambiguous_statements": [], "warnings": [],
        })


def test_run_job_understanding_persists_both_request_and_result(tmp_path):
    conn = _conn(tmp_path)
    created = create_job_from_source_record(
        conn, company="Acme", title="Backend Engineer",
        source_record={"schema_version": "job-source-record.v0", "source": "manual",
                        "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer",
                        "requirements": [{"text": "5 years Python", "kind": "required"}]},
    )
    workspace_id = created["workspace"]["id"]

    saved_result = run_job_understanding(conn, workspace_id, _FakeJobUnderstandingProvider(), request_id="req_test_1")

    assert saved_result["artifact_type"] == "job_understanding_result"
    saved_request = get_current_artifact(conn, workspace_id, "job_understanding_request")
    assert saved_request is not None
    assert saved_request["payload"]["request_id"] == "req_test_1"
    conn.close()


def test_run_job_understanding_without_job_snapshot_raises_pipeline_error(tmp_path):
    conn = _conn(tmp_path)
    from webapp.persistence.workspaces import create_workspace
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    with pytest.raises(PipelineError):
        run_job_understanding(conn, ws["id"], _FakeJobUnderstandingProvider(), request_id="req_test_2")
    conn.close()


class _FailingProvider:
    provider_id = "fake"; model_id = "fake-model"; model_version = "fake-model-v0"

    def extract(self, request):
        from product.job_understanding_providers import JobUnderstandingProviderError
        raise JobUnderstandingProviderError("simulated provider outage")


def test_provider_failure_raises_pipeline_error_and_leaves_no_new_artifact(tmp_path):
    conn = _conn(tmp_path)
    created = create_job_from_source_record(
        conn, company="Acme", title="Backend Engineer",
        source_record={"schema_version": "job-source-record.v0", "source": "manual",
                        "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer",
                        # description required so build_job_understanding_request selects a
                        # non-null source; otherwise extraction short-circuits to an
                        # UNAVAILABLE result without ever calling the provider, and this
                        # test would not actually exercise the provider-failure path.
                        "description": "We need someone with 5 years of Python experience."},
    )
    workspace_id = created["workspace"]["id"]

    with pytest.raises(PipelineError):
        run_job_understanding(conn, workspace_id, _FailingProvider(), request_id="req_test_3")

    # no partial/fabricated result was persisted
    assert get_current_artifact(conn, workspace_id, "job_understanding_result") is None
    conn.close()
