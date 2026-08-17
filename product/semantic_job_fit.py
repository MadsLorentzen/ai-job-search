#!/usr/bin/env python3
"""Semantic Job Fit Analyzer v0.

Ticket 7 consumes existing product contracts and produces a Job Fit v1 result.
It does not parse raw job text, read candidate profile files, call hosted
providers, or mutate any upstream contract. Provider-authored semantic
relationships, when supplied, are treated as proposals and locally adjudicated
against Profile Snapshot evidence, resolved Job Understanding evidence, active
Extension Package mappings, Semantic Fit Policy, and Evaluation Policy.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

from product.evaluation_policy import (
    EvaluationPolicyValidationError,
    classify_verdict,
    evaluate_scores,
    load_evaluation_policy,
    validate_evaluation_policy,
)
from product.extensions import (
    ExtensionValidationError,
    extension_content_id,
    validate_extension,
)
from product.job_posting import (
    JOB_EVIDENCE_COLLECTIONS,
    JobPostingValidationError,
    job_snapshot_content_id,
    validate_job_posting_snapshot,
)
from product.job_understanding import (
    EVIDENCE_CATEGORIES,
    JobUnderstandingValidationError,
    validate_job_understanding_result,
)
from product.profile_snapshot import SnapshotValidationError, validate_snapshot


MODULE_DIR = Path(__file__).parent
SCHEMA_PATH = MODULE_DIR / "schemas" / "job-fit-contract.v1.schema.json"
POLICY_PATH = MODULE_DIR / "semantic_fit_policy.v0.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
DEFAULT_SEMANTIC_POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))

RESOLVED_JOB_EVIDENCE_BUNDLE_VERSION = SCHEMA["$defs"][
    "resolvedJobEvidenceBundleVersion"
]["const"]
JOB_FIT_REQUEST_VERSION_V1 = SCHEMA["$defs"]["jobFitRequestVersion"]["const"]
JOB_FIT_RESULT_VERSION_V1 = SCHEMA["$defs"]["jobFitResultVersion"]["const"]
SEMANTIC_FIT_POLICY_VERSION = SCHEMA["$defs"]["semanticFitPolicyVersion"]["const"]
ID_RE = re.compile(SCHEMA["$defs"]["id"]["pattern"])
MATCH_CLASSIFICATIONS = tuple(SCHEMA["$defs"]["matchClassification"]["enum"])
DIMENSION_STATUSES = set(SCHEMA["$defs"]["dimensionStatus"]["enum"])
SEMANTIC_STATUSES = set(SCHEMA["$defs"]["semanticStatus"]["enum"])
GAP_TYPES = set(SCHEMA["$defs"]["gapType"]["enum"])
GATE_IDS = ("eligibility", "language", "location_logistics")
GATE_STATUSES = {"PASS", "FAIL", "FLAG", "UNVERIFIED", "NOT_APPLICABLE"}
POSITIVE_CLASSIFICATIONS = {"direct", "functionally_equivalent", "transferable"}
MATCH_COLLECTION_BY_CLASSIFICATION = {
    "direct": "direct_matches",
    "functionally_equivalent": "functionally_equivalent_matches",
    "transferable": "transferable_matches",
}
EXTENSION_RECORD_COLLECTIONS = {
    "transferable_mapping": "transferable_mappings",
}


class SemanticJobFitValidationError(ValueError):
    """Raised when Ticket 7 input or output violates the v1 contract."""

    def __init__(self, errors: str | Iterable[str]):
        if isinstance(errors, str):
            self.errors = [errors]
        else:
            self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def load_semantic_fit_policy(path: str | Path | None = None) -> dict[str, Any]:
    """Load and validate the passive Semantic Fit Policy v0 JSON."""

    policy_path = POLICY_PATH if path is None else Path(path)
    try:
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SemanticJobFitValidationError(f"$.semantic_fit_policy: {exc}") from exc
    validate_semantic_fit_policy(policy)
    return policy


def validate_semantic_fit_policy(policy: Any) -> None:
    errors: list[str] = []
    required = {
        "schema_version",
        "id",
        "description",
        "classification_precedence",
        "positive_classifications",
        "required_gates",
        "gate_evidence_categories",
        "dimension_rules",
        "rules",
    }
    if not _object_shape(policy, required, required, "$.semantic_fit_policy", errors):
        raise SemanticJobFitValidationError(errors)
    if policy.get("schema_version") != SEMANTIC_FIT_POLICY_VERSION:
        errors.append("$.semantic_fit_policy.schema_version: unsupported version")
    _id(policy.get("id"), "$.semantic_fit_policy.id", errors)
    _nonempty_string(policy.get("description"), "$.semantic_fit_policy.description", errors)
    if policy.get("classification_precedence") != list(MATCH_CLASSIFICATIONS):
        errors.append("$.semantic_fit_policy.classification_precedence: must match schema order")
    if set(_string_list(policy.get("positive_classifications"), "$.semantic_fit_policy.positive_classifications", errors)) != POSITIVE_CLASSIFICATIONS:
        errors.append("$.semantic_fit_policy.positive_classifications: must contain direct, functionally_equivalent, transferable")
    if tuple(_string_list(policy.get("required_gates"), "$.semantic_fit_policy.required_gates", errors)) != GATE_IDS:
        errors.append("$.semantic_fit_policy.required_gates: must be eligibility, language, location_logistics")
    gate_categories = policy.get("gate_evidence_categories")
    if _object_shape(gate_categories, set(GATE_IDS), set(GATE_IDS), "$.semantic_fit_policy.gate_evidence_categories", errors):
        for gate_id in GATE_IDS:
            if gate_categories.get(gate_id) not in EVIDENCE_CATEGORIES:
                errors.append(f"$.semantic_fit_policy.gate_evidence_categories.{gate_id}: unknown category")
    _validate_dimension_rules(policy.get("dimension_rules"), errors)
    _validate_required_rules(policy.get("rules"), errors)
    if errors:
        raise SemanticJobFitValidationError(errors)


def semantic_fit_policy_content_id(policy: dict[str, Any]) -> str:
    validate_semantic_fit_policy(policy)
    return _content_id("sempolicy", policy)


def build_resolved_job_evidence_bundle(
    job_snapshot: Any,
    job_understanding_request: dict[str, Any] | None = None,
    job_understanding_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Combine explicit job evidence with validated Ticket 6 accepted evidence.

    Exact Ticket 6 duplicates alias existing raw job evidence. Suggestions,
    ambiguities, warnings, and raw posting text are deliberately excluded.
    """

    _validate_job_snapshot(job_snapshot)
    if (job_understanding_request is None) != (job_understanding_result is None):
        raise SemanticJobFitValidationError(
            "$.job_understanding: request and result must be supplied together"
        )
    if job_understanding_request is not None and job_understanding_result is not None:
        try:
            validate_job_understanding_result(
                job_snapshot,
                job_understanding_request,
                job_understanding_result,
            )
        except JobUnderstandingValidationError as exc:
            raise SemanticJobFitValidationError(
                [f"$.job_understanding: {error}" for error in exc.errors]
            ) from exc

    evidence: list[dict[str, Any]] = []
    aliases: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    explicit_by_id: dict[str, dict[str, Any]] = {}
    explicit_by_signature: dict[tuple[str, str, str], str] = {}

    for category in JOB_EVIDENCE_COLLECTIONS:
        for item in job_snapshot.get(category, []):
            record = _resolved_evidence_record(
                item["id"],
                category,
                item["text"],
                item["kind"],
                "job_posting_snapshot",
                "EXPLICIT",
                source_section=item.get("source_section"),
            )
            evidence.append(record)
            explicit_by_id[item["id"]] = record
            explicit_by_signature[(category, item["kind"], item["text"])] = item["id"]
            seen_ids.add(item["id"])

    if job_understanding_result is not None:
        for category in EVIDENCE_CATEGORIES:
            for item in job_understanding_result.get(category, []):
                duplicate_of = item.get("exact_duplicate_of")
                if isinstance(duplicate_of, str):
                    if duplicate_of not in explicit_by_id:
                        raise SemanticJobFitValidationError(
                            f"$.job_understanding.{category}: duplicate alias references unknown raw evidence"
                        )
                    aliases.append(
                        {
                            "alias_id": item["id"],
                            "canonical_id": duplicate_of,
                            "reason": "exact_duplicate",
                        }
                    )
                    continue
                signature = (category, item["kind"], item["text"])
                if signature in explicit_by_signature:
                    aliases.append(
                        {
                            "alias_id": item["id"],
                            "canonical_id": explicit_by_signature[signature],
                            "reason": "exact_duplicate",
                        }
                    )
                    continue
                if item["id"] in seen_ids:
                    raise SemanticJobFitValidationError(
                        f"$.job_understanding.{category}: duplicate evidence id {item['id']!r}"
                    )
                evidence.append(
                    _resolved_evidence_record(
                        item["id"],
                        category,
                        item["text"],
                        item["kind"],
                        "job_understanding",
                        "ACCEPTED",
                        citations=copy.deepcopy(item.get("citations", [])),
                    )
                )
                seen_ids.add(item["id"])

    bundle = {
        "schema_version": RESOLVED_JOB_EVIDENCE_BUNDLE_VERSION,
        "job_snapshot": _job_identity(job_snapshot),
        "evidence": sorted(evidence, key=lambda item: item["id"]),
        "aliases": sorted(aliases, key=lambda item: item["alias_id"]),
        "excluded": {
            "raw_text": "not_semantic_fit_evidence",
            "suggestions": "not_semantic_fit_evidence",
            "ambiguous_statements": "not_semantic_fit_evidence",
            "warnings": "not_semantic_fit_evidence",
        },
        "summary": {
            "evidence_count": len(evidence),
            "alias_count": len(aliases),
        },
    }
    validate_resolved_job_evidence_bundle(job_snapshot, bundle)
    return bundle


