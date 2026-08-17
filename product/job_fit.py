#!/usr/bin/env python3
"""Job Fit Contract v0 validation and envelope assembly.

This module connects the profile snapshot, job posting snapshot, extension
package, and evaluation policy contracts without generating substantive
analysis. It validates caller-supplied records and enforces evidence references.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

from product.evaluation_policy import (
    EvaluationPolicyValidationError,
    evaluate_scores,
    validate_evaluation_policy,
)
from product.extensions import ExtensionValidationError, extension_content_id, validate_extension
from product.job_posting import (
    JOB_EVIDENCE_COLLECTIONS,
    JOB_POSTING_SNAPSHOT_VERSION,
    REQUIREMENT_KINDS,
    JobPostingValidationError,
    job_evidence_ids,
    job_snapshot_content_id as _job_snapshot_content_id,
    validate_job_posting_snapshot as _validate_job_posting_snapshot,
)
from product.profile_snapshot import SnapshotValidationError, validate_snapshot


SCHEMA_PATH = Path(__file__).with_name("schemas") / "job-fit-contract.v0.schema.json"
CONTRACT_SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

JOB_FIT_REQUEST_VERSION = CONTRACT_SCHEMA["$defs"]["jobFitRequestVersion"]["const"]
JOB_FIT_RESULT_VERSION = CONTRACT_SCHEMA["$defs"]["jobFitResultVersion"]["const"]

ID_RE = re.compile(CONTRACT_SCHEMA["$defs"]["id"]["pattern"])
USER_INTENTS = set(CONTRACT_SCHEMA["$defs"]["userIntent"]["enum"])
STATUSES = set(CONTRACT_SCHEMA["$defs"]["status"]["enum"])
MATCH_CLASSIFICATIONS = set(CONTRACT_SCHEMA["$defs"]["matchClassification"]["enum"])
EXTENSION_RECORD_TYPES = set(CONTRACT_SCHEMA["$defs"]["extensionRecordType"]["enum"])
GAP_TYPES = set(CONTRACT_SCHEMA["$defs"]["gapType"]["enum"])
PROHIBITED_INFERENCES = set(CONTRACT_SCHEMA["$defs"]["prohibitedInference"]["enum"])

EXTENSION_RECORD_COLLECTIONS = {
    "competency": "competencies",
    "transferable_mapping": "transferable_mappings",
    "certification": "certifications",
    "terminology": "terminology",
    "role": "roles",
    "disallowed_mapping": "disallowed_mappings",
}
PROFILE_FACT_INFERENCE_TYPES = {
    "regulated-licence",
    "professional-certification",
    "employment-history",
    "years-of-experience",
    "hands-on-experience",
    "formal-qualification",
}


class JobFitValidationError(ValueError):
    """Raised when Job Fit Contract v0 data is malformed or unsupported."""

    def __init__(self, errors: str | Iterable[str]):
        if isinstance(errors, str):
            self.errors = [errors]
        else:
            self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def validate_job_posting_snapshot(snapshot: Any) -> None:
    """Compatibility wrapper for the product-owned Job Posting validator."""

    try:
        _validate_job_posting_snapshot(snapshot)
    except JobPostingValidationError as exc:
        raise JobFitValidationError(exc.errors) from exc


def validate_job_fit_request(request: Any) -> None:
    """Validate a Job Fit Request v0 and all embedded product contracts."""

    errors: list[str] = []
    if not _object_shape(
        request,
        {
            "schema_version",
            "request_id",
            "profile_snapshot",
            "job_snapshot",
            "active_extensions",
            "evaluation_policy",
            "user_intent",
        },
        {
            "schema_version",
            "request_id",
            "profile_snapshot",
            "job_snapshot",
            "active_extensions",
            "evaluation_policy",
            "user_intent",
        },
        "$",
        errors,
    ):
        raise JobFitValidationError(errors)

    if request.get("schema_version") != JOB_FIT_REQUEST_VERSION:
        errors.append("$.schema_version: unsupported job fit request version")
    _id(request.get("request_id"), "$.request_id", errors)
    _validate_embedded_contracts(request, errors)
    _validate_user_intent(request.get("user_intent"), errors)
    _active_extension_index(request.get("active_extensions"), errors)

    if errors:
        raise JobFitValidationError(errors)


def validate_job_fit_result(request: dict[str, Any], result: Any) -> None:
    """Validate a Job Fit Result v0 against its request and evidence indexes."""

    validate_job_fit_request(request)
    errors: list[str] = []
    if not _object_shape(
        result,
        {
            "schema_version",
            "request_id",
            "profile_snapshot",
            "job_snapshot",
            "active_extension_versions",
            "evaluation_policy_version",
            "gate_results",
            "direct_matches",
            "functionally_equivalent_matches",
            "transferable_matches",
            "gaps",
            "unsupported_claims",
            "human_judgment_questions",
            "dimension_scores",
            "overall_score",
            "verdict",
            "blocked",
            "blocking_gate_ids",
            "status",
            "notes",
        },
        {
            "schema_version",
            "request_id",
            "profile_snapshot",
            "job_snapshot",
            "active_extension_versions",
            "evaluation_policy_version",
            "gate_results",
            "direct_matches",
            "functionally_equivalent_matches",
            "transferable_matches",
            "gaps",
            "unsupported_claims",
            "human_judgment_questions",
            "dimension_scores",
            "overall_score",
            "verdict",
            "blocked",
            "blocking_gate_ids",
            "evidence_citations",
            "status",
            "notes",
        },
        "$.result",
        errors,
    ):
        raise JobFitValidationError(errors)

    context = _reference_context(request)
    if result.get("schema_version") != JOB_FIT_RESULT_VERSION:
        errors.append("$.result.schema_version: unsupported job fit result version")
    if result.get("request_id") != request["request_id"]:
        errors.append("$.result.request_id: must match request_id")
    _validate_result_identity_echo(request, result, errors)
    _validate_extension_versions(result.get("active_extension_versions"), context, errors)
    if result.get("evaluation_policy_version") != request["evaluation_policy"]["schema_version"]:
        errors.append("$.result.evaluation_policy_version: must match request policy")
    _enum(result.get("status"), STATUSES, "$.result.status", errors)
    _string_list(result.get("notes"), "$.result.notes", errors)
    if "evidence_citations" in result:
        _validate_evidence_citations(result["evidence_citations"], context, errors)

    _validate_direct_matches(result.get("direct_matches"), context, errors)
    _validate_functional_matches(result.get("functionally_equivalent_matches"), context, errors)
    _validate_transferable_matches(result.get("transferable_matches"), context, errors)
    _validate_unique_match_ids_across_collections(result, errors)
    _validate_gaps(result.get("gaps"), context, errors)
    _validate_unsupported_claims(result.get("unsupported_claims"), context, errors)
    _validate_questions(result.get("human_judgment_questions"), context, errors)
    _validate_evaluation_result_fields(request, result, errors)

    if errors:
        raise JobFitValidationError(errors)


def build_job_fit_result(
    request: dict[str, Any],
    analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble and validate a result envelope from caller-supplied analysis.

    This function performs no semantic matching. Empty analysis collections are
    valid as long as the supplied gate and score inputs validate.
    """

    validate_job_fit_request(request)
    if analysis is None:
        analysis = {}
    elif not isinstance(analysis, dict):
        raise JobFitValidationError("$.analysis: must be an object")
    analysis = copy.deepcopy(analysis)
    try:
        evaluation = evaluate_scores(
            analysis.get("dimension_scores", {}),
            analysis.get("gate_results"),
            request["evaluation_policy"],
            analysis.get("notes"),
        )
    except EvaluationPolicyValidationError as exc:
        raise JobFitValidationError(f"$.analysis.evaluation: {exc}") from exc
    result = {
        "schema_version": JOB_FIT_RESULT_VERSION,
        "request_id": request["request_id"],
        "profile_snapshot": _profile_identity(request["profile_snapshot"]),
        "job_snapshot": _job_identity(request["job_snapshot"]),
        "active_extension_versions": [
            _extension_identity(extension)
            for extension in request["active_extensions"]
        ],
        "evaluation_policy_version": request["evaluation_policy"]["schema_version"],
        "gate_results": evaluation["gate_results"],
        "direct_matches": analysis.get("direct_matches", []),
        "functionally_equivalent_matches": analysis.get(
            "functionally_equivalent_matches", []
        ),
        "transferable_matches": analysis.get("transferable_matches", []),
        "gaps": analysis.get("gaps", []),
        "unsupported_claims": analysis.get("unsupported_claims", []),
        "human_judgment_questions": analysis.get("human_judgment_questions", []),
        "dimension_scores": evaluation["dimension_scores"],
        "overall_score": evaluation["overall_score"],
        "verdict": evaluation["verdict"],
        "blocked": evaluation["blocked"],
        "blocking_gate_ids": evaluation["blocking_gate_ids"],
        "evidence_citations": analysis.get("evidence_citations", []),
        "status": analysis.get("status", "READY"),
        "notes": evaluation["notes"],
    }
    validate_job_fit_result(request, result)
    return result


