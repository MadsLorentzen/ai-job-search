"""job-fit-contract.v2: adds resolved_blocker_answers as a required v2
request field; v1 remains fully valid and unmodified (Phase 4C spec §6)."""

from __future__ import annotations

import pytest

from product.semantic_job_fit import (
    JOB_FIT_REQUEST_VERSION_V1,
    JOB_FIT_REQUEST_VERSION_V2,
    build_resolved_job_evidence_bundle,
    build_semantic_job_fit_request,
    validate_semantic_job_fit_request,
)
from tests.test_job_fit import job_snapshot, profile_snapshot

EMPTY_RESOLVED_BLOCKER_ANSWERS = {
    "schema_version": "resolved_blocker_answers.v1", "workspace_id": "ws_test", "answers": [],
}


def _resolved_job_evidence() -> dict:
    return build_resolved_job_evidence_bundle(job_snapshot())


def test_request_without_resolved_blocker_answers_stays_v1():
    request = build_semantic_job_fit_request(
        request_id="req_test00000000000000000",
        profile_snapshot=profile_snapshot(),
        job_snapshot=job_snapshot(),
        resolved_job_evidence=_resolved_job_evidence(),
    )
    assert request["schema_version"] == JOB_FIT_REQUEST_VERSION_V1
    validate_semantic_job_fit_request(request)  # must not raise


def test_request_with_resolved_blocker_answers_becomes_v2():
    request = build_semantic_job_fit_request(
        request_id="req_test00000000000000001",
        profile_snapshot=profile_snapshot(),
        job_snapshot=job_snapshot(),
        resolved_job_evidence=_resolved_job_evidence(),
        resolved_blocker_answers=EMPTY_RESOLVED_BLOCKER_ANSWERS,
    )
    assert request["schema_version"] == JOB_FIT_REQUEST_VERSION_V2
    assert request["resolved_blocker_answers"] == EMPTY_RESOLVED_BLOCKER_ANSWERS
    validate_semantic_job_fit_request(request)  # must not raise


def test_v2_request_missing_resolved_blocker_answers_key_is_invalid():
    request = build_semantic_job_fit_request(
        request_id="req_test00000000000000002",
        profile_snapshot=profile_snapshot(),
        job_snapshot=job_snapshot(),
        resolved_job_evidence=_resolved_job_evidence(),
        resolved_blocker_answers=EMPTY_RESOLVED_BLOCKER_ANSWERS,
    )
    del request["resolved_blocker_answers"]
    with pytest.raises(ValueError):
        validate_semantic_job_fit_request(request)