def validate_resolved_job_evidence_bundle(job_snapshot: Any, bundle: Any) -> None:
    _validate_job_snapshot(job_snapshot)
    errors: list[str] = []
    required = {"schema_version", "job_snapshot", "evidence", "aliases", "excluded", "summary"}
    if not _object_shape(bundle, required, required, "$.resolved_job_evidence", errors):
        raise SemanticJobFitValidationError(errors)
    if bundle.get("schema_version") != RESOLVED_JOB_EVIDENCE_BUNDLE_VERSION:
        errors.append("$.resolved_job_evidence.schema_version: unsupported version")
    if bundle.get("job_snapshot") != _job_identity(job_snapshot):
        errors.append("$.resolved_job_evidence.job_snapshot: stale or mismatched job snapshot")
    evidence_ids: set[str] = set()
    for index, item in enumerate(_list(bundle.get("evidence"), "$.resolved_job_evidence.evidence", errors)):
        path = f"$.resolved_job_evidence.evidence[{index}]"
        if not _object_shape(
            item,
            {"id", "category", "text", "kind", "origin", "status"},
            {"id", "category", "text", "kind", "origin", "status", "source_section", "citations"},
            path,
            errors,
        ):
            continue
        _unique_id(item.get("id"), evidence_ids, f"{path}.id", errors)
        _enum(item.get("category"), set(EVIDENCE_CATEGORIES), f"{path}.category", errors)
        _nonempty_string(item.get("text"), f"{path}.text", errors)
        _nonempty_string(item.get("kind"), f"{path}.kind", errors)
        _enum(item.get("origin"), {"job_posting_snapshot", "job_understanding"}, f"{path}.origin", errors)
        _enum(item.get("status"), {"EXPLICIT", "ACCEPTED"}, f"{path}.status", errors)
    alias_ids: set[str] = set()
    for index, alias in enumerate(_list(bundle.get("aliases"), "$.resolved_job_evidence.aliases", errors)):
        path = f"$.resolved_job_evidence.aliases[{index}]"
        if not _object_shape(alias, {"alias_id", "canonical_id", "reason"}, {"alias_id", "canonical_id", "reason"}, path, errors):
            continue
        _unique_id(alias.get("alias_id"), alias_ids, f"{path}.alias_id", errors)
        _id(alias.get("canonical_id"), f"{path}.canonical_id", errors)
        if alias.get("canonical_id") not in evidence_ids:
            errors.append(f"{path}.canonical_id: unknown canonical evidence id")
        if alias.get("reason") != "exact_duplicate":
            errors.append(f"{path}.reason: must be exact_duplicate")
    excluded = bundle.get("excluded")
    if _object_shape(excluded, {"raw_text", "suggestions", "ambiguous_statements", "warnings"}, {"raw_text", "suggestions", "ambiguous_statements", "warnings"}, "$.resolved_job_evidence.excluded", errors):
        for field in excluded:
            if excluded[field] != "not_semantic_fit_evidence":
                errors.append(f"$.resolved_job_evidence.excluded.{field}: must document exclusion")
    summary = bundle.get("summary")
    if _object_shape(summary, {"evidence_count", "alias_count"}, {"evidence_count", "alias_count"}, "$.resolved_job_evidence.summary", errors):
        if summary.get("evidence_count") != len(bundle.get("evidence", [])):
            errors.append("$.resolved_job_evidence.summary.evidence_count: incorrect count")
        if summary.get("alias_count") != len(bundle.get("aliases", [])):
            errors.append("$.resolved_job_evidence.summary.alias_count: incorrect count")
    if errors:
        raise SemanticJobFitValidationError(errors)


