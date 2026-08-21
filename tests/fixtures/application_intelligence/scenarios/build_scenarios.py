#!/usr/bin/env python3
"""Generator for Lane B's five scenario fixtures (strong/sparse/transferable/
gaps/conflicting evidence). Run manually with
`python -m tests.fixtures.application_intelligence.scenarios.build_scenarios`
whenever these fixtures need regenerating. Not executed by the test suite.

Each fixture is GENERATED through the real Ticket 7 analyze_semantic_job_fit
path (reusing tests/fixtures/application_intelligence/generate_fixtures.py's
own helpers), so it always matches Ticket 7's real output shape.

The conflicting_evidence scenario's profile_snapshot["conflicts"] entry shape
was confirmed by inspecting product/profile_snapshot.py's _group_claims (real
conflict construction) and validate_snapshot (the shape it enforces) rather
than guessed -- see task-10-report.md for the inspection notes. A snapshot-
level conflict entry is:
    {
        "id": "con_<16 hex>",
        "concept_id": "cpt_<16 hex>",
        "category": <str>,
        "field": <str>,
        "variants": [
            {"value": ..., "claim_ids": [...], "provenance": [<source location>, ...]},
            ...  # >= 2 variants, each a distinct normalized value
        ],
    }
Every claim_id referenced by a variant must itself carry the same concept_id/
category/field as the group, and its (normalized) value must match that
variant's value -- validate_snapshot enforces this cross-referencing exactly.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from product.profile_snapshot import validate_snapshot
from product.semantic_job_fit import (
    analyze_semantic_job_fit,
    build_resolved_job_evidence_bundle,
    build_semantic_job_fit_request,
)

from tests.fixtures.application_intelligence.generate_fixtures import _base_bundle_and_profile
from tests.test_semantic_job_fit import claim, fully_scoring_policy, proposals_for_full_fit

OUTPUT_DIR = Path(__file__).parent


def build_strong_evidence() -> dict:
    """Strong-evidence scenario: the same real direct+functional matches as
    _base_bundle_and_profile()'s Ticket 7 path, PLUS additional real,
    non-placeholder profile claims that are not cited by any match.

    _base_bundle_and_profile()'s rich_profile() supplies only terse claim
    values (e.g. "Python", "Built production data pipelines", "Synthetic
    MSc") -- realistic as discrete extracted facts, but genuinely too few
    words in total (7, across every renderable claim) to represent a
    "strong evidence" candidate against Ticket 8's real
    substantive-completion contract (MIN_CV_WORDS=20,
    MIN_COVER_LETTER_WORDS=40). Task 11 confirmed this empirically: even a
    proposal helper that cites every single renderable claim in the base
    rich_profile() tops out at 7 CV words.

    These extra claims are additional genuine evidence in the same shape
    Ticket 7's own test fixtures already use (test_semantic_job_fit.py's
    `claim()` helper) -- explicit, non-placeholder, high-confidence
    employment/skill facts a real candidate profile would plausibly
    contain alongside the base rich_profile() claims. They are not cited
    by any Ticket 7 match (job_requirement_ids stay exactly as
    proposals_for_full_fit() defines them) so requirement_coverage is
    unaffected -- they exist purely to give a genuinely evidence-rich
    candidate enough real material to clear the contract, the same way a
    real candidate with more than two profile facts would.
    """
    job, bundle, profile = _base_bundle_and_profile()
    extra_claims = [
        claim(
            "clm_8888888888888888", "employment", "responsibility_or_achievement",
            "Led a team of four engineers to migrate a legacy batch system onto a "
            "cloud-native streaming architecture, cutting data latency from hours to minutes",
        ),
        claim(
            "clm_9999999999999999", "employment", "responsibility_or_achievement",
            "Designed and operated CI/CD pipelines that reduced deployment failures by half "
            "across three production services",
        ),
        claim("clm_aaaaaaaaaaaaaaaa", "skills", "technical_skill", "SQL"),
        claim("clm_bbbbbbbbbbbbbbbb", "certifications", "certification", "AWS Certified Data Engineer"),
    ]
    profile = copy.deepcopy(profile)
    profile["claims"].extend(extra_claims)
    profile["summary"]["claim_count"] = len(profile["claims"])
    validate_snapshot(profile)  # must still be a structurally valid snapshot
    proposals = proposals_for_full_fit(bundle)
    request = build_semantic_job_fit_request(
        request_id="laneb-strong-evidence", profile_snapshot=profile, job_snapshot=job,
        resolved_job_evidence=bundle, semantic_fit_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"}, semantic_proposals=proposals,
    )
    result = analyze_semantic_job_fit(request)
    return {"profile_snapshot": profile, "job_fit_result": result, "resolved_job_evidence": bundle}


def build_sparse_evidence() -> dict:
    # Thin profile: reuse the same job/bundle, but strip profile claims down to
    # a single technical_skill claim so Ticket 7 can find at most one match.
    job, bundle, profile = _base_bundle_and_profile()
    thin_profile = copy.deepcopy(profile)
    first_claim = next(c for c in thin_profile["claims"] if c["category"] == "skills")
    thin_profile["claims"] = [first_claim]
    thin_profile["corroborations"] = []
    thin_profile["conflicts"] = []
    thin_profile["summary"] = {
        "source_count": len(thin_profile["sources"]),
        "claim_count": len(thin_profile["claims"]),
        "placeholder_claim_count": sum(1 for c in thin_profile["claims"] if c["placeholder"]),
        "corroboration_count": 0,
        "conflict_count": 0,
    }
    validate_snapshot(thin_profile)  # must still be a structurally valid snapshot
    proposals = {"matches": [], "gates": []}
    request = build_semantic_job_fit_request(
        request_id="laneb-sparse-evidence", profile_snapshot=thin_profile, job_snapshot=job,
        resolved_job_evidence=bundle, semantic_fit_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"}, semantic_proposals=proposals,
    )
    result = analyze_semantic_job_fit(request)
    assert len(thin_profile["claims"]) == 1, "expected sparse_evidence profile to hold a single claim"
    return {"profile_snapshot": thin_profile, "job_fit_result": result, "resolved_job_evidence": bundle}


def build_transferable_only() -> dict:
    """No direct/functional matches -- only a transferable match, mirroring
    generate_fixtures.py's build_needs_review_result but importing its
    extension fixture rather than duplicating it."""
    from tests.fixtures.application_intelligence.generate_fixtures import _data_engineering_extension
    job, bundle, profile = _base_bundle_and_profile()
    pipeline_id = next(item["id"] for item in bundle["evidence"] if item["text"] == "Build reliable data pipelines.")
    proposals = {
        "matches": [{
            "proposal_id": "sem-pipelines-transfer", "job_evidence_id": pipeline_id,
            "profile_evidence_ids": ["clm_2222222222222222"], "classification": "transferable",
            "rationale": "Pipeline building responsibility transfers via extension mapping.",
            "confidence": "medium",
            "extension_ref": {
                "extension_id": "data-engineering-knowledge", "extension_version": "0.1.0",
                "record_type": "transferable_mapping", "record_id": "map-pipelines-to-etl",
            },
        }],
        "gates": [],
    }
    request = build_semantic_job_fit_request(
        request_id="laneb-transferable-only", profile_snapshot=profile, job_snapshot=job,
        resolved_job_evidence=bundle, semantic_fit_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"}, semantic_proposals=proposals,
        active_extensions=[_data_engineering_extension()],
    )
    result = analyze_semantic_job_fit(request)
    assert not result.get("direct_matches") and not result.get("functionally_equivalent_matches"), (
        "expected build_transferable_only() to produce no direct/functional matches"
    )
    assert result.get("transferable_matches"), "expected build_transferable_only() to produce a transferable match"
    return {"profile_snapshot": profile, "job_fit_result": result, "resolved_job_evidence": bundle}


def build_gaps() -> dict:
    """Job fit result with a real gap: request evaluation with a job
    requirement that has no matching proposal at all, so Ticket 7 records it
    under gaps rather than any match list."""
    job, bundle, profile = _base_bundle_and_profile()
    proposals = {"matches": [], "gates": []}  # no matches proposed -> unmatched requirements become gaps
    request = build_semantic_job_fit_request(
        request_id="laneb-gaps", profile_snapshot=profile, job_snapshot=job,
        resolved_job_evidence=bundle, semantic_fit_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"}, semantic_proposals=proposals,
    )
    result = analyze_semantic_job_fit(request)
    assert result.get("gaps"), "expected build_gaps() to produce at least one real gap"
    return {"profile_snapshot": profile, "job_fit_result": result, "resolved_job_evidence": bundle}


def _stable_id(prefix: str, value: str) -> str:
    """Mirror product/profile_snapshot.py's own _stable_id so hand-built ids
    are indistinguishable from ones the real SnapshotBuilder would produce."""
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest}"


def build_conflicting_evidence() -> dict:
    """Profile snapshot with a real, validate_snapshot-accepted conflict:
    two claims sharing one concept_id, from two different source files, with
    disagreeing values for the same employment date_range.

    The conflict-entry shape below was confirmed by reading
    product/profile_snapshot.py's _group_claims (constructs conflicts as
    {"id": "con_<16hex>", "concept_id", "category", "field", "variants": [...]}
    where each variant is {"value", "claim_ids", "provenance"}) and
    validate_snapshot (cross-checks each variant's claim_ids share the group's
    concept_id/category/field and that the variant value matches the claim's
    normalized value). product/application_intelligence.py's
    _render_candidate_fact_atom (via conflicted_concepts, built at line ~836
    as `{conflict["concept_id"] for conflict in profile_snapshot.get("conflicts", [])}`)
    then treats any claim whose concept_id appears in this set as UNSUPPORTED
    evidence -- this fixture exercises exactly that path.
    """
    job, bundle, profile = _base_bundle_and_profile()
    conflicting_profile = copy.deepcopy(profile)

    concept_id = "cpt_7777777777777777"
    claim_a_id = "clm_7777777777777777"
    claim_b_id = "clm_7777777777777778"
    category, field = "employment", "date_range"

    claim_a = {
        "id": claim_a_id,
        "record_id": "rec_7777777777777777",
        "concept_id": concept_id,
        "category": category,
        "field": field,
        "value": "2019-2021",
        "source": {
            "file": "CLAUDE.md",
            "section": "Candidate Profile > Experience",
            "line_start": 21,
            "line_end": 21,
        },
        "placeholder": False,
        "confidence": "high",
        "extraction_status": "explicit",
    }
    claim_b = {
        "id": claim_b_id,
        "record_id": "rec_7777777777777778",
        "concept_id": concept_id,
        "category": category,
        "field": field,
        "value": "2019-2022",
        "source": {
            "file": "linkedin.md",
            "section": "Experience",
            "line_start": 5,
            "line_end": 5,
        },
        "placeholder": False,
        "confidence": "medium",
        "extraction_status": "explicit",
    }

    conflicting_profile["sources"].append(
        {
            "file": "linkedin.md",
            "sha256": "b" * 64,
            "line_count": 10,
        }
    )
    conflicting_profile["claims"].extend([claim_a, claim_b])

    conflict_entry = {
        "id": _stable_id("con", concept_id),
        "concept_id": concept_id,
        "category": category,
        "field": field,
        "variants": [
            {
                "value": claim_a["value"],
                "claim_ids": [claim_a_id],
                "provenance": [claim_a["source"]],
            },
            {
                "value": claim_b["value"],
                "claim_ids": [claim_b_id],
                "provenance": [claim_b["source"]],
            },
        ],
    }
    conflicting_profile["conflicts"] = list(conflicting_profile["conflicts"]) + [conflict_entry]
    conflicting_profile["summary"] = {
        "source_count": len(conflicting_profile["sources"]),
        "claim_count": len(conflicting_profile["claims"]),
        "placeholder_claim_count": sum(
            1 for c in conflicting_profile["claims"] if c["placeholder"]
        ),
        "corroboration_count": len(conflicting_profile["corroborations"]),
        "conflict_count": len(conflicting_profile["conflicts"]),
    }
    validate_snapshot(conflicting_profile)  # must be accepted as a real, valid snapshot

    proposals = proposals_for_full_fit(bundle)
    request = build_semantic_job_fit_request(
        request_id="laneb-conflicting-evidence", profile_snapshot=conflicting_profile, job_snapshot=job,
        resolved_job_evidence=bundle, semantic_fit_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"}, semantic_proposals=proposals,
    )
    result = analyze_semantic_job_fit(request)
    assert conflicting_profile["conflicts"], "expected build_conflicting_evidence() to carry a real conflict entry"
    return {
        "profile_snapshot": conflicting_profile,
        "job_fit_result": result,
        "resolved_job_evidence": bundle,
    }


def main() -> None:
    scenarios = {
        "strong_evidence.json": build_strong_evidence,
        "sparse_evidence.json": build_sparse_evidence,
        "transferable_only.json": build_transferable_only,
        "gaps.json": build_gaps,
        "conflicting_evidence.json": build_conflicting_evidence,
    }
    for name, builder in scenarios.items():
        payload = builder()
        (OUTPUT_DIR / name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {name}")


if __name__ == "__main__":
    main()