def orchestrate_job_fit(
    request: dict[str, Any],
    analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Thin deterministic boundary; alias for result assembly in v0."""

    return build_job_fit_result(request, analysis)


def normalized_job_fit_result(request: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    validate_job_fit_result(request, result)
    return json.loads(normalized_job_fit_result_json(request, result))


def normalized_job_fit_result_json(request: dict[str, Any], result: dict[str, Any]) -> str:
    validate_job_fit_result(request, result)
    return json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def profile_snapshot_content_id(profile: dict[str, Any]) -> str:
    """Return a content-derived Profile Snapshot identifier.

    This identifier detects stale content inside the Job Fit boundary. It is
    deterministic but is not a durable database or domain record ID.
    """

    return _content_id("profilesnap", profile)


def job_snapshot_content_id(job: dict[str, Any]) -> str:
    """Return a content-derived Job Posting Snapshot identifier.

    This identifier detects stale content inside the Job Fit boundary. It is
    deterministic but is not a durable database or domain record ID.
    """

    try:
        return _job_snapshot_content_id(job)
    except JobPostingValidationError as exc:
        raise JobFitValidationError(exc.errors) from exc


def _content_id(prefix: str, value: dict[str, Any]) -> str:
    try:
        canonical = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise JobFitValidationError(
            f"$.{prefix}: content must be canonical JSON: {exc}"
        ) from exc
    return f"{prefix}_{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"


def _validate_embedded_contracts(request: dict[str, Any], errors: list[str]) -> None:
    try:
        validate_snapshot(request.get("profile_snapshot"))
    except SnapshotValidationError as exc:
        errors.append(f"$.profile_snapshot: {exc}")
    try:
        validate_job_posting_snapshot(request.get("job_snapshot"))
    except JobFitValidationError as exc:
        errors.extend(exc.errors)
    try:
        validate_evaluation_policy(request.get("evaluation_policy"))
    except EvaluationPolicyValidationError as exc:
        errors.append(f"$.evaluation_policy: {exc}")

    extensions = request.get("active_extensions")
    if not isinstance(extensions, list):
        errors.append("$.active_extensions: must be an array")
        return
    for index, extension in enumerate(extensions):
        try:
            validate_extension(extension)
        except ExtensionValidationError as exc:
            errors.append(f"$.active_extensions[{index}]: {exc}")


def _validate_user_intent(value: Any, errors: list[str]) -> None:
    if not _object_shape(value, {"intent"}, {"intent"}, "$.user_intent", errors):
        return
    _enum(value.get("intent"), USER_INTENTS, "$.user_intent.intent", errors)


def _job_evidence_ids(snapshot: dict[str, Any], errors: list[str]) -> set[str]:
    return job_evidence_ids(snapshot, errors)


def _reference_context(request: dict[str, Any]) -> dict[str, Any]:
    profile_ids = {claim["id"] for claim in request["profile_snapshot"]["claims"]}
    job_errors: list[str] = []
    job_ids = _job_evidence_ids(request["job_snapshot"], job_errors)
    if job_errors:
        raise JobFitValidationError(job_errors)
    extensions = _active_extension_index(request["active_extensions"], [])
    return {
        "profile_ids": profile_ids,
        "job_ids": job_ids,
        "extensions": extensions,
    }


def _active_extension_index(
    extensions: Any,
    errors: list[str],
) -> dict[tuple[str, str], dict[str, Any]]:
    if not isinstance(extensions, list):
        errors.append("$.active_extensions: must be an array")
        return {}
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for position, extension in enumerate(extensions):
        if not isinstance(extension, dict):
            errors.append(f"$.active_extensions[{position}]: must be an object")
            continue
        key = (extension.get("id"), extension.get("version"))
        if not all(isinstance(item, str) for item in key):
            continue
        if key in index:
            errors.append(
                f"$.active_extensions[{position}]: duplicate extension {key[0]}@{key[1]}"
            )
        index[key] = extension
    return index


def _profile_identity(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": profile["schema_version"],
        "content_id": profile_snapshot_content_id(profile),
    }


def _job_identity(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": job["schema_version"],
        "job_id": job["job_id"],
        "content_id": job_snapshot_content_id(job),
    }


def _extension_identity(extension: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": extension["id"],
        "version": extension["version"],
        "content_id": extension_content_id(extension),
    }


def _validate_result_identity_echo(
    request: dict[str, Any],
    result: dict[str, Any],
    errors: list[str],
) -> None:
    expected_profile = _profile_identity(request["profile_snapshot"])
    expected_job = _job_identity(request["job_snapshot"])
    if result.get("profile_snapshot") != expected_profile:
        errors.append("$.result.profile_snapshot: must identify request profile snapshot")
    if result.get("job_snapshot") != expected_job:
        errors.append("$.result.job_snapshot: must identify request job snapshot")


def _validate_extension_versions(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    items = _list(value, "$.result.active_extension_versions", errors)
    expected = {
        key: _extension_identity(extension)
        for key, extension in context["extensions"].items()
    }
    seen: set[tuple[str, str]] = set()
    for index, item in enumerate(items):
        path = f"$.result.active_extension_versions[{index}]"
        if not _object_shape(item, {"id", "version", "content_id"}, {"id", "version", "content_id"}, path, errors):
            continue
        extension_id = item.get("id")
        extension_version = item.get("version")
        content_id = item.get("content_id")
        _id(extension_id, f"{path}.id", errors)
        _nonempty_string(extension_version, f"{path}.version", errors)
        _nonempty_string(content_id, f"{path}.content_id", errors)
        if not (
            isinstance(extension_id, str)
            and ID_RE.fullmatch(extension_id)
            and isinstance(extension_version, str)
            and extension_version.strip()
            and isinstance(content_id, str)
            and content_id.strip()
        ):
            continue
        key = (extension_id, extension_version)
        if key in seen:
            errors.append(f"{path}: duplicate extension version")
        seen.add(key)
        if key not in expected:
            errors.append(f"{path}: unknown active extension {key[0]}@{key[1]}")
        elif item != expected[key]:
            errors.append(f"{path}: content identifier must match active extension")
    if set(expected) != seen:
        errors.append("$.result.active_extension_versions: must match request extensions")


def _validate_direct_matches(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    seen: set[str] = set()
    for index, match in enumerate(_list(value, "$.result.direct_matches", errors)):
        path = f"$.result.direct_matches[{index}]"
        if not _match_shape(match, path, errors, "direct"):
            continue
        _unique_id(match.get("match_id"), seen, f"{path}.match_id", errors)
        _profile_refs(match.get("profile_evidence_ids"), context, f"{path}.profile_evidence_ids", errors, required=True)
        _job_refs(match.get("job_requirement_ids"), context, f"{path}.job_requirement_ids", errors, required=True)


def _validate_functional_matches(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    seen: set[str] = set()
    for index, match in enumerate(_list(value, "$.result.functionally_equivalent_matches", errors)):
        path = f"$.result.functionally_equivalent_matches[{index}]"
        if not _match_shape(match, path, errors, "functionally_equivalent", {"functional_basis"}):
            continue
        _unique_id(match.get("match_id"), seen, f"{path}.match_id", errors)
        _profile_refs(match.get("profile_evidence_ids"), context, f"{path}.profile_evidence_ids", errors, required=True)
        _job_refs(match.get("job_requirement_ids"), context, f"{path}.job_requirement_ids", errors, required=True)
        _validate_functional_basis(match.get("functional_basis"), f"{path}.functional_basis", errors)


def _validate_transferable_matches(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    seen: set[str] = set()
    required = {
        "match_id",
        "job_requirement_ids",
        "profile_evidence_ids",
        "classification",
        "extension_ref",
        "transferable_mapping_id",
        "rationale",
        "limitations",
        "conditions",
        "confidence",
        "status",
    }
    allowed = required | {"asserts_candidate_facts"}
    for index, match in enumerate(_list(value, "$.result.transferable_matches", errors)):
        path = f"$.result.transferable_matches[{index}]"
        if not _object_shape(match, required, allowed, path, errors):
            continue
        _unique_id(match.get("match_id"), seen, f"{path}.match_id", errors)
        _enum(match.get("classification"), {"transferable"}, f"{path}.classification", errors)
        _profile_refs(match.get("profile_evidence_ids"), context, f"{path}.profile_evidence_ids", errors, required=True)
        _job_refs(match.get("job_requirement_ids"), context, f"{path}.job_requirement_ids", errors, required=True)
        extension = _validate_extension_ref(
            match.get("extension_ref"),
            context,
            f"{path}.extension_ref",
            errors,
            expected_record_type="transferable_mapping",
            expected_record_id=match.get("transferable_mapping_id"),
        )
        _id(
            match.get("transferable_mapping_id"),
            f"{path}.transferable_mapping_id",
            errors,
        )
        mapping = None
        if extension:
            mapping = _extension_record(extension, "transferable_mapping", match.get("transferable_mapping_id"))
            if mapping is None:
                errors.append(f"{path}.transferable_mapping_id: unknown transferable mapping id")
        _nonempty_string(match.get("rationale"), f"{path}.rationale", errors)
        _string_list(match.get("limitations"), f"{path}.limitations", errors)
        _string_list(match.get("conditions"), f"{path}.conditions", errors)
        _nonempty_string(match.get("confidence"), f"{path}.confidence", errors)
        _enum(match.get("status"), STATUSES, f"{path}.status", errors)
        _reject_extension_only_candidate_facts(
            match.get("asserts_candidate_facts", []), context, path, errors
        )
        if extension and mapping:
            _preserve_mapping_safety_metadata(match, mapping, path, errors)
            _enforce_disallowed_boundaries(match, extension, path, errors)


def _validate_unique_match_ids_across_collections(
    result: dict[str, Any],
    errors: list[str],
) -> None:
    seen: dict[str, str] = {}
    for collection in (
        "direct_matches",
        "functionally_equivalent_matches",
        "transferable_matches",
    ):
        items = result.get(collection)
        if not isinstance(items, list):
            continue
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            match_id = item.get("match_id")
            if not isinstance(match_id, str):
                continue
            path = f"$.result.{collection}[{index}].match_id"
            if match_id in seen:
                errors.append(f"{path}: duplicate match id also used at {seen[match_id]}")
            else:
                seen[match_id] = path


def _validate_gaps(value: Any, context: dict[str, Any], errors: list[str]) -> None:
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
        _job_refs(gap.get("job_requirement_ids"), context, f"{path}.job_requirement_ids", errors, required=True)
        _enum(gap.get("gap_type"), GAP_TYPES, f"{path}.gap_type", errors)
        _enum(gap.get("evidence_status"), STATUSES, f"{path}.evidence_status", errors)
        _nonempty_string(gap.get("notes"), f"{path}.notes", errors)


def _validate_unsupported_claims(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    seen: set[str] = set()
    for index, claim in enumerate(_list(value, "$.result.unsupported_claims", errors)):
        path = f"$.result.unsupported_claims[{index}]"
        if not _object_shape(
            claim,
            {"claim_id", "claim_text", "reason", "attempted_profile_evidence_ids", "attempted_extension_refs", "status"},
            {"claim_id", "claim_text", "reason", "attempted_profile_evidence_ids", "attempted_extension_refs", "status"},
            path,
            errors,
        ):
            continue
        _unique_id(claim.get("claim_id"), seen, f"{path}.claim_id", errors)
        _nonempty_string(claim.get("claim_text"), f"{path}.claim_text", errors)
        _nonempty_string(claim.get("reason"), f"{path}.reason", errors)
        _profile_refs(claim.get("attempted_profile_evidence_ids"), context, f"{path}.attempted_profile_evidence_ids", errors, required=False)
        for ref_index, ref in enumerate(_list(claim.get("attempted_extension_refs"), f"{path}.attempted_extension_refs", errors)):
            _validate_extension_ref(ref, context, f"{path}.attempted_extension_refs[{ref_index}]", errors)
        _enum(claim.get("status"), {"UNSUPPORTED", "NEEDS_REVIEW"}, f"{path}.status", errors)


def _validate_questions(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    seen: set[str] = set()
    for index, question in enumerate(_list(value, "$.result.human_judgment_questions", errors)):
        path = f"$.result.human_judgment_questions[{index}]"
        if not _object_shape(
            question,
            {"question_id", "topic", "question", "related_job_ids", "related_profile_evidence_ids", "status"},
            {"question_id", "topic", "question", "related_job_ids", "related_profile_evidence_ids", "status"},
            path,
            errors,
        ):
            continue
        _unique_id(question.get("question_id"), seen, f"{path}.question_id", errors)
        _nonempty_string(question.get("topic"), f"{path}.topic", errors)
        _nonempty_string(question.get("question"), f"{path}.question", errors)
        _job_refs(question.get("related_job_ids"), context, f"{path}.related_job_ids", errors, required=False)
        _profile_refs(question.get("related_profile_evidence_ids"), context, f"{path}.related_profile_evidence_ids", errors, required=False)
        _enum(question.get("status"), {"NEEDS_REVIEW", "READY"}, f"{path}.status", errors)


def _validate_evidence_citations(value: Any, context: dict[str, Any], errors: list[str]) -> None:
    for index, citation in enumerate(_list(value, "$.result.evidence_citations", errors)):
        path = f"$.result.evidence_citations[{index}]"
        if not _object_shape(citation, {"citation_id", "profile_evidence_ids", "job_evidence_ids"}, {"citation_id", "profile_evidence_ids", "job_evidence_ids", "extension_refs"}, path, errors):
            continue
        _id(citation.get("citation_id"), f"{path}.citation_id", errors)
        _profile_refs(citation.get("profile_evidence_ids"), context, f"{path}.profile_evidence_ids", errors, required=False)
        _job_refs(citation.get("job_evidence_ids"), context, f"{path}.job_evidence_ids", errors, required=False)
        for ref_index, ref in enumerate(_list(citation.get("extension_refs", []), f"{path}.extension_refs", errors)):
            _validate_extension_ref(ref, context, f"{path}.extension_refs[{ref_index}]", errors)


def _validate_evaluation_result_fields(request: dict[str, Any], result: dict[str, Any], errors: list[str]) -> None:
    try:
        expected = evaluate_scores(
            result.get("dimension_scores"),
            result.get("gate_results"),
            request["evaluation_policy"],
            [],
        )
    except EvaluationPolicyValidationError as exc:
        errors.append(f"$.result.evaluation: {exc}")
        return
    if result.get("overall_score") != expected["overall_score"]:
        errors.append("$.result.overall_score: must match evaluation policy output")
    if result.get("verdict") != expected["verdict"]:
        errors.append("$.result.verdict: must match evaluation policy output")
    if result.get("blocked") != expected["blocked"]:
        errors.append("$.result.blocked: must match evaluation policy output")
    if result.get("blocking_gate_ids") != expected["blocking_gate_ids"]:
        errors.append("$.result.blocking_gate_ids: must match evaluation policy output")


def _match_shape(
    match: Any,
    path: str,
    errors: list[str],
    classification: str,
    extra_required: set[str] | None = None,
) -> bool:
    required = {
        "match_id",
        "job_requirement_ids",
        "profile_evidence_ids",
        "classification",
        "rationale",
        "confidence",
        "status",
    } | set(extra_required or set())
    allowed = required
    if not _object_shape(match, required, allowed, path, errors):
        return False
    _enum(match.get("classification"), {classification}, f"{path}.classification", errors)
    _nonempty_string(match.get("rationale"), f"{path}.rationale", errors)
    _nonempty_string(match.get("confidence"), f"{path}.confidence", errors)
    _enum(match.get("status"), STATUSES, f"{path}.status", errors)
    return True


def _validate_functional_basis(value: Any, path: str, errors: list[str]) -> None:
    if not _object_shape(
        value,
        {"responsibility_alignment", "competency_alignment", "title_similarity_only"},
        {"responsibility_alignment", "competency_alignment", "title_similarity_only"},
        path,
        errors,
    ):
        return
    responsibility_alignment = _string_list(
        value.get("responsibility_alignment"),
        f"{path}.responsibility_alignment",
        errors,
    )
    competency_alignment = _string_list(
        value.get("competency_alignment"),
        f"{path}.competency_alignment",
        errors,
    )
    if not responsibility_alignment and not competency_alignment:
        errors.append(
            f"{path}: at least one responsibility or competency alignment is required"
        )
    if value.get("title_similarity_only") is not False:
        errors.append(f"{path}.title_similarity_only: must be false")


def _validate_extension_ref(
    ref: Any,
    context: dict[str, Any],
    path: str,
    errors: list[str],
    *,
    expected_record_type: str | None = None,
    expected_record_id: Any = None,
) -> dict[str, Any] | None:
    if not _object_shape(
        ref,
        {"extension_id", "extension_version", "record_type", "record_id"},
        {"extension_id", "extension_version", "record_type", "record_id"},
        path,
        errors,
    ):
        return None
    extension_id = ref.get("extension_id")
    extension_version = ref.get("extension_version")
    record_type = ref.get("record_type")
    record_id = ref.get("record_id")
    _id(extension_id, f"{path}.extension_id", errors)
    _nonempty_string(extension_version, f"{path}.extension_version", errors)
    _enum(record_type, EXTENSION_RECORD_TYPES, f"{path}.record_type", errors)
    _id(record_id, f"{path}.record_id", errors)
    if not (
        isinstance(extension_id, str)
        and ID_RE.fullmatch(extension_id)
        and isinstance(extension_version, str)
        and extension_version.strip()
        and isinstance(record_type, str)
        and record_type in EXTENSION_RECORD_TYPES
        and isinstance(record_id, str)
        and ID_RE.fullmatch(record_id)
    ):
        return None
    key = (extension_id, extension_version)
    extension = context["extensions"].get(key)
    if extension is None:
        errors.append(f"{path}: unknown active extension {key[0]}@{key[1]}")
        return None
    if expected_record_type and record_type != expected_record_type:
        errors.append(f"{path}.record_type: must be {expected_record_type}")
    if expected_record_id is not None and record_id != expected_record_id:
        errors.append(f"{path}.record_id: must match transferable_mapping_id")
    if _extension_record(extension, record_type, record_id) is None:
        errors.append(f"{path}.record_id: unknown extension record id")
    return extension


def _extension_record(extension: dict[str, Any], record_type: Any, record_id: Any) -> dict[str, Any] | None:
    if not isinstance(extension, dict):
        return None
    if not isinstance(record_type, str) or not isinstance(record_id, str):
        return None
    collection = EXTENSION_RECORD_COLLECTIONS.get(record_type)
    if not collection:
        return None
    records = extension.get(collection, [])
    if not isinstance(records, list):
        return None
    for record in records:
        if isinstance(record, dict) and record.get("id") == record_id:
            return record
    return None


def _enforce_disallowed_boundaries(
    match: dict[str, Any],
    extension: dict[str, Any],
    path: str,
    errors: list[str],
) -> None:
    facts = match.get("asserts_candidate_facts", [])
    if not isinstance(facts, list):
        facts = []
    asserted = {
        fact.get("type")
        for fact in facts
        if isinstance(fact, dict) and isinstance(fact.get("type"), str)
    }
    records = extension.get("disallowed_mappings", [])
    if not isinstance(records, list):
        return
    for record in records:
        if not isinstance(record, dict):
            continue
        prohibited = record.get("prohibited_inference")
        if isinstance(prohibited, str) and prohibited in asserted:
            errors.append(
                f"{path}: transfer crosses prohibited inference boundary {prohibited!r}"
            )


def _preserve_mapping_safety_metadata(
    match: dict[str, Any],
    mapping: dict[str, Any],
    path: str,
    errors: list[str],
) -> None:
    for field in ("limitations", "conditions"):
        mapping_values = mapping.get(field, [])
        match_values = match.get(field, [])
        if not isinstance(mapping_values, list) or not isinstance(match_values, list):
            continue
        for value in mapping_values:
            if isinstance(value, str) and value not in match_values:
                errors.append(
                    f"{path}.{field}: must preserve mapping {field[:-1]} {value!r}"
                )


def _reject_extension_only_candidate_facts(
    value: Any,
    context: dict[str, Any],
    path: str,
    errors: list[str],
) -> None:
    for index, fact in enumerate(_list(value, f"{path}.asserts_candidate_facts", errors)):
        fact_path = f"{path}.asserts_candidate_facts[{index}]"
        if not _object_shape(
            fact,
            {"type", "profile_evidence_ids"},
            {"type", "profile_evidence_ids", "text"},
            fact_path,
            errors,
        ):
            continue
        fact_type = fact.get("type")
        _enum(fact_type, PROHIBITED_INFERENCES, f"{fact_path}.type", errors)
        profile_ids = _profile_refs(
            fact.get("profile_evidence_ids"),
            context,
            f"{fact_path}.profile_evidence_ids",
            errors,
            required=False,
        )
        if (
            isinstance(fact_type, str)
            and fact_type in PROFILE_FACT_INFERENCE_TYPES
            and not profile_ids
        ):
            errors.append(
                f"{fact_path}.profile_evidence_ids: candidate-specific facts require profile evidence"
            )
        if "text" in fact:
            _nonempty_string(fact.get("text"), f"{fact_path}.text", errors)


def _profile_refs(
    value: Any,
    context: dict[str, Any],
    path: str,
    errors: list[str],
    *,
    required: bool,
) -> list[str]:
    refs = _string_list(value, path, errors)
    if required and not refs:
        errors.append(f"{path}: at least one profile evidence reference is required")
    for ref in refs:
        if ref not in context["profile_ids"]:
            errors.append(f"{path}: unknown profile evidence id {ref!r}")
    return refs


def _job_refs(value: Any, context: dict[str, Any], path: str, errors: list[str], *, required: bool) -> None:
    refs = _string_list(value, path, errors)
    if required and not refs:
        errors.append(f"{path}: at least one job evidence reference is required")
    for ref in refs:
        if ref not in context["job_ids"]:
            errors.append(f"{path}: unknown job evidence id {ref!r}")


def _unique_id(value: Any, seen: set[str], path: str, errors: list[str]) -> None:
    _id(value, path, errors)
    if isinstance(value, str):
        if value in seen:
            errors.append(f"{path}: duplicate id {value!r}")
        seen.add(value)


def _object_shape(
    value: Any,
    required: set[str],
    allowed: set[str],
    path: str,
    errors: list[str],
) -> bool:
    if not isinstance(value, dict):
        errors.append(f"{path}: must be an object")
        return False
    for key in sorted(required - value.keys()):
        errors.append(f"{path}.{key}: required field is missing")
    for key in sorted(value.keys() - allowed):
        errors.append(f"{path}.{key}: unsupported field")
    return required <= value.keys()


def _list(value: Any, path: str, errors: list[str]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(f"{path}: must be an array")
        return []
    return value


def _string_list(value: Any, path: str, errors: list[str]) -> list[str]:
    items = _list(value, path, errors)
    result = []
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


def _id(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        errors.append(f"{path}: malformed identifier")


def _nonempty_string(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: must be a non-empty string")


def _enum(value: Any, allowed: set[str], path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or value not in allowed:
        errors.append(f"{path}: must be one of {', '.join(sorted(allowed))}")


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate Job Fit Contract v0 files")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_request = subparsers.add_parser("validate-request")
    validate_request.add_argument("request", type=Path)
    validate_result = subparsers.add_parser("validate-result")
    validate_result.add_argument("request", type=Path)
    validate_result.add_argument("result", type=Path)
    assemble = subparsers.add_parser("assemble")
    assemble.add_argument("request", type=Path)
    assemble.add_argument("analysis", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.command == "validate-request":
            validate_job_fit_request(_load_json(args.request))
            print(json.dumps({"valid": True, "contract": JOB_FIT_REQUEST_VERSION}))
        elif args.command == "validate-result":
            validate_job_fit_result(_load_json(args.request), _load_json(args.result))
            print(json.dumps({"valid": True, "contract": JOB_FIT_RESULT_VERSION}))
        else:
            result = build_job_fit_result(_load_json(args.request), _load_json(args.analysis))
            print(json.dumps(result, ensure_ascii=False, indent=2))
    except (
        JobFitValidationError,
        EvaluationPolicyValidationError,
        ExtensionValidationError,
        SnapshotValidationError,
        FileNotFoundError,
        OSError,
        UnicodeError,
        json.JSONDecodeError,
    ) as exc:
        errors = exc.errors if hasattr(exc, "errors") else [str(exc)]
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