def build_semantic_job_fit_request(
    *,
    request_id: str,
    profile_snapshot: dict[str, Any],
    job_snapshot: dict[str, Any],
    resolved_job_evidence: dict[str, Any],
    active_extensions: list[dict[str, Any]] | None = None,
    evaluation_policy: dict[str, Any] | None = None,
    semantic_fit_policy: dict[str, Any] | None = None,
    user_intent: dict[str, Any] | None = None,
    semantic_proposals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build and validate one Job Fit v1 request."""

    request = {
        "schema_version": JOB_FIT_REQUEST_VERSION_V1,
        "request_id": request_id,
        "profile_snapshot": copy.deepcopy(profile_snapshot),
        "job_snapshot": copy.deepcopy(job_snapshot),
        "resolved_job_evidence": copy.deepcopy(resolved_job_evidence),
        "active_extensions": copy.deepcopy(active_extensions or []),
        "evaluation_policy": copy.deepcopy(evaluation_policy or load_evaluation_policy()),
        "semantic_fit_policy": copy.deepcopy(semantic_fit_policy or DEFAULT_SEMANTIC_POLICY),
        "user_intent": copy.deepcopy(user_intent or {"intent": "evaluate_with_transferability"}),
        "semantic_proposals": copy.deepcopy(semantic_proposals or {"matches": [], "gates": []}),
    }
    validate_semantic_job_fit_request(request)
    return request


def validate_semantic_job_fit_request(request: Any) -> None:
    errors: list[str] = []
    required = {
        "schema_version",
        "request_id",
        "profile_snapshot",
        "job_snapshot",
        "resolved_job_evidence",
        "active_extensions",
        "evaluation_policy",
        "semantic_fit_policy",
        "user_intent",
        "semantic_proposals",
    }
    if not _object_shape(request, required, required, "$", errors):
        raise SemanticJobFitValidationError(errors)
    if request.get("schema_version") != JOB_FIT_REQUEST_VERSION_V1:
        errors.append("$.schema_version: unsupported job fit request version")
    _id(request.get("request_id"), "$.request_id", errors)
    _validate_embedded_contracts(request, errors)
    _validate_user_intent(request.get("user_intent"), errors)
    _validate_semantic_proposals_shape(request.get("semantic_proposals"), errors)
    if errors:
        raise SemanticJobFitValidationError(errors)


def analyze_semantic_job_fit(request: dict[str, Any]) -> dict[str, Any]:
    """Produce a validated Job Fit v1 result from locally adjudicated evidence."""

    validate_semantic_job_fit_request(request)
    context = _context(request)
    accepted = _adjudicate_match_proposals(request, context)
    gate_assessments = _build_gate_assessments(request, context)
    gate_results = {
        assessment["gate_id"]: {
            "status": assessment["status"],
            "reason": assessment["reason"],
        }
        for assessment in gate_assessments
    }
    dimension_assessments, dimension_scores = _build_dimension_assessments(
        request,
        context,
        accepted,
        gate_assessments,
    )
    blocking_gate_ids = _blocking_gate_ids(gate_results, request["evaluation_policy"])
    unresolved_required = [
        item["dimension_id"]
        for item in dimension_assessments
        if item["required"] and item["status"] != "READY"
    ]
    if blocking_gate_ids or unresolved_required:
        evaluation = {
            "gate_results": _ordered_gate_results(gate_results, request["evaluation_policy"]),
            "dimension_scores": dimension_scores,
            "overall_score": None,
            "verdict": None,
            "blocked": bool(blocking_gate_ids),
            "blocking_gate_ids": blocking_gate_ids,
            "notes": [],
        }
    else:
        try:
            evaluation = evaluate_scores(
                dimension_scores,
                gate_results,
                request["evaluation_policy"],
                [],
            )
        except EvaluationPolicyValidationError as exc:
            raise SemanticJobFitValidationError(
                [f"$.evaluation: {error}" for error in exc.errors]
            ) from exc

    result = {
        "schema_version": JOB_FIT_RESULT_VERSION_V1,
        "request_id": request["request_id"],
        "profile_snapshot": _profile_identity(request["profile_snapshot"]),
        "job_snapshot": _job_identity(request["job_snapshot"]),
        "resolved_job_evidence": _bundle_identity(request["resolved_job_evidence"]),
        "active_extension_versions": [_extension_identity(extension) for extension in request["active_extensions"]],
        "evaluation_policy_version": request["evaluation_policy"]["schema_version"],
        "semantic_fit_policy": _semantic_policy_identity(request["semantic_fit_policy"]),
        "gate_assessments": gate_assessments,
        "gate_results": evaluation["gate_results"],
        "direct_matches": accepted["direct_matches"],
        "functionally_equivalent_matches": accepted["functionally_equivalent_matches"],
        "transferable_matches": accepted["transferable_matches"],
        "gaps": accepted["gaps"],
        "unsupported_claims": accepted["unsupported_claims"],
        "human_judgment_questions": _dedupe_records(
            accepted["human_judgment_questions"] + _dimension_questions(dimension_assessments)
        ),
        "dimension_assessments": dimension_assessments,
        "dimension_scores": evaluation["dimension_scores"],
        "overall_score": evaluation["overall_score"],
        "verdict": evaluation["verdict"],
        "blocked": evaluation["blocked"],
        "blocking_gate_ids": evaluation["blocking_gate_ids"],
        "status": _result_status(evaluation, dimension_assessments, accepted),
        "notes": evaluation["notes"],
    }
    validate_semantic_job_fit_result(request, result)
    return result


def validate_semantic_job_fit_result(request: dict[str, Any], result: Any) -> None:
    validate_semantic_job_fit_request(request)
    errors: list[str] = []
    required = {
        "schema_version",
        "request_id",
        "profile_snapshot",
        "job_snapshot",
        "resolved_job_evidence",
        "active_extension_versions",
        "evaluation_policy_version",
        "semantic_fit_policy",
        "gate_assessments",
        "gate_results",
        "direct_matches",
        "functionally_equivalent_matches",
        "transferable_matches",
        "gaps",
        "unsupported_claims",
        "human_judgment_questions",
        "dimension_assessments",
        "dimension_scores",
        "overall_score",
        "verdict",
        "blocked",
        "blocking_gate_ids",
        "status",
        "notes",
    }
    if not _object_shape(result, required, required, "$.result", errors):
        raise SemanticJobFitValidationError(errors)
    if result.get("schema_version") != JOB_FIT_RESULT_VERSION_V1:
        errors.append("$.result.schema_version: unsupported job fit result version")
    if result.get("request_id") != request["request_id"]:
        errors.append("$.result.request_id: must match request")
    if result.get("profile_snapshot") != _profile_identity(request["profile_snapshot"]):
        errors.append("$.result.profile_snapshot: must identify request profile snapshot")
    if result.get("job_snapshot") != _job_identity(request["job_snapshot"]):
        errors.append("$.result.job_snapshot: must identify request job snapshot")
    if result.get("resolved_job_evidence") != _bundle_identity(request["resolved_job_evidence"]):
        errors.append("$.result.resolved_job_evidence: must identify request resolved evidence")
    if result.get("semantic_fit_policy") != _semantic_policy_identity(request["semantic_fit_policy"]):
        errors.append("$.result.semantic_fit_policy: must identify request semantic policy")
    _enum(result.get("status"), SEMANTIC_STATUSES, "$.result.status", errors)
    _string_list(result.get("notes"), "$.result.notes", errors)
    context = _context(request)
    _validate_result_matches(result, context, errors)
    _validate_gate_assessments(result.get("gate_assessments"), context, errors)
    _validate_gap_records(result.get("gaps"), context, errors)
    _validate_unsupported_records(result.get("unsupported_claims"), context, errors)
    _validate_question_records(result.get("human_judgment_questions"), context, errors)
    _validate_dimension_assessments(result.get("dimension_assessments"), request, errors)
    _validate_evaluation_echo(result, request, errors)
    if errors:
        raise SemanticJobFitValidationError(errors)


def _adjudicate_match_proposals(
    request: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    result = {
        "direct_matches": [],
        "functionally_equivalent_matches": [],
        "transferable_matches": [],
        "gaps": [],
        "unsupported_claims": [],
        "human_judgment_questions": [],
    }
    proposals = request["semantic_proposals"].get("matches", [])
    best_by_job: dict[str, dict[str, Any]] = {}
    for proposal in proposals:
        checked = _adjudicate_one_match(proposal, context)
        job_id = checked.get("job_evidence_id")
        if (
            checked["classification"] in POSITIVE_CLASSIFICATIONS
            and checked["status"] in {"READY", "NEEDS_REVIEW"}
        ):
            current = best_by_job.get(job_id)
            if current is None or _match_priority(checked) < _match_priority(current):
                best_by_job[job_id] = checked
        elif checked["classification"] == "adjacent":
            result["gaps"].append(_gap_from_proposal(checked, "partial_match"))
        else:
            result["gaps"].append(_gap_from_proposal(checked, "unsupported"))
            result["unsupported_claims"].append(_unsupported_from_proposal(checked))
        if checked.get("question"):
            result["human_judgment_questions"].append(checked["question"])

    for item in sorted(best_by_job.values(), key=lambda value: value["job_evidence_id"]):
        collection = MATCH_COLLECTION_BY_CLASSIFICATION[item["classification"]]
        result[collection].append(_match_record(item))
    _add_missing_evidence_gaps(request, context, result, set(best_by_job))
    return result


def _adjudicate_one_match(
    proposal: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    classification = proposal["classification"]
    job_id = _canonical_job_ref(proposal["job_evidence_id"], context)
    profile_ids = proposal.get("profile_evidence_ids", [])
    supportive_claims, rejected_claims = _supportive_profile_claims(profile_ids, context)
    base = {
        "proposal_id": proposal["proposal_id"],
        "job_evidence_id": job_id,
        "profile_evidence_ids": [claim["id"] for claim in supportive_claims],
        "classification": classification,
        "rationale": proposal["rationale"],
        "confidence": proposal.get("confidence", "medium"),
        "status": "READY",
        "rejected_profile_evidence_ids": [claim["id"] for claim in rejected_claims],
    }
    if classification in POSITIVE_CLASSIFICATIONS and not supportive_claims:
        base["status"] = "UNSUPPORTED"
        base["classification"] = "unsupported"
        base["reason"] = "positive match lacks non-placeholder, non-conflicted profile evidence"
        base["question"] = _question(
            "profile_evidence",
            "Profile evidence needs review before this requirement can support a fit conclusion.",
            [job_id],
            profile_ids,
        )
        return base
    if classification == "functionally_equivalent":
        basis = proposal.get("functional_basis")
        if not isinstance(basis, dict) or basis.get("title_similarity_only") is not False:
            base["status"] = "UNSUPPORTED"
            base["classification"] = "unsupported"
            base["reason"] = "functional equivalence requires non-title functional basis"
            return base
        if not basis.get("responsibility_alignment") and not basis.get("competency_alignment"):
            base["status"] = "UNSUPPORTED"
            base["classification"] = "unsupported"
            base["reason"] = "functional equivalence requires responsibility or competency alignment"
            return base
        base["functional_basis"] = copy.deepcopy(basis)
    if classification == "transferable":
        if context["user_intent"] != "evaluate_with_transferability":
            base["status"] = "UNSUPPORTED"
            base["classification"] = "unsupported"
            base["reason"] = "transferable matches are not permitted for evaluate intent"
            return base
        extension_ref = proposal.get("extension_ref")
        mapping = _transferable_mapping(extension_ref, context)
        if mapping is None:
            base["status"] = "UNSUPPORTED"
            base["classification"] = "unsupported"
            base["reason"] = "transferable match requires an active validated extension mapping"
            return base
        base["extension_ref"] = copy.deepcopy(extension_ref)
        base["transferable_mapping_id"] = extension_ref["record_id"]
        base["limitations"] = list(mapping.get("limitations", []))
        base["conditions"] = list(mapping.get("conditions", []))
        if base["conditions"]:
            base["status"] = "NEEDS_REVIEW"
            base["question"] = _question(
                "extension_conditions",
                "Transferability depends on extension conditions that need human review.",
                [job_id],
                base["profile_evidence_ids"],
                extension_ref,
            )
    return base


def _build_gate_assessments(
    request: dict[str, Any],
    context: dict[str, Any],
) -> list[dict[str, Any]]:
    proposals = {
        item["gate_id"]: item for item in request["semantic_proposals"].get("gates", [])
    }
    assessments: list[dict[str, Any]] = []
    gate_categories = request["semantic_fit_policy"]["gate_evidence_categories"]
    for gate_id in GATE_IDS:
        category = gate_categories[gate_id]
        proposal = proposals.get(gate_id)
        status = "UNVERIFIED"
        reason = "No affirmative candidate evidence was supplied for this gate."
        adjudicated_job_ids: list[str] = []
        profile_ids: list[str] = []
        if proposal is not None:
            adjudicated_job_ids, invalid_job_refs = _adjudicate_gate_job_refs(
                proposal["job_evidence_ids"], category, context
            )
            supportive, rejected = _supportive_profile_claims(proposal.get("profile_evidence_ids", []), context)
            profile_ids = [claim["id"] for claim in supportive]
            if invalid_job_refs or not adjudicated_job_ids:
                status = "UNVERIFIED"
                reason = (
                    "Gate evidence is missing, unknown, or outside the configured "
                    f"{category} category."
                )
            elif proposal["status"] == "FAIL":
                if supportive:
                    status = "FAIL"
                    reason = proposal["reason"]
                else:
                    status = "UNVERIFIED"
                    reason = "FAIL requires affirmative job and profile incompatibility evidence."
            elif proposal["status"] in {"PASS", "FLAG"}:
                if supportive:
                    status = proposal["status"]
                    reason = proposal["reason"]
                else:
                    status = "UNVERIFIED"
                    reason = f"{proposal['status']} requires non-placeholder, non-conflicted profile evidence."
            elif proposal["status"] == "NOT_APPLICABLE":
                status = "UNVERIFIED"
                reason = "NOT_APPLICABLE is not inferred automatically in Ticket 7."
            else:
                status = "UNVERIFIED"
                reason = proposal["reason"]
            if rejected:
                reason = f"{reason} Some supplied profile evidence is placeholder or conflicted."
        assessments.append(
            {
                "gate_id": gate_id,
                "status": status,
                "reason": reason,
                "job_evidence_ids": adjudicated_job_ids,
                "profile_evidence_ids": profile_ids,
            }
        )
    return assessments


def _build_dimension_assessments(
    request: dict[str, Any],
    context: dict[str, Any],
    accepted: dict[str, list[dict[str, Any]]],
    gate_assessments: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, float]]:
    positive_by_job: dict[str, str] = {}
    for collection in ("direct_matches", "functionally_equivalent_matches", "transferable_matches"):
        for match in accepted[collection]:
            if match["status"] != "READY":
                continue
            for job_id in match["job_requirement_ids"]:
                positive_by_job[job_id] = match["classification"]
    assessments: list[dict[str, Any]] = []
    scores: dict[str, float] = {}
    for rule in request["semantic_fit_policy"]["dimension_rules"]:
        dimension_id = rule["id"]
        coverage = rule["coverage"]
        material_kinds = set(coverage["material_kinds"])
        relevant_job_ids = [
            item["id"]
            for item in context["job_evidence"].values()
            if item["category"] in set(rule.get("job_categories", []))
            and item["kind"] in material_kinds
        ]
        if not relevant_job_ids:
            assessments.append(
                _dimension(
                    dimension_id,
                    rule["unresolved_when_no_positive_match"],
                    rule["required"],
                    None,
                    [],
                    [],
                )
            )
            continue
        matched_job_ids = [job_id for job_id in relevant_job_ids if job_id in positive_by_job]
        coverage_ratio = Decimal(len(matched_job_ids)) / Decimal(len(relevant_job_ids))
        minimum_ratio = Decimal(str(coverage["minimum_ratio_for_ready"]))
        classifications = [positive_by_job[job_id] for job_id in matched_job_ids]
        classification_scores = rule.get("scores_by_classification")
        score_values = (
            [classification_scores[classification] for classification in classifications]
            if isinstance(classification_scores, dict)
            else []
        )
        if (
            coverage_ratio < minimum_ratio
            or not score_values
            or any(score is None for score in score_values)
        ):
            assessments.append(
                _dimension(
                    dimension_id,
                    "NEEDS_REVIEW",
                    rule["required"],
                    None,
                    sorted(set(classifications), key=_precedence),
                    relevant_job_ids,
                )
            )
            continue
        score = float(
            sum(Decimal(str(value)) for value in score_values) / Decimal(len(score_values))
        )
        assessments.append(
            _dimension(
                dimension_id,
                "READY",
                rule["required"],
                score,
                sorted(set(classifications), key=_precedence),
                relevant_job_ids,
            )
        )
        scores[dimension_id] = score
    return assessments, scores


def _validate_embedded_contracts(request: dict[str, Any], errors: list[str]) -> None:
    try:
        validate_snapshot(request.get("profile_snapshot"))
    except SnapshotValidationError as exc:
        errors.append(f"$.profile_snapshot: {exc}")
    try:
        validate_job_posting_snapshot(request.get("job_snapshot"))
    except JobPostingValidationError as exc:
        errors.extend(f"$.job_snapshot: {error}" for error in exc.errors)
    try:
        validate_resolved_job_evidence_bundle(
            request.get("job_snapshot"), request.get("resolved_job_evidence")
        )
    except SemanticJobFitValidationError as exc:
        errors.extend(exc.errors)
    try:
        validate_evaluation_policy(request.get("evaluation_policy"))
    except EvaluationPolicyValidationError as exc:
        errors.append(f"$.evaluation_policy: {exc}")
    try:
        validate_semantic_fit_policy(request.get("semantic_fit_policy"))
    except SemanticJobFitValidationError as exc:
        errors.extend(exc.errors)
    extensions = request.get("active_extensions")
    if not isinstance(extensions, list):
        errors.append("$.active_extensions: must be an array")
        return
    seen: set[tuple[str, str]] = set()
    for index, extension in enumerate(extensions):
        try:
            validate_extension(extension)
        except ExtensionValidationError as exc:
            errors.append(f"$.active_extensions[{index}]: {exc}")
            continue
        key = (extension["id"], extension["version"])
        if key in seen:
            errors.append(f"$.active_extensions[{index}]: duplicate extension {key[0]}@{key[1]}")
        seen.add(key)


def _validate_user_intent(value: Any, errors: list[str]) -> None:
    if not _object_shape(value, {"intent"}, {"intent"}, "$.user_intent", errors):
        return
    _enum(value.get("intent"), {"evaluate", "evaluate_with_transferability"}, "$.user_intent.intent", errors)


def _validate_semantic_proposals_shape(value: Any, errors: list[str]) -> None:
    if not _object_shape(value, {"matches", "gates"}, {"matches", "gates"}, "$.semantic_proposals", errors):
        return
    for index, match in enumerate(_list(value.get("matches"), "$.semantic_proposals.matches", errors)):
        path = f"$.semantic_proposals.matches[{index}]"
        required = {"proposal_id", "job_evidence_id", "profile_evidence_ids", "classification", "rationale"}
        allowed = required | {"confidence", "functional_basis", "extension_ref"}
        if not _object_shape(match, required, allowed, path, errors):
            continue
        _id(match.get("proposal_id"), f"{path}.proposal_id", errors)
        _id(match.get("job_evidence_id"), f"{path}.job_evidence_id", errors)
        _string_list(match.get("profile_evidence_ids"), f"{path}.profile_evidence_ids", errors)
        _enum(match.get("classification"), set(MATCH_CLASSIFICATIONS), f"{path}.classification", errors)
        _nonempty_string(match.get("rationale"), f"{path}.rationale", errors)
        if "confidence" in match:
            _nonempty_string(match.get("confidence"), f"{path}.confidence", errors)
        if "extension_ref" in match:
            _validate_extension_ref_shape(match.get("extension_ref"), f"{path}.extension_ref", errors)
    for index, gate in enumerate(_list(value.get("gates"), "$.semantic_proposals.gates", errors)):
        path = f"$.semantic_proposals.gates[{index}]"
        if not _object_shape(gate, {"gate_id", "status", "reason", "job_evidence_ids", "profile_evidence_ids"}, {"gate_id", "status", "reason", "job_evidence_ids", "profile_evidence_ids"}, path, errors):
            continue
        _enum(gate.get("gate_id"), set(GATE_IDS), f"{path}.gate_id", errors)
        _enum(gate.get("status"), GATE_STATUSES, f"{path}.status", errors)
        _nonempty_string(gate.get("reason"), f"{path}.reason", errors)
        _string_list(gate.get("job_evidence_ids"), f"{path}.job_evidence_ids", errors)
        _string_list(gate.get("profile_evidence_ids"), f"{path}.profile_evidence_ids", errors)


def _context(request: dict[str, Any]) -> dict[str, Any]:
    profile_by_id = {claim["id"]: claim for claim in request["profile_snapshot"]["claims"]}
    conflicted_concepts = {
        conflict["concept_id"] for conflict in request["profile_snapshot"].get("conflicts", [])
    }
    job_evidence = {item["id"]: item for item in request["resolved_job_evidence"]["evidence"]}
    aliases = {
        alias["alias_id"]: alias["canonical_id"]
        for alias in request["resolved_job_evidence"].get("aliases", [])
    }
    extensions = {
        (extension["id"], extension["version"]): extension
        for extension in request["active_extensions"]
    }
    return {
        "profile_by_id": profile_by_id,
        "conflicted_concepts": conflicted_concepts,
        "job_evidence": job_evidence,
        "aliases": aliases,
        "extensions": extensions,
        "gate_evidence_categories": copy.deepcopy(
            request["semantic_fit_policy"]["gate_evidence_categories"]
        ),
        "user_intent": request["user_intent"]["intent"],
    }


def _supportive_profile_claims(
    profile_ids: list[str],
    context: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    supportive: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for profile_id in profile_ids:
        claim = context["profile_by_id"].get(profile_id)
        if claim is None:
            raise SemanticJobFitValidationError(f"$.semantic_proposals: unknown profile evidence id {profile_id!r}")
        if claim.get("placeholder") or claim.get("concept_id") in context["conflicted_concepts"]:
            rejected.append(claim)
        else:
            supportive.append(claim)
    return supportive, rejected


def _canonical_job_ref(value: str, context: dict[str, Any]) -> str:
    canonical = context["aliases"].get(value, value)
    if canonical not in context["job_evidence"]:
        raise SemanticJobFitValidationError(f"$.semantic_proposals: unknown job evidence id {value!r}")
    return canonical


def _adjudicate_gate_job_refs(
    proposed_refs: list[str],
    expected_category: str,
    context: dict[str, Any],
) -> tuple[list[str], bool]:
    adjudicated: list[str] = []
    invalid = False
    for proposed_ref in proposed_refs:
        canonical = context["aliases"].get(proposed_ref, proposed_ref)
        evidence = context["job_evidence"].get(canonical)
        if evidence is None or evidence.get("category") != expected_category:
            invalid = True
            continue
        if canonical not in adjudicated:
            adjudicated.append(canonical)
    return adjudicated, invalid


def _transferable_mapping(
    ref: Any,
    context: dict[str, Any],
) -> dict[str, Any] | None:
    if not isinstance(ref, dict):
        return None
    key = (ref.get("extension_id"), ref.get("extension_version"))
    extension = context["extensions"].get(key)
    if extension is None or ref.get("record_type") != "transferable_mapping":
        return None
    for mapping in extension.get("transferable_mappings", []):
        if mapping.get("id") == ref.get("record_id"):
            return mapping
    return None


def _add_missing_evidence_gaps(
    request: dict[str, Any],
    context: dict[str, Any],
    result: dict[str, list[dict[str, Any]]],
    matched_job_ids: set[str],
) -> None:
    gap_job_ids = set()
    for rule in request["semantic_fit_policy"]["dimension_rules"]:
        for item in context["job_evidence"].values():
            if item["category"] in set(rule.get("job_categories", [])) and item["id"] not in matched_job_ids:
                gap_job_ids.add(item["id"])
    existing = {
        job_id
        for gap in result["gaps"]
        for job_id in gap.get("job_requirement_ids", [])
    }
    for job_id in sorted(gap_job_ids - existing):
        result["gaps"].append(
            {
                "gap_id": _stable_id("gap", f"missing:{job_id}"),
                "job_requirement_ids": [job_id],
                "gap_type": "missing_evidence",
                "evidence_status": "NEEDS_REVIEW",
                "notes": "No non-placeholder, non-conflicted profile evidence supports this job evidence.",
            }
        )


def _match_record(item: dict[str, Any]) -> dict[str, Any]:
    record = {
        "match_id": _stable_id("match", f"{item['classification']}:{item['job_evidence_id']}:{','.join(item['profile_evidence_ids'])}"),
        "job_requirement_ids": [item["job_evidence_id"]],
        "profile_evidence_ids": item["profile_evidence_ids"],
        "classification": item["classification"],
        "rationale": item["rationale"],
        "confidence": item["confidence"],
        "status": item["status"],
    }
    if item["classification"] == "functionally_equivalent":
        record["functional_basis"] = copy.deepcopy(item["functional_basis"])
    if item["classification"] == "transferable":
        record.update(
            {
                "extension_ref": copy.deepcopy(item["extension_ref"]),
                "transferable_mapping_id": item["transferable_mapping_id"],
                "limitations": copy.deepcopy(item["limitations"]),
                "conditions": copy.deepcopy(item["conditions"]),
            }
        )
    return record


def _gap_from_proposal(item: dict[str, Any], gap_type: str) -> dict[str, Any]:
    return {
        "gap_id": _stable_id("gap", f"{gap_type}:{item['job_evidence_id']}:{item['proposal_id']}"),
        "job_requirement_ids": [item["job_evidence_id"]],
        "gap_type": gap_type,
        "evidence_status": "NEEDS_REVIEW",
        "notes": item.get("reason", item["rationale"]),
    }


def _unsupported_from_proposal(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "claim_id": _stable_id("uns", f"{item['proposal_id']}:{item['job_evidence_id']}"),
        "claim_text": item.get("rationale", "Unsupported semantic fit claim."),
        "reason": item.get("reason", "The proposed conclusion lacks required evidence."),
        "attempted_profile_evidence_ids": item.get("profile_evidence_ids", []),
        "attempted_job_evidence_ids": [item["job_evidence_id"]],
        "status": "UNSUPPORTED",
    }


def _dimension(
    dimension_id: str,
    status: str,
    required: bool,
    score: Any,
    classifications: list[str],
    job_ids: list[str],
) -> dict[str, Any]:
    record = {
        "dimension_id": dimension_id,
        "status": status,
        "required": required,
        "score": None if score is None else float(score),
        "supporting_classifications": classifications,
        "job_evidence_ids": sorted(job_ids),
    }
    if status != "READY":
        record["reason"] = "Required semantic evidence remains unresolved."
    return record


def _dimension_questions(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    questions = []
    for item in items:
        if item["required"] and item["status"] != "READY":
            questions.append(
                _question(
                    f"dimension_{item['dimension_id']}",
                    f"{item['dimension_id']} needs evidence review before final scoring.",
                    item.get("job_evidence_ids", []),
                    [],
                )
            )
    return questions


def _question(
    topic: str,
    question: str,
    job_ids: list[str],
    profile_ids: list[str],
    extension_ref: dict[str, Any] | None = None,
) -> dict[str, Any]:
    record = {
        "question_id": _stable_id("q", f"{topic}:{','.join(job_ids)}:{','.join(profile_ids)}"),
        "topic": topic,
        "question": question,
        "related_job_ids": sorted(job_ids),
        "related_profile_evidence_ids": sorted(profile_ids),
        "status": "NEEDS_REVIEW",
    }
    if extension_ref is not None:
        record["extension_ref"] = copy.deepcopy(extension_ref)
    return record


def _validate_result_matches(result: dict[str, Any], context: dict[str, Any], errors: list[str]) -> None:
    for collection, classification in (
        ("direct_matches", "direct"),
        ("functionally_equivalent_matches", "functionally_equivalent"),
        ("transferable_matches", "transferable"),
    ):
        for index, match in enumerate(_list(result.get(collection), f"$.result.{collection}", errors)):
            path = f"$.result.{collection}[{index}]"
            required = {"match_id", "job_requirement_ids", "profile_evidence_ids", "classification", "rationale", "confidence", "status"}
            allowed = set(required)
            if classification == "functionally_equivalent":
                required.add("functional_basis")
                allowed.add("functional_basis")
            if classification == "transferable":
                required.update({"extension_ref", "transferable_mapping_id", "limitations", "conditions"})
                allowed.update({"extension_ref", "transferable_mapping_id", "limitations", "conditions"})
            if not _object_shape(match, required, allowed, path, errors):
                continue
            _id(match.get("match_id"), f"{path}.match_id", errors)
            _enum(match.get("classification"), {classification}, f"{path}.classification", errors)
            _enum(match.get("status"), {"READY", "NEEDS_REVIEW"}, f"{path}.status", errors)
            job_ids = _string_list(match.get("job_requirement_ids"), f"{path}.job_requirement_ids", errors)
            profile_ids = _string_list(match.get("profile_evidence_ids"), f"{path}.profile_evidence_ids", errors)
            if not job_ids:
                errors.append(f"{path}.job_requirement_ids: positive matches require job evidence")
            if not profile_ids:
                errors.append(f"{path}.profile_evidence_ids: positive matches require profile evidence")
            for job_id in job_ids:
                if job_id not in context["job_evidence"]:
                    errors.append(f"{path}.job_requirement_ids: unknown job evidence id {job_id!r}")
            for profile_id in profile_ids:
                claim = context["profile_by_id"].get(profile_id)
                if claim is None:
                    errors.append(f"{path}.profile_evidence_ids: unknown profile evidence id {profile_id!r}")
                elif claim.get("placeholder"):
                    errors.append(f"{path}.profile_evidence_ids: placeholder claim cannot support a match")
                elif claim.get("concept_id") in context["conflicted_concepts"]:
                    errors.append(f"{path}.profile_evidence_ids: conflicted claim cannot support a match")
            if classification == "transferable":
                if context["user_intent"] != "evaluate_with_transferability":
                    errors.append(f"{path}: transferable match is not permitted for evaluate intent")
                mapping = _transferable_mapping(match.get("extension_ref"), context)
                if mapping is None:
                    errors.append(f"{path}.extension_ref: unknown active transferable mapping")
                else:
                    for field in ("limitations", "conditions"):
                        values = _string_list(match.get(field), f"{path}.{field}", errors)
                        for value in mapping.get(field, []):
                            if value not in values:
                                errors.append(f"{path}.{field}: must preserve mapping {field[:-1]} {value!r}")
                    if match.get("conditions") and match.get("status") != "NEEDS_REVIEW":
                        errors.append(f"{path}.status: unresolved mapping conditions require NEEDS_REVIEW")


def _validate_gate_assessments(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    seen: set[str] = set()
    for index, assessment in enumerate(_list(value, "$.result.gate_assessments", errors)):
        path = f"$.result.gate_assessments[{index}]"
        if not _object_shape(assessment, {"gate_id", "status", "reason", "job_evidence_ids", "profile_evidence_ids"}, {"gate_id", "status", "reason", "job_evidence_ids", "profile_evidence_ids"}, path, errors):
            continue
        gate_id = assessment.get("gate_id")
        _enum(gate_id, set(GATE_IDS), f"{path}.gate_id", errors)
        if isinstance(gate_id, str):
            if gate_id in seen:
                errors.append(f"{path}.gate_id: duplicate gate")
            seen.add(gate_id)
        _enum(assessment.get("status"), GATE_STATUSES, f"{path}.status", errors)
        _nonempty_string(assessment.get("reason"), f"{path}.reason", errors)
        job_ids = _string_list(assessment.get("job_evidence_ids"), f"{path}.job_evidence_ids", errors)
        profile_ids = _string_list(assessment.get("profile_evidence_ids"), f"{path}.profile_evidence_ids", errors)
        for job_id in job_ids:
            evidence = context["job_evidence"].get(job_id)
            if evidence is None:
                errors.append(f"{path}.job_evidence_ids: unknown job evidence id {job_id!r}")
            elif isinstance(gate_id, str) and evidence.get("category") != context["gate_evidence_categories"].get(gate_id):
                errors.append(f"{path}.job_evidence_ids: evidence does not belong to the gate category")
        for profile_id in profile_ids:
            claim = context["profile_by_id"].get(profile_id)
            if claim is None:
                errors.append(f"{path}.profile_evidence_ids: unknown profile evidence id {profile_id!r}")
            elif claim.get("placeholder") or claim.get("concept_id") in context["conflicted_concepts"]:
                errors.append(f"{path}.profile_evidence_ids: cannot use placeholder or conflicted profile evidence")
        if assessment.get("status") == "FAIL" and (not job_ids or not profile_ids):
            errors.append(f"{path}: FAIL requires affirmative job and profile evidence")
    if seen != set(GATE_IDS):
        errors.append("$.result.gate_assessments: must contain every required gate")


def _validate_gap_records(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    seen: set[str] = set()
    for index, gap in enumerate(_list(value, "$.result.gaps", errors)):
        path = f"$.result.gaps[{index}]"
        if not _object_shape(
            gap,
            {"gap_id", "job_requirement_ids", "gap_type", "evidence_status", "notes"},
            {"gap_id", "job_requirement_ids", "gap_type", "evidence_status", "notes"},
            path,
            errors,
        ):
            continue
        _unique_id(gap.get("gap_id"), seen, f"{path}.gap_id", errors)
        job_ids = _string_list(gap.get("job_requirement_ids"), f"{path}.job_requirement_ids", errors)
        if not job_ids:
            errors.append(f"{path}.job_requirement_ids: gaps require job evidence")
        for job_id in job_ids:
            if job_id not in context["job_evidence"]:
                errors.append(f"{path}.job_requirement_ids: unknown job evidence id {job_id!r}")
        _enum(gap.get("gap_type"), GAP_TYPES, f"{path}.gap_type", errors)
        _enum(gap.get("evidence_status"), SEMANTIC_STATUSES, f"{path}.evidence_status", errors)
        _nonempty_string(gap.get("notes"), f"{path}.notes", errors)


def _validate_unsupported_records(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    seen: set[str] = set()
    for index, claim in enumerate(_list(value, "$.result.unsupported_claims", errors)):
        path = f"$.result.unsupported_claims[{index}]"
        if not _object_shape(
            claim,
            {"claim_id", "claim_text", "reason", "attempted_profile_evidence_ids", "attempted_job_evidence_ids", "status"},
            {"claim_id", "claim_text", "reason", "attempted_profile_evidence_ids", "attempted_job_evidence_ids", "status"},
            path,
            errors,
        ):
            continue
        _unique_id(claim.get("claim_id"), seen, f"{path}.claim_id", errors)
        _nonempty_string(claim.get("claim_text"), f"{path}.claim_text", errors)
        _nonempty_string(claim.get("reason"), f"{path}.reason", errors)
        _enum(claim.get("status"), {"UNSUPPORTED", "NEEDS_REVIEW"}, f"{path}.status", errors)
        for profile_id in _string_list(claim.get("attempted_profile_evidence_ids"), f"{path}.attempted_profile_evidence_ids", errors):
            if profile_id not in context["profile_by_id"]:
                errors.append(f"{path}.attempted_profile_evidence_ids: unknown profile evidence id {profile_id!r}")
        for job_id in _string_list(claim.get("attempted_job_evidence_ids"), f"{path}.attempted_job_evidence_ids", errors):
            if job_id not in context["job_evidence"]:
                errors.append(f"{path}.attempted_job_evidence_ids: unknown job evidence id {job_id!r}")


def _validate_question_records(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    seen: set[str] = set()
    for index, question in enumerate(_list(value, "$.result.human_judgment_questions", errors)):
        path = f"$.result.human_judgment_questions[{index}]"
        if not _object_shape(
            question,
            {"question_id", "topic", "question", "related_job_ids", "related_profile_evidence_ids", "status"},
            {"question_id", "topic", "question", "related_job_ids", "related_profile_evidence_ids", "status", "extension_ref"},
            path,
            errors,
        ):
            continue
        _unique_id(question.get("question_id"), seen, f"{path}.question_id", errors)
        _nonempty_string(question.get("topic"), f"{path}.topic", errors)
        _nonempty_string(question.get("question"), f"{path}.question", errors)
        _enum(question.get("status"), {"READY", "NEEDS_REVIEW"}, f"{path}.status", errors)
        for job_id in _string_list(question.get("related_job_ids"), f"{path}.related_job_ids", errors):
            if job_id not in context["job_evidence"]:
                errors.append(f"{path}.related_job_ids: unknown job evidence id {job_id!r}")
        for profile_id in _string_list(question.get("related_profile_evidence_ids"), f"{path}.related_profile_evidence_ids", errors):
            if profile_id not in context["profile_by_id"]:
                errors.append(f"{path}.related_profile_evidence_ids: unknown profile evidence id {profile_id!r}")
        if "extension_ref" in question and _transferable_mapping(question["extension_ref"], context) is None:
            errors.append(f"{path}.extension_ref: unknown active transferable mapping")


def _validate_dimension_assessments(value: Any, request: dict[str, Any], errors: list[str]) -> None:
    expected = {dimension["id"] for dimension in request["evaluation_policy"]["dimensions"]}
    seen: set[str] = set()
    for index, item in enumerate(_list(value, "$.result.dimension_assessments", errors)):
        path = f"$.result.dimension_assessments[{index}]"
        if not _object_shape(item, {"dimension_id", "status", "required", "score", "supporting_classifications", "job_evidence_ids"}, {"dimension_id", "status", "required", "score", "supporting_classifications", "job_evidence_ids", "reason"}, path, errors):
            continue
        dimension_id = item.get("dimension_id")
        _enum(dimension_id, expected, f"{path}.dimension_id", errors)
        if isinstance(dimension_id, str):
            seen.add(dimension_id)
        _enum(item.get("status"), DIMENSION_STATUSES, f"{path}.status", errors)
        if item.get("status") == "READY":
            _score_or_error(item.get("score"), f"{path}.score", errors)
        elif item.get("score") is not None:
            errors.append(f"{path}.score: unresolved dimensions must not have scores")
    if seen != expected:
        errors.append("$.result.dimension_assessments: must cover every evaluation dimension")


def _validate_evaluation_echo(result: dict[str, Any], request: dict[str, Any], errors: list[str]) -> None:
    blocking = _blocking_gate_ids(
        {item["gate_id"]: item["status"] for item in result.get("gate_assessments", []) if isinstance(item, dict)},
        request["evaluation_policy"],
    )
    unresolved = [
        item for item in result.get("dimension_assessments", [])
        if isinstance(item, dict) and item.get("required") is True and item.get("status") != "READY"
    ]
    if blocking or unresolved:
        if result.get("overall_score") is not None:
            errors.append("$.result.overall_score: must be null while blocked or unresolved")
        if result.get("verdict") is not None:
            errors.append("$.result.verdict: must be null while blocked or unresolved")
        return
    try:
        expected = evaluate_scores(
            result.get("dimension_scores"),
            result.get("gate_results"),
            request["evaluation_policy"],
            [],
        )
    except EvaluationPolicyValidationError as exc:
        errors.extend(f"$.result.evaluation: {error}" for error in exc.errors)
        return
    for field in ("overall_score", "verdict", "blocked", "blocking_gate_ids"):
        if result.get(field) != expected[field]:
            errors.append(f"$.result.{field}: must match Evaluation Policy output")


def _ordered_gate_results(gates: dict[str, Any], policy: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "gate_id": gate["id"],
            "status": gates[gate["id"]]["status"] if isinstance(gates[gate["id"]], dict) else gates[gate["id"]],
            **(
                {"reason": gates[gate["id"]]["reason"]}
                if isinstance(gates[gate["id"]], dict) and gates[gate["id"]].get("reason")
                else {}
            ),
        }
        for gate in policy["gates"]
    ]


def _blocking_gate_ids(gates: dict[str, Any], policy: dict[str, Any]) -> list[str]:
    blocking_by_gate = {gate["id"]: set(gate["blocking_statuses"]) for gate in policy["gates"]}
    result = []
    for gate in policy["gates"]:
        raw = gates.get(gate["id"], "UNVERIFIED")
        status = raw.get("status") if isinstance(raw, dict) else raw
        if status in blocking_by_gate[gate["id"]]:
            result.append(gate["id"])
    return result


def _result_status(
    evaluation: dict[str, Any],
    dimensions: list[dict[str, Any]],
    accepted: dict[str, list[dict[str, Any]]],
) -> str:
    if evaluation["blocked"]:
        return "UNAVAILABLE"
    if any(item["status"] != "READY" for item in dimensions):
        return "NEEDS_REVIEW"
    if accepted["unsupported_claims"] or accepted["human_judgment_questions"]:
        return "NEEDS_REVIEW"
    return "READY"


def _resolved_evidence_record(
    evidence_id: str,
    category: str,
    text: str,
    kind: str,
    origin: str,
    status: str,
    *,
    source_section: str | None = None,
    citations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    record = {
        "id": evidence_id,
        "category": category,
        "text": text,
        "kind": kind,
        "origin": origin,
        "status": status,
    }
    if source_section:
        record["source_section"] = source_section
    if citations is not None:
        record["citations"] = citations
    return record


def _profile_identity(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": profile["schema_version"],
        "content_id": _content_id("profilesnap", profile),
    }


def _job_identity(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": job["schema_version"],
        "job_id": job["job_id"],
        "content_id": job_snapshot_content_id(job),
    }


def _bundle_identity(bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": bundle["schema_version"],
        "content_id": _content_id("resolvedjobev", bundle),
    }


def _extension_identity(extension: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": extension["id"],
        "version": extension["version"],
        "content_id": extension_content_id(extension),
    }


def _semantic_policy_identity(policy: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": policy["schema_version"],
        "id": policy["id"],
        "content_id": semantic_fit_policy_content_id(policy),
    }


def _content_id(prefix: str, value: Any) -> str:
    try:
        canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise SemanticJobFitValidationError(f"$.{prefix}: must be canonical JSON: {exc}") from exc
    return f"{prefix}_{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"


def _validate_job_snapshot(snapshot: Any) -> None:
    try:
        validate_job_posting_snapshot(snapshot)
    except JobPostingValidationError as exc:
        raise SemanticJobFitValidationError(exc.errors) from exc


def _validate_dimension_rules(value: Any, errors: list[str]) -> None:
    dimensions = _list(value, "$.semantic_fit_policy.dimension_rules", errors)
    ids: set[str] = set()
    for index, rule in enumerate(dimensions):
        path = f"$.semantic_fit_policy.dimension_rules[{index}]"
        allowed = {
            "id",
            "required",
            "job_categories",
            "scores_by_classification",
            "coverage",
            "unresolved_when_no_positive_match",
        }
        required = {
            "id",
            "required",
            "job_categories",
            "coverage",
            "unresolved_when_no_positive_match",
        }
        if not _object_shape(rule, required, allowed, path, errors):
            continue
        _id(rule.get("id"), f"{path}.id", errors)
        if isinstance(rule.get("id"), str):
            ids.add(rule["id"])
        if not isinstance(rule.get("required"), bool):
            errors.append(f"{path}.required: must be boolean")
        job_categories = _string_list(
            rule.get("job_categories"), f"{path}.job_categories", errors
        )
        for item_index, category in enumerate(job_categories):
            if category not in EVIDENCE_CATEGORIES:
                errors.append(f"{path}.job_categories[{item_index}]: unknown category")
        if job_categories and "scores_by_classification" not in rule:
            errors.append(f"{path}.scores_by_classification: required when job categories are configured")
        if not job_categories and "scores_by_classification" in rule:
            errors.append(f"{path}.scores_by_classification: requires configured job categories")
        if "scores_by_classification" in rule:
            scores = rule["scores_by_classification"]
            if _object_shape(scores, set(MATCH_CLASSIFICATIONS), set(MATCH_CLASSIFICATIONS), f"{path}.scores_by_classification", errors):
                for classification, score in scores.items():
                    if score is not None:
                        _score_or_error(
                            score,
                            f"{path}.scores_by_classification.{classification}",
                            errors,
                        )
        coverage = rule.get("coverage")
        coverage_required = {
            "material_kinds",
            "minimum_ratio_for_ready",
            "score_aggregation",
        }
        if _object_shape(coverage, coverage_required, coverage_required, f"{path}.coverage", errors):
            material_kinds = _string_list(
                coverage.get("material_kinds"),
                f"{path}.coverage.material_kinds",
                errors,
            )
            if not material_kinds:
                errors.append(f"{path}.coverage.material_kinds: must not be empty")
            ratio = coverage.get("minimum_ratio_for_ready")
            if (
                isinstance(ratio, bool)
                or not isinstance(ratio, (int, float))
                or not 0 < ratio <= 1
            ):
                errors.append(
                    f"{path}.coverage.minimum_ratio_for_ready: must be greater than 0 and at most 1"
                )
            _enum(
                coverage.get("score_aggregation"),
                {"mean"},
                f"{path}.coverage.score_aggregation",
                errors,
            )
        _enum(rule.get("unresolved_when_no_positive_match"), DIMENSION_STATUSES - {"READY"}, f"{path}.unresolved_when_no_positive_match", errors)
    expected = {"technical_skills", "experience_match", "behavioral_fit", "career_alignment"}
    if ids != expected:
        errors.append("$.semantic_fit_policy.dimension_rules: must cover the four Evaluation Policy dimensions")


def _validate_required_rules(value: Any, errors: list[str]) -> None:
    expected = {
        "raw_posting_text_is_not_fit_evidence": True,
        "ticket6_suggestions_are_not_fit_evidence": True,
        "ticket6_ambiguities_are_not_fit_evidence": True,
        "ticket6_warnings_are_not_fit_evidence": True,
        "positive_matches_require_job_and_profile_evidence": True,
        "transferable_matches_require_active_extension_mapping": True,
        "extensions_cannot_create_candidate_facts": True,
        "placeholder_profile_claims_support_conclusions": False,
        "conflicted_profile_concepts_auto_resolve": False,
        "missing_candidate_evidence_fails_gate": False,
        "qualification_gap_requires_mismatch_evidence": True,
        "unresolved_dimensions_block_overall_score": True,
    }
    if not _object_shape(value, set(expected), set(expected), "$.semantic_fit_policy.rules", errors):
        return
    for key, expected_value in expected.items():
        if value.get(key) is not expected_value:
            errors.append(f"$.semantic_fit_policy.rules.{key}: must be {expected_value!r}")


def _validate_extension_ref_shape(ref: Any, path: str, errors: list[str]) -> None:
    if not _object_shape(ref, {"extension_id", "extension_version", "record_type", "record_id"}, {"extension_id", "extension_version", "record_type", "record_id"}, path, errors):
        return
    _id(ref.get("extension_id"), f"{path}.extension_id", errors)
    _nonempty_string(ref.get("extension_version"), f"{path}.extension_version", errors)
    _enum(ref.get("record_type"), {"transferable_mapping"}, f"{path}.record_type", errors)
    _id(ref.get("record_id"), f"{path}.record_id", errors)


def _dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {record["question_id"]: record for record in records}
    return [by_id[key] for key in sorted(by_id)]


def _precedence(classification: str) -> int:
    return MATCH_CLASSIFICATIONS.index(classification)


def _match_priority(match: dict[str, Any]) -> tuple[int, int]:
    return (0 if match["status"] == "READY" else 1, _precedence(match["classification"]))


def _stable_id(prefix: str, value: str) -> str:
    return f"{prefix}_{hashlib.sha256(value.encode('utf-8')).hexdigest()[:16]}"


def _object_shape(value: Any, required: set[str], allowed: set[str], path: str, errors: list[str]) -> bool:
    if not isinstance(value, dict):
        errors.append(f"{path}: must be an object")
        return False
    keys = set(value)
    for key in sorted(required - keys):
        errors.append(f"{path}.{key}: required field is missing")
    for key in sorted(keys - allowed, key=str):
        errors.append(f"{path}.{key}: unsupported field")
    return required <= keys


def _list(value: Any, path: str, errors: list[str]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(f"{path}: must be an array")
        return []
    return value


def _string_list(value: Any, path: str, errors: list[str]) -> list[str]:
    items = _list(value, path, errors)
    result: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        if not isinstance(item, str) or not item.strip():
            errors.append(f"{path}[{index}]: must be a non-empty string")
            continue
        if item in seen:
            errors.append(f"{path}[{index}]: duplicate value {item!r}")
        seen.add(item)
        result.append(item)
    return result


def _unique_id(value: Any, seen: set[str], path: str, errors: list[str]) -> None:
    _id(value, path, errors)
    if isinstance(value, str):
        if value in seen:
            errors.append(f"{path}: duplicate id {value!r}")
        seen.add(value)


def _id(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or ID_RE.fullmatch(value) is None:
        errors.append(f"{path}: malformed identifier")


def _nonempty_string(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: must be a non-empty string")


def _enum(value: Any, allowed: set[str], path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or value not in allowed:
        errors.append(f"{path}: must be one of {', '.join(sorted(allowed))}")


def _score_or_error(value: Any, path: str, errors: list[str]) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        errors.append(f"{path}: must be numeric")
        return
    score = Decimal(str(value))
    if not score.is_finite() or score < 0 or score > 100:
        errors.append(f"{path}: must be a finite score between 0 and 100")
