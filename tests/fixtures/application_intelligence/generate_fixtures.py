#!/usr/bin/env python3
"""One-time generator for Ticket 8's Job Fit Result v1 fixtures.

Run manually with `python -m tests.fixtures.application_intelligence.generate_fixtures`
whenever these fixtures need to be regenerated (e.g. after a Ticket 7 contract
change). The output JSON is committed as a frozen fixture -- this script is not
executed by the test suite itself, only by a human/agent regenerating fixtures.

These fixtures are GENERATED, not hand-authored, specifically so they always
match Ticket 7's real analyze_semantic_job_fit output shape rather than a
maintainer's guess at that shape.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from product.semantic_job_fit import (
    analyze_semantic_job_fit,
    build_resolved_job_evidence_bundle,
    build_semantic_job_fit_request,
)

from tests.test_semantic_job_fit import (
    fully_scoring_policy,
    proposals_for_full_fit,
    ready_candidate,
    rich_profile,
    understanding_pair,
)

OUTPUT_DIR = Path(__file__).parent


def _base_bundle_and_profile() -> tuple[dict, dict, dict]:
    """Build one real, evidence-rich Ticket 7 request/result pair.

    Reuses tests/test_semantic_job_fit.py's own fixture-building helpers so
    this fixture is generated through the exact same path Ticket 7's own
    tests trust, not a separate reimplementation.
    """

    request_understanding, result_understanding = understanding_pair()
    job = request_understanding["job_snapshot"] if isinstance(request_understanding, dict) and "job_snapshot" in request_understanding else None
    # understanding_pair() takes job=None by default and builds its own job
    # snapshot internally via job_snapshot(); recover the actual job snapshot
    # used so the resolved evidence bundle is built against the same object.
    from tests.test_semantic_job_fit import job_snapshot as _job_snapshot_fixture
    job = _job_snapshot_fixture()

    bundle = build_resolved_job_evidence_bundle(job, request_understanding, result_understanding)
    profile = rich_profile()
    return job, bundle, profile


def _data_engineering_extension() -> dict:
    """Minimal valid Extension Package v0 supplying the transferable mapping
    the needs-review fixture's proposal cites (data-engineering-knowledge /
    map-pipelines-to-etl).

    Built inline rather than imported from another ticket's fixtures -- see
    product/extensions.py's validate_extension for the required shape. Uses
    `concept` (not `competency_id`) endpoints on the transferable mapping so
    no separate competency record is required. A non-empty `conditions` list
    is required to make Ticket 7's adjudication (_adjudicate_one_match in
    product/semantic_job_fit.py) mark the resulting match NEEDS_REVIEW rather
    than READY -- see that function's `if base["conditions"]:` branch.
    """

    return {
        "schema_version": "extension-package.v0",
        "id": "data-engineering-knowledge",
        "name": "Data Engineering Knowledge",
        "version": "0.1.0",
        "status": "reviewed",
        "description": "Reusable professional knowledge describing how data pipeline work maps to formal ETL engineering competencies.",
        "publisher": {
            "name": "Fixture Publisher",
            "type": "organization",
        },
        "trust": {
            "level": "community-reviewed",
        },
        "metadata": {
            "created_date": "2026-01-01",
        },
        "scope": {
            "professions": ["data engineering"],
        },
        "transferable_mappings": [
            {
                "id": "map-pipelines-to-etl",
                "source": {"concept": "data pipeline building"},
                "target": {"concept": "ETL engineering"},
                "rationale": "Building reliable data pipelines is functionally the same discipline as ETL engineering: both involve extracting, transforming, and loading data reliably at scale.",
                "transfer_strength": "strong",
                "conditions": ["Requires evidence of supervisory scope."],
                "limitations": ["Does not cover formal data warehousing certification requirements."],
            },
        ],
    }


def build_ready_result() -> dict:
    job, bundle, profile = _base_bundle_and_profile()
    proposals = proposals_for_full_fit(bundle)
    request = build_semantic_job_fit_request(
        request_id="appintel-fixture-ready",
        profile_snapshot=profile,
        job_snapshot=job,
        resolved_job_evidence=bundle,
        semantic_fit_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"},
        semantic_proposals=proposals,
    )
    return analyze_semantic_job_fit(request)


def build_blocked_result() -> dict:
    job, bundle, profile = _base_bundle_and_profile()
    # No eligibility/language/location_logistics gate proposals supplied at all
    # -> every gate defaults to UNVERIFIED -> not a hard FAIL block by default
    # in Ticket 7's gate policy, so force an explicit FAIL gate proposal with
    # supporting evidence to produce a genuinely blocked result.
    work_id = next(
        item["id"] for item in bundle["evidence"]
        if item["text"] == "Applicants must already have the right to work in the UK."
    )
    proposals = {
        "matches": [],
        "gates": [
            {
                "gate_id": "eligibility",
                "status": "FAIL",
                "reason": "Candidate lacks the required right-to-work evidence.",
                "job_evidence_ids": [work_id],
                "profile_evidence_ids": ["clm_4444444444444444"],
            },
        ],
    }
    request = build_semantic_job_fit_request(
        request_id="appintel-fixture-blocked",
        profile_snapshot=profile,
        job_snapshot=job,
        resolved_job_evidence=bundle,
        semantic_fit_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"},
        semantic_proposals=proposals,
    )
    return analyze_semantic_job_fit(request)


def build_needs_review_result() -> dict:
    job, bundle, profile = _base_bundle_and_profile()
    pipeline_id = next(
        item["id"] for item in bundle["evidence"]
        if item["text"] == "Build reliable data pipelines."
    )
    proposals = {
        "matches": [
            {
                "proposal_id": "sem-pipelines-transfer",
                "job_evidence_id": pipeline_id,
                "profile_evidence_ids": ["clm_2222222222222222"],
                "classification": "transferable",
                "rationale": "Pipeline building responsibility transfers via extension mapping.",
                "confidence": "medium",
                "extension_ref": {
                    "extension_id": "data-engineering-knowledge",
                    "extension_version": "0.1.0",
                    "record_type": "transferable_mapping",
                    "record_id": "map-pipelines-to-etl",
                },
            },
        ],
        "gates": [],
    }
    request = build_semantic_job_fit_request(
        request_id="appintel-fixture-needs-review",
        profile_snapshot=profile,
        job_snapshot=job,
        resolved_job_evidence=bundle,
        semantic_fit_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"},
        semantic_proposals=proposals,
        active_extensions=[_data_engineering_extension()],
    )
    return analyze_semantic_job_fit(request)


def main() -> None:
    for name, builder in (
        ("job-fit-result-ready.json", build_ready_result),
        ("job-fit-result-blocked.json", build_blocked_result),
        ("job-fit-result-needs-review.json", build_needs_review_result),
    ):
        result = builder()
        (OUTPUT_DIR / name).write_text(
            json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {name}: status={result['status']!r} blocked={result['blocked']!r} verdict={result.get('verdict')!r}")


if __name__ == "__main__":
    main()
