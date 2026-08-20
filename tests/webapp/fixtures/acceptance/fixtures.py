"""Adapters over the real Ticket 7/8 fixtures used by product tests.

The acceptance suite deliberately imports the established fixture builders and
then runs the owning validators.  Production code never imports this module.
"""
from __future__ import annotations

import copy

from product.extensions import validate_extension
from product.job_posting import validate_job_posting_snapshot
from product.profile_snapshot import validate_snapshot
from tests.test_job_fit import extension as _extension
from tests.test_semantic_job_fit import (
    job_snapshot as _job_snapshot,
    proposals_for_full_fit,
    ready_candidate as _ready_candidate,
    rich_profile as _rich_profile,
)


def rich_profile() -> dict:
    value = copy.deepcopy(_rich_profile())
    validate_snapshot(value)
    return value


def job_snapshot() -> dict:
    value = copy.deepcopy(_job_snapshot())
    validate_job_posting_snapshot(value)
    return value


def extension(*, conditional: bool = True) -> dict:
    value = copy.deepcopy(_extension())
    if not conditional:
        value["transferable_mappings"][0]["conditions"] = []
    validate_extension(value)
    return value


def provider_candidate() -> dict:
    return copy.deepcopy(_ready_candidate())


def source_record() -> dict:
    job = job_snapshot()
    record = {
        "schema_version": "job-source-record.v0",
        "source": job["source"],
        "captured_at": job["captured_at"],
        "company": job["company"],
        "title": job["title"],
        "description": job["description"],
        "raw_text": job["raw_text"],
        "requirements": [
            {"text": item["text"], "kind": item["kind"]}
            for item in job["requirements"]
        ],
        "responsibilities": [],
        "language_requirements": [],
        "eligibility_requirements": [],
        "logistics_requirements": [],
        "metadata": {"acceptance_fixture": True},
    }
    for field in ("source_url", "location", "employment_type"):
        if job.get(field):
            record[field] = job[field]
    return record


def full_fit_proposals(bundle: dict) -> dict:
    """Use Ticket 7's proven direct/functional/gate proposal builder."""
    value = copy.deepcopy(proposals_for_full_fit(bundle))
    python_id = next(
        item["id"] for item in bundle["evidence"]
        if item["text"] == "Python is required."
    )
    value["matches"][0]["job_evidence_id"] = python_id
    return value


def transferable_proposal(job_evidence_id: str) -> dict:
    return {
        "proposal_id": "sem-transfer-acceptance",
        "job_evidence_id": job_evidence_id,
        "profile_evidence_ids": ["clm_2222222222222222"],
        "classification": "transferable",
        "rationale": "The active reviewed mapping supports bounded transferability.",
        "confidence": "medium",
        "extension_ref": {
            "extension_id": "data-transfer",
            "extension_version": "0.1.0",
            "record_type": "transferable_mapping",
            "record_id": "field-models-to-pipelines",
        },
    }


def ready_content_unit(unit_id: str = "cv-ready") -> dict:
    return {
        "unit_id": unit_id,
        "unit_type": "cv_bullet",
        "atoms": [{
            "atom_id": f"atom-{unit_id}",
            "atom_kind": "candidate_fact",
            "assertion_type": "technical_skill",
            "profile_evidence_ids": ["clm_1111111111111111"],
            "rendering_variant": "PLAIN",
        }],
        "connectives": [],
    }


def unsupported_content_unit(unit_id: str = "cv-unsupported") -> dict:
    return {
        "unit_id": unit_id,
        "unit_type": "cv_bullet",
        "atoms": [{
            "atom_id": f"atom-{unit_id}",
            "atom_kind": "candidate_fact",
            "assertion_type": "certification",
            "profile_evidence_ids": ["clm_9999999999999999"],
            "rendering_variant": "PLAIN",
        }],
        "connectives": [],
    }
