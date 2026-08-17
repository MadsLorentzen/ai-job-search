#!/usr/bin/env python3
"""Grounded Job Understanding / Evidence Extraction v0.

The provider is an untrusted proposer. Only exact quotes resolved and validated
by this module enter accepted evidence collections. The module performs no
candidate evaluation, semantic matching, networking, or persistence.

Job Snapshot validation/content identity comes from the isolated product-owned
Job Posting contract. This module never loads candidate, extension, or
evaluation-policy contracts.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

from product.job_posting import (
    JOB_POSTING_SNAPSHOT_VERSION,
    JobPostingValidationError,
    job_snapshot_content_id,
    validate_job_posting_snapshot,
)
from product.job_understanding_providers import (
    JobUnderstandingProvider,
    JobUnderstandingProviderError,
    ProviderResponse,
)


MODULE_DIR = Path(__file__).parent
SCHEMA_PATH = MODULE_DIR / "schemas" / "job-understanding.v0.schema.json"
POLICY_PATH = MODULE_DIR / "job-understanding-policy.v0.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
DEFAULT_POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))

REQUEST_VERSION = SCHEMA["$defs"]["requestVersion"]["const"]
CANDIDATE_VERSION = SCHEMA["$defs"]["candidateVersion"]["const"]
RESULT_VERSION = SCHEMA["$defs"]["resultVersion"]["const"]
POLICY_VERSION = SCHEMA["$defs"]["policyVersion"]["const"]
ID_RE = re.compile(SCHEMA["$defs"]["id"]["pattern"])
CONTENT_ID_RE = re.compile(SCHEMA["$defs"]["contentId"]["pattern"])
SOURCE_FIELDS = set(SCHEMA["$defs"]["sourceField"]["enum"])
EVIDENCE_CATEGORIES = tuple(SCHEMA["$defs"]["category"]["enum"])
REQUIREMENT_KINDS = set(SCHEMA["$defs"]["requirementKind"]["enum"])
CERTAINTY_LEVELS = set(SCHEMA["$defs"]["certainty"]["enum"])
RESULT_STATUSES = set(SCHEMA["$defs"]["resultStatus"]["enum"])
EVIDENCE_PREFIXES = {
    "requirements": "req",
    "responsibilities": "resp",
    "language_requirements": "lang",
    "eligibility_requirements": "elig",
    "logistics_requirements": "log",
}
ACCEPTED_EVIDENCE_ID_SEMANTICS = (
    "Content/integrity ID derived only from category, requirement kind, exact "
    "selected-source content ID, locally calculated citation start/end, and exact "
    "quoted text. Provider proposal/execution metadata, request IDs, timestamps, "
    "and ordering are excluded; this is not a durable database identifier."
)
MAX_PROVIDER_ITEMS = 500
MAX_REVIEW_ITEMS = 500
MAX_WARNINGS = 100
MAX_PROVIDER_TEXT_LENGTH = 20_000


class JobUnderstandingValidationError(ValueError):
    """Raised for malformed or ungrounded Job Understanding data."""

    def __init__(self, errors: str | Iterable[str]):
        if isinstance(errors, str):
            self.errors = [errors]
        else:
            self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def load_job_understanding_policy(path: str | Path | None = None) -> dict[str, Any]:
    """Load and validate the passive extraction policy."""

    policy_path = Path(path) if path is not None else POLICY_PATH
    try:
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise JobUnderstandingValidationError(f"$.policy: could not load policy: {exc}") from exc
    validate_job_understanding_policy(policy)
    return policy


def validate_job_understanding_policy(policy: Any) -> None:
    errors: list[str] = []
    required = {
        "schema_version",
        "id",
        "source_priority",
        "evidence_categories",
        "requirement_kinds",
        "certainty_levels",
        "result_statuses",
        "prompt",
        "rules",
    }
    if not _object_shape(policy, required, required, "$.policy", errors):
        raise JobUnderstandingValidationError(errors)
    if policy.get("schema_version") != POLICY_VERSION:
        errors.append(f"$.policy.schema_version: expected {POLICY_VERSION!r}")
    _id(policy.get("id"), "$.policy.id", errors)
    _ordered_string_list(
        policy.get("source_priority"),
        ["raw_text", "description"],
        "$.policy.source_priority",
        errors,
    )
    _exact_string_list(policy.get("evidence_categories"), list(EVIDENCE_CATEGORIES), "$.policy.evidence_categories", errors)
    _exact_string_list(policy.get("requirement_kinds"), sorted(REQUIREMENT_KINDS), "$.policy.requirement_kinds", errors)
    _exact_string_list(policy.get("certainty_levels"), sorted(CERTAINTY_LEVELS), "$.policy.certainty_levels", errors)
    _exact_string_list(policy.get("result_statuses"), sorted(RESULT_STATUSES), "$.policy.result_statuses", errors)

    prompt = policy.get("prompt")
    if _object_shape(prompt, {"id", "version", "path"}, {"id", "version", "path"}, "$.policy.prompt", errors):
        _id(prompt.get("id"), "$.policy.prompt.id", errors)
        _nonempty_string(prompt.get("version"), "$.policy.prompt.version", errors)
        _nonempty_string(prompt.get("path"), "$.policy.prompt.path", errors)
        expected_prompt = {
            "id": "job-understanding-extraction",
            "version": "v0",
            "path": "prompts/job-understanding.v0.txt",
        }
        if prompt != expected_prompt:
            errors.append("$.policy.prompt: must identify the product-owned v0 prompt")

    expected_rules = {
        "posting_text_is_untrusted_data": True,
        "exact_quotes_required": True,
        "fuzzy_quote_matching": False,
        "provider_offsets_authoritative": False,
        "silence_means_absent": False,
        "semantic_deduplication": False,
        "accepted_certainty": "explicit",
    }
    rules = policy.get("rules")
    if _object_shape(rules, set(expected_rules), set(expected_rules), "$.policy.rules", errors):
        for key, expected in expected_rules.items():
            if rules.get(key) != expected:
                errors.append(f"$.policy.rules.{key}: must be {expected!r}")
    if errors:
        raise JobUnderstandingValidationError(errors)


def policy_content_id(policy: dict[str, Any]) -> str:
    validate_job_understanding_policy(policy)
    return _content_id("jupolicy", policy)


def source_content_id(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        raise JobUnderstandingValidationError("$.source.text: must be a non-empty string")
    return f"jobtext_{hashlib.sha256(text.encode('utf-8')).hexdigest()}"


def build_job_understanding_request(
    job_snapshot: Any,
    request_id: Any,
    *,
    requested_categories: Iterable[str] | None = None,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an immutable extraction request from one Job Posting Snapshot."""

    _validate_job_snapshot(job_snapshot)
    errors: list[str] = []
    _id(request_id, "$.request_id", errors)
    if errors:
        raise JobUnderstandingValidationError(errors)
    active_policy = copy.deepcopy(policy if policy is not None else DEFAULT_POLICY)
    validate_job_understanding_policy(active_policy)
    categories = _requested_categories(requested_categories)
    source = _select_source(job_snapshot, active_policy)
    request = {
        "schema_version": REQUEST_VERSION,
        "request_id": request_id,
        "job_snapshot": _job_identity(job_snapshot),
        "source": source,
        "policy": _policy_identity(active_policy),
        "requested_categories": categories,
        "preserved_evidence": {
            category: [item["id"] for item in job_snapshot.get(category, [])]
            for category in EVIDENCE_CATEGORIES
        },
    }
    validate_job_understanding_request(job_snapshot, request, policy=active_policy)
    return request


def validate_job_understanding_request(
    job_snapshot: Any,
    request: Any,
    *,
    policy: dict[str, Any] | None = None,
) -> None:
    """Validate a request against the exact current Job Posting Snapshot."""

    _validate_job_snapshot(job_snapshot)
    active_policy = policy if policy is not None else DEFAULT_POLICY
    validate_job_understanding_policy(active_policy)
    errors: list[str] = []
    required = {
        "schema_version",
        "request_id",
        "job_snapshot",
        "source",
        "policy",
        "requested_categories",
        "preserved_evidence",
    }
    if not _object_shape(request, required, required, "$", errors):
        raise JobUnderstandingValidationError(errors)
    if request.get("schema_version") != REQUEST_VERSION:
        errors.append(f"$.schema_version: expected {REQUEST_VERSION!r}")
    _id(request.get("request_id"), "$.request_id", errors)
    if request.get("job_snapshot") != _job_identity(job_snapshot):
        errors.append("$.job_snapshot: must identify the exact supplied Job Posting Snapshot")
    if request.get("policy") != _policy_identity(active_policy):
        errors.append("$.policy: must identify the exact extraction policy and prompt")
    _validate_requested_category_list(request.get("requested_categories"), errors)
    expected_source = _select_source(job_snapshot, active_policy)
    _validate_source(request.get("source"), "$.source", errors)
    if request.get("source") != expected_source:
        errors.append("$.source: must match deterministic source selection")
    _validate_preserved_evidence(job_snapshot, request.get("preserved_evidence"), errors)
    if errors:
        raise JobUnderstandingValidationError(errors)


def validate_provider_candidate(request: dict[str, Any], candidate: Any) -> None:
    """Validate untrusted candidate JSON before any proposal is processed."""

    errors: list[str] = []
    required = {"schema_version", "items", "suggestions", "ambiguous_statements", "warnings"}
    if not _object_shape(candidate, required, required, "$.candidate", errors):
        raise JobUnderstandingValidationError(errors)
    if candidate.get("schema_version") != CANDIDATE_VERSION:
        errors.append(f"$.candidate.schema_version: expected {CANDIDATE_VERSION!r}")
    requested = set(request.get("requested_categories", []))
    proposal_ids: set[str] = set()
    _validate_candidate_items(candidate.get("items"), requested, proposal_ids, errors)
    _validate_review_proposals(candidate.get("suggestions"), "suggestions", requested, proposal_ids, errors)
    _validate_review_proposals(
        candidate.get("ambiguous_statements"),
        "ambiguous_statements",
        requested,
        proposal_ids,
        errors,
    )
    warnings = _list(candidate.get("warnings"), "$.candidate.warnings", errors)
    if len(warnings) > MAX_WARNINGS:
        errors.append(f"$.candidate.warnings: must contain at most {MAX_WARNINGS} items")
    for index, warning in enumerate(warnings):
        _bounded_string(warning, f"$.candidate.warnings[{index}]", errors)
    if errors:
        raise JobUnderstandingValidationError(errors)


def extract_job_understanding(
    job_snapshot: Any,
    provider: JobUnderstandingProvider,
    request_id: Any,
    *,
    requested_categories: Iterable[str] | None = None,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run the provider-neutral extraction boundary and return a validated result."""

    active_policy = copy.deepcopy(policy if policy is not None else DEFAULT_POLICY)
    request = build_job_understanding_request(
        job_snapshot,
        request_id,
        requested_categories=requested_categories,
        policy=active_policy,
    )
    if request["source"] is None:
        result = _empty_result(request, status="UNAVAILABLE", execution=None)
        validate_job_understanding_result(job_snapshot, request, result, policy=active_policy)
        return result
    _validate_provider(provider)
    provider_request = _provider_request(request, active_policy)
    try:
        response = provider.extract(copy.deepcopy(provider_request))
    except JobUnderstandingProviderError:
        raise
    except Exception as exc:
        raise JobUnderstandingProviderError(f"provider execution failed: {type(exc).__name__}") from exc
    if not isinstance(response, ProviderResponse):
        raise JobUnderstandingProviderError("provider returned an unsupported response envelope")
    validate_provider_candidate(request, response.payload)
    result = _build_result(job_snapshot, request, response, provider)
    validate_job_understanding_result(job_snapshot, request, result, policy=active_policy)
    return result


def validate_job_understanding_result(
    job_snapshot: Any,
    request: Any,
    result: Any,
    *,
    policy: dict[str, Any] | None = None,
) -> None:
    """Validate a result against its exact request, source, policy, and snapshot."""

    active_policy = policy if policy is not None else DEFAULT_POLICY
    validate_job_understanding_request(job_snapshot, request, policy=active_policy)
    errors: list[str] = []
    required = {
        "schema_version",
        "request_id",
        "job_snapshot",
        "source",
        "policy",
        "execution",
        *EVIDENCE_CATEGORIES,
        "suggestions",
        "ambiguous_statements",
        "warnings",
        "reconciliation",
        "category_coverage",
        "status",
    }
    if not _object_shape(result, required, required, "$.result", errors):
        raise JobUnderstandingValidationError(errors)
    if result.get("schema_version") != RESULT_VERSION:
        errors.append(f"$.result.schema_version: expected {RESULT_VERSION!r}")
    if result.get("request_id") != request["request_id"]:
        errors.append("$.result.request_id: must match request")
    for field in ("job_snapshot", "source", "policy"):
        if result.get(field) != request[field]:
            errors.append(f"$.result.{field}: must match request")
    _validate_execution(result.get("execution"), request["source"] is None, errors)

    accepted_ids: set[str] = set()
    duplicate_links: dict[str, str] = {}
    proposal_ids: set[str] = set()
    for category in EVIDENCE_CATEGORIES:
        _validate_accepted_collection(
            result.get(category),
            category,
            request,
            job_snapshot,
            accepted_ids,
            duplicate_links,
            proposal_ids,
            errors,
        )
    _validate_result_review_records(result.get("suggestions"), "suggestions", proposal_ids, request, errors)
    _validate_result_review_records(
        result.get("ambiguous_statements"), "ambiguous_statements", proposal_ids, request, errors
    )
    _validate_result_warnings(result.get("warnings"), errors)
    _validate_reconciliation(
        result.get("reconciliation"), duplicate_links, job_snapshot, errors
    )
    _validate_coverage(result.get("category_coverage"), request, result, errors)
    _enum(result.get("status"), RESULT_STATUSES, "$.result.status", errors)
    expected_status = _result_status(result, request["source"] is None)
    if result.get("status") != expected_status:
        errors.append(f"$.result.status: must be {expected_status!r} for this result")
    if errors:
        raise JobUnderstandingValidationError(errors)


def _build_result(
    job_snapshot: dict[str, Any],
    request: dict[str, Any],
    response: ProviderResponse,
    provider: JobUnderstandingProvider,
) -> dict[str, Any]:
    candidate = response.payload
    rejection_counts: dict[str, int] = {}
    result = _empty_result(
        request,
        status="READY",
        execution={
            "provider_id": provider.provider_id,
            "model_id": provider.model_id,
            "model_version": provider.model_version,
            **({"provider_response_id": response.response_id} if response.response_id is not None else {}),
        },
    )
    accepted_ids: set[str] = set()
    for proposal in candidate["items"]:
        citation = _resolve_quote(request["source"], proposal["quote"], proposal.get("occurrence"))
        if citation is None:
            _count_rejection(rejection_counts, "ambiguous_quote_occurrence")
            continue
        if proposal["certainty"] != "explicit":
            result["suggestions"].append(
                _review_record(
                    proposal,
                    "provider marked proposal as ambiguous",
                    citation,
                    request["source"],
                )
            )
            continue
        item_id = _accepted_item_id(proposal["category"], proposal["kind"], citation)
        if item_id in accepted_ids:
            raise JobUnderstandingValidationError(
                f"$.candidate.items: duplicate grounded extraction {item_id!r}"
            )
        accepted_ids.add(item_id)
        accepted = {
            "id": item_id,
            "proposal_id": proposal["proposal_id"],
            "text": proposal["quote"],
            "kind": proposal["kind"],
            "certainty": "explicit",
            "extraction_status": "ACCEPTED",
            "citations": [citation],
        }
        duplicate = _exact_explicit_duplicate(job_snapshot, proposal)
        if duplicate is not None:
            accepted["exact_duplicate_of"] = duplicate
            result["reconciliation"].append(
                {
                    "type": "EXACT_DUPLICATE",
                    "extracted_evidence_id": item_id,
                    "explicit_evidence_id": duplicate,
                }
            )
        result[proposal["category"]].append(accepted)

    for field in ("suggestions", "ambiguous_statements"):
        for proposal in candidate[field]:
            citation = _resolve_quote(
                request["source"], proposal["quote"], proposal.get("occurrence")
            )
            if citation is None:
                _count_rejection(rejection_counts, "ambiguous_quote_occurrence")
                continue
            result[field].append(
                _review_record(proposal, proposal["reason"], citation, request["source"])
            )
    result["warnings"].extend(_aggregated_rejection_warnings(rejection_counts))
    if candidate["warnings"]:
        result["warnings"].append(
            f"Provider returned {len(candidate['warnings'])} warning message(s); "
            "their ungrounded content was not retained."
        )
    result["category_coverage"] = [
        {
            "category": category,
            "status": "PROCESSED",
            "accepted_count": len(result[category]),
        }
        for category in request["requested_categories"]
    ]
    result["status"] = _result_status(result, False)
    return result


def _empty_result(
    request: dict[str, Any],
    *,
    status: str,
    execution: dict[str, Any] | None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schema_version": RESULT_VERSION,
        "request_id": request["request_id"],
        "job_snapshot": copy.deepcopy(request["job_snapshot"]),
        "source": copy.deepcopy(request["source"]),
        "policy": copy.deepcopy(request["policy"]),
        "execution": copy.deepcopy(execution),
        "suggestions": [],
        "ambiguous_statements": [],
        "warnings": [],
        "reconciliation": [],
        "category_coverage": [],
        "status": status,
    }
    for category in EVIDENCE_CATEGORIES:
        result[category] = []
    return result


def _provider_request(request: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    prompt_path = MODULE_DIR / policy["prompt"]["path"]
    try:
        instructions = prompt_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise JobUnderstandingValidationError(f"$.policy.prompt.path: could not read prompt: {exc}") from exc
    return {
        "schema_version": "job-understanding-provider-request.v0",
        "request_id": request["request_id"],
        "source": copy.deepcopy(request["source"]),
        "requested_categories": copy.deepcopy(request["requested_categories"]),
        "candidate_schema_version": CANDIDATE_VERSION,
        "policy": {
            "id": request["policy"]["id"],
            "version": request["policy"]["schema_version"],
            "prompt_id": request["policy"]["prompt_id"],
            "prompt_version": request["policy"]["prompt_version"],
            "instructions": instructions,
        },
    }


def _select_source(job_snapshot: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any] | None:
    for field in policy["source_priority"]:
        value = job_snapshot.get(field)
        if isinstance(value, str) and value.strip():
            return {
                "field": field,
                "content_id": source_content_id(value),
                "character_length": len(value),
                "text": value,
            }
    return None


def _resolve_quote(
    source: dict[str, Any], quote: str, occurrence: int | None
) -> dict[str, Any] | None:
    text = source["text"]
    starts = _exact_occurrence_starts(text, quote)
    if not starts:
        raise JobUnderstandingValidationError(
            "$.candidate: proposed quote does not occur exactly in selected source"
        )
    if occurrence is not None and (
        isinstance(occurrence, bool)
        or not isinstance(occurrence, int)
        or occurrence < 0
    ):
        raise JobUnderstandingValidationError("$.candidate: occurrence must be a non-negative integer")
    if len(starts) == 1:
        canonical_occurrence = 0
    else:
        if occurrence is None:
            return None
        if occurrence >= len(starts):
            raise JobUnderstandingValidationError(
                "$.candidate: occurrence is outside exact quote matches"
            )
        canonical_occurrence = occurrence
    start = starts[canonical_occurrence]
    end = start + len(quote)
    return {
        "source_field": source["field"],
        "source_content_id": source["content_id"],
        "start": start,
        "end": end,
        "quote": quote,
        "occurrence": canonical_occurrence,
    }


def _exact_occurrence_starts(text: str, quote: str) -> list[int]:
    """Return overlapping exact-match starts in deterministic source order."""

    starts: list[int] = []
    cursor = 0
    while True:
        position = text.find(quote, cursor)
        if position < 0:
            break
        starts.append(position)
        cursor = position + 1
    return starts


def _review_record(
    proposal: dict[str, Any],
    reason: str,
    citation: dict[str, Any],
    source: dict[str, Any],
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": _review_id(proposal, reason),
        "proposal_id": proposal["proposal_id"],
        "text": proposal.get("text", proposal.get("quote")),
        "reason": reason,
        "grounding_status": "EXACT",
        "source_field": source["field"],
        "source_content_id": source["content_id"],
        "citation": citation,
    }
    for field in ("category", "kind"):
        if field in proposal:
            record[field] = proposal[field]
    return record


def _count_rejection(counts: dict[str, int], reason: str) -> None:
    counts[reason] = counts.get(reason, 0) + 1


def _aggregated_rejection_warnings(counts: dict[str, int]) -> list[str]:
    """Return bounded local summaries without provider IDs or assertion text."""

    warnings: list[str] = []
    ambiguous_count = counts.get("ambiguous_quote_occurrence", 0)
    if ambiguous_count:
        warnings.append(
            f"{ambiguous_count} provider proposal(s) were not retained because "
            "the exact quote occurrence was ambiguous."
        )
    return warnings


def _accepted_item_id(category: str, kind: str, citation: dict[str, Any]) -> str:
    """Hash stable grounded content only; never provider/run/request metadata."""

    material = {
        "category": category,
        "kind": kind,
        "source_content_id": citation["source_content_id"],
        "start": citation["start"],
        "end": citation["end"],
        "quote": citation["quote"],
    }
    digest = _digest(material, 20)
    return f"juev_{EVIDENCE_PREFIXES[category]}_{digest}"


def _review_id(proposal: dict[str, Any], reason: str) -> str:
    return f"jureview_{_digest({'proposal': proposal, 'reason': reason}, 20)}"


def _exact_explicit_duplicate(job_snapshot: dict[str, Any], proposal: dict[str, Any]) -> str | None:
    for item in job_snapshot.get(proposal["category"], []):
        if item.get("kind") == proposal["kind"] and item.get("text") == proposal["quote"]:
            return item["id"]
    return None


def _policy_identity(policy: dict[str, Any]) -> dict[str, Any]:
    prompt_path = MODULE_DIR / policy["prompt"]["path"]
    try:
        prompt_text = prompt_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise JobUnderstandingValidationError(f"$.policy.prompt.path: could not read prompt: {exc}") from exc
    return {
        "schema_version": policy["schema_version"],
        "id": policy["id"],
        "content_id": policy_content_id(policy),
        "prompt_id": policy["prompt"]["id"],
        "prompt_version": policy["prompt"]["version"],
        "prompt_content_id": f"juprompt_{hashlib.sha256(prompt_text.encode('utf-8')).hexdigest()}",
    }


def _job_identity(job_snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": job_snapshot["schema_version"],
        "job_id": job_snapshot["job_id"],
        "content_id": job_snapshot_content_id(job_snapshot),
    }


def _validate_job_snapshot(job_snapshot: Any) -> None:
    try:
        validate_job_posting_snapshot(job_snapshot)
    except JobPostingValidationError as exc:
        raise JobUnderstandingValidationError(f"$.job_snapshot: {exc}") from exc


def _requested_categories(values: Iterable[str] | None) -> list[str]:
    if values is None:
        return list(EVIDENCE_CATEGORIES)
    if isinstance(values, (str, bytes, dict)):
        raise JobUnderstandingValidationError("$.requested_categories: must be an array")
    try:
        items = list(values)
    except TypeError as exc:
        raise JobUnderstandingValidationError("$.requested_categories: must be an array") from exc
    errors: list[str] = []
    _validate_requested_category_list(items, errors)
    if errors:
        raise JobUnderstandingValidationError(errors)
    return items


def _validate_requested_category_list(value: Any, errors: list[str]) -> None:
    items = _list(value, "$.requested_categories", errors)
    if not items:
        errors.append("$.requested_categories: must not be empty")
    seen: set[str] = set()
    for index, item in enumerate(items):
        _enum(item, set(EVIDENCE_CATEGORIES), f"$.requested_categories[{index}]", errors)
        if isinstance(item, str):
            if item in seen:
                errors.append(f"$.requested_categories[{index}]: duplicate category")
            seen.add(item)


def _validate_source(value: Any, path: str, errors: list[str]) -> None:
    if value is None:
        return
    required = {"field", "content_id", "character_length", "text"}
    if not _object_shape(value, required, required, path, errors):
        return
    _enum(value.get("field"), SOURCE_FIELDS, f"{path}.field", errors)
    _content_id_value(value.get("content_id"), f"{path}.content_id", errors)
    _nonempty_string(value.get("text"), f"{path}.text", errors)
    length = value.get("character_length")
    if isinstance(length, bool) or not isinstance(length, int) or length < 1:
        errors.append(f"{path}.character_length: must be a positive integer")
    if isinstance(value.get("text"), str):
        if length != len(value["text"]):
            errors.append(f"{path}.character_length: must equal source text length")
        try:
            expected = source_content_id(value["text"])
        except JobUnderstandingValidationError:
            expected = None
        if expected is not None and value.get("content_id") != expected:
            errors.append(f"{path}.content_id: must hash the exact source text")


def _validate_preserved_evidence(
    job_snapshot: dict[str, Any], value: Any, errors: list[str]
) -> None:
    if not _object_shape(
        value, set(EVIDENCE_CATEGORIES), set(EVIDENCE_CATEGORIES), "$.preserved_evidence", errors
    ):
        return
    for category in EVIDENCE_CATEGORIES:
        expected = [item["id"] for item in job_snapshot.get(category, [])]
        if value.get(category) != expected:
            errors.append(f"$.preserved_evidence.{category}: must preserve source evidence IDs")


def _validate_candidate_items(
    value: Any,
    requested: set[str],
    proposal_ids: set[str],
    errors: list[str],
) -> None:
    items = _list(value, "$.candidate.items", errors)
    if len(items) > MAX_PROVIDER_ITEMS:
        errors.append(f"$.candidate.items: must contain at most {MAX_PROVIDER_ITEMS} items")
    required = {"proposal_id", "category", "kind", "quote", "certainty"}
    allowed = required | {"occurrence"}
    for index, item in enumerate(items):
        path = f"$.candidate.items[{index}]"
        if not _object_shape(item, required, allowed, path, errors):
            continue
        _proposal_id(item.get("proposal_id"), f"{path}.proposal_id", proposal_ids, errors)
        category = item.get("category")
        _enum(category, set(EVIDENCE_CATEGORIES), f"{path}.category", errors)
        if isinstance(category, str) and category in EVIDENCE_CATEGORIES and category not in requested:
            errors.append(f"{path}.category: was not requested")
        _enum(item.get("kind"), REQUIREMENT_KINDS, f"{path}.kind", errors)
        _bounded_string(item.get("quote"), f"{path}.quote", errors)
        _enum(item.get("certainty"), CERTAINTY_LEVELS, f"{path}.certainty", errors)
        if "occurrence" in item:
            _nonnegative_integer(item.get("occurrence"), f"{path}.occurrence", errors)


def _validate_review_proposals(
    value: Any,
    field: str,
    requested: set[str],
    proposal_ids: set[str],
    errors: list[str],
) -> None:
    path = f"$.candidate.{field}"
    items = _list(value, path, errors)
    if len(items) > MAX_REVIEW_ITEMS:
        errors.append(f"{path}: must contain at most {MAX_REVIEW_ITEMS} items")
    required = {"proposal_id", "text", "reason", "quote"}
    allowed = required | {"category", "kind", "occurrence"}
    for index, item in enumerate(items):
        item_path = f"{path}[{index}]"
        if not _object_shape(item, required, allowed, item_path, errors):
            continue
        _proposal_id(item.get("proposal_id"), f"{item_path}.proposal_id", proposal_ids, errors)
        _bounded_string(item.get("text"), f"{item_path}.text", errors)
        _bounded_string(item.get("reason"), f"{item_path}.reason", errors)
        if "category" in item:
            category = item.get("category")
            _enum(category, set(EVIDENCE_CATEGORIES), f"{item_path}.category", errors)
            if isinstance(category, str) and category in EVIDENCE_CATEGORIES and category not in requested:
                errors.append(f"{item_path}.category: was not requested")
        if "kind" in item:
            _enum(item.get("kind"), REQUIREMENT_KINDS, f"{item_path}.kind", errors)
        _bounded_string(item.get("quote"), f"{item_path}.quote", errors)
        if "occurrence" in item:
            _nonnegative_integer(item.get("occurrence"), f"{item_path}.occurrence", errors)


def _proposal_id(value: Any, path: str, seen: set[str], errors: list[str]) -> None:
    _id(value, path, errors)
    if isinstance(value, str):
        if value in seen:
            errors.append(f"{path}: duplicate proposal id {value!r}")
        seen.add(value)


def _validate_provider(provider: Any) -> None:
    errors: list[str] = []
    for field in ("provider_id", "model_id", "model_version"):
        _id(getattr(provider, field, None), f"$.provider.{field}", errors)
    if not callable(getattr(provider, "extract", None)):
        errors.append("$.provider.extract: must be callable")
    if errors:
        raise JobUnderstandingValidationError(errors)


def _validate_execution(value: Any, unavailable: bool, errors: list[str]) -> None:
    if unavailable:
        if value is not None:
            errors.append("$.result.execution: must be null when no provider executed")
        return
    required = {"provider_id", "model_id", "model_version"}
    allowed = required | {"provider_response_id"}
    if not _object_shape(value, required, allowed, "$.result.execution", errors):
        return
    for field in required:
        _id(value.get(field), f"$.result.execution.{field}", errors)
    if "provider_response_id" in value:
        _id(value.get("provider_response_id"), "$.result.execution.provider_response_id", errors)


def _validate_accepted_collection(
    value: Any,
    category: str,
    request: dict[str, Any],
    job_snapshot: dict[str, Any],
    accepted_ids: set[str],
    duplicate_links: dict[str, str],
    proposal_ids: set[str],
    errors: list[str],
) -> None:
    path = f"$.result.{category}"
    items = _list(value, path, errors)
    if items and category not in request["requested_categories"]:
        errors.append(f"{path}: contains evidence for an unrequested category")
    required = {"id", "proposal_id", "text", "kind", "certainty", "extraction_status", "citations"}
    allowed = required | {"exact_duplicate_of"}
    explicit_ids = {item["id"] for item in job_snapshot.get(category, [])}
    for index, item in enumerate(items):
        item_path = f"{path}[{index}]"
        if not _object_shape(item, required, allowed, item_path, errors):
            continue
        item_id = item.get("id")
        _id(item_id, f"{item_path}.id", errors)
        if isinstance(item_id, str):
            if item_id in accepted_ids:
                errors.append(f"{item_path}.id: duplicate accepted evidence id")
            accepted_ids.add(item_id)
        _proposal_id(item.get("proposal_id"), f"{item_path}.proposal_id", proposal_ids, errors)
        _nonempty_string(item.get("text"), f"{item_path}.text", errors)
        _enum(item.get("kind"), REQUIREMENT_KINDS, f"{item_path}.kind", errors)
        if item.get("certainty") != "explicit":
            errors.append(f"{item_path}.certainty: accepted evidence must be 'explicit'")
        if item.get("extraction_status") != "ACCEPTED":
            errors.append(f"{item_path}.extraction_status: accepted evidence must be 'ACCEPTED'")
        citations = _list(item.get("citations"), f"{item_path}.citations", errors)
        if len(citations) != 1:
            errors.append(f"{item_path}.citations: v0 accepted evidence requires exactly one citation")
        for citation_index, citation in enumerate(citations):
            _validate_citation(citation, request, f"{item_path}.citations[{citation_index}]", errors)
        if len(citations) == 1 and isinstance(citations[0], dict):
            citation = citations[0]
            if item.get("text") != citation.get("quote"):
                errors.append(f"{item_path}.text: must equal exact cited quote")
            if isinstance(item.get("kind"), str) and item["kind"] in REQUIREMENT_KINDS:
                try:
                    expected_id = _accepted_item_id(category, item["kind"], citation)
                except (KeyError, TypeError):
                    expected_id = None
                if expected_id is not None and item_id != expected_id:
                    errors.append(f"{item_path}.id: must be deterministic from grounded content")
        if "exact_duplicate_of" in item:
            duplicate = item.get("exact_duplicate_of")
            _id(duplicate, f"{item_path}.exact_duplicate_of", errors)
            if isinstance(duplicate, str) and duplicate not in explicit_ids:
                errors.append(f"{item_path}.exact_duplicate_of: unknown explicit evidence id")
            matches = [
                explicit
                for explicit in job_snapshot.get(category, [])
                if explicit.get("id") == duplicate
                and explicit.get("text") == item.get("text")
                and explicit.get("kind") == item.get("kind")
            ]
            if not matches:
                errors.append(f"{item_path}.exact_duplicate_of: must be an exact category/kind/text match")
            if isinstance(item_id, str) and isinstance(duplicate, str):
                duplicate_links[item_id] = duplicate


def _validate_citation(
    value: Any, request: dict[str, Any], path: str, errors: list[str]
) -> None:
    required = {"source_field", "source_content_id", "start", "end", "quote", "occurrence"}
    if not _object_shape(value, required, required, path, errors):
        return
    source = request.get("source")
    if not isinstance(source, dict):
        errors.append(f"{path}: citations require selected source text")
        return
    if value.get("source_field") != source["field"]:
        errors.append(f"{path}.source_field: must match request source")
    if value.get("source_content_id") != source["content_id"]:
        errors.append(f"{path}.source_content_id: stale or mismatched source")
    start = value.get("start")
    end = value.get("end")
    occurrence = value.get("occurrence")
    _nonnegative_integer(start, f"{path}.start", errors)
    _nonnegative_integer(end, f"{path}.end", errors)
    _nonnegative_integer(occurrence, f"{path}.occurrence", errors)
    _nonempty_string(value.get("quote"), f"{path}.quote", errors)
    if (
        isinstance(start, int) and not isinstance(start, bool)
        and isinstance(end, int) and not isinstance(end, bool)
        and isinstance(value.get("quote"), str)
    ):
        quote = value["quote"]
        if end <= start or end > len(source["text"]):
            errors.append(f"{path}: citation span is outside source bounds")
        elif end != start + len(quote):
            errors.append(f"{path}.end: must equal start plus exact quote length")
        elif source["text"][start:end] != quote:
            errors.append(f"{path}: citation quote does not match source span")
        if isinstance(occurrence, int) and not isinstance(occurrence, bool) and occurrence >= 0:
            starts = _exact_occurrence_starts(source["text"], quote)
            if occurrence >= len(starts):
                errors.append(f"{path}.occurrence: outside exact quote occurrences")
            elif starts[occurrence] != start:
                errors.append(f"{path}.occurrence: does not identify the cited source span")


def _validate_result_review_records(
    value: Any,
    field: str,
    proposal_ids: set[str],
    request: dict[str, Any],
    errors: list[str],
) -> None:
    path = f"$.result.{field}"
    items = _list(value, path, errors)
    required = {
        "id",
        "proposal_id",
        "text",
        "reason",
        "grounding_status",
        "source_field",
        "source_content_id",
        "citation",
    }
    allowed = required | {"category", "kind"}
    seen_ids: set[str] = set()
    for index, item in enumerate(items):
        item_path = f"{path}[{index}]"
        if not _object_shape(item, required, allowed, item_path, errors):
            continue
        _id(item.get("id"), f"{item_path}.id", errors)
        if isinstance(item.get("id"), str):
            if item["id"] in seen_ids:
                errors.append(f"{item_path}.id: duplicate review id")
            seen_ids.add(item["id"])
        _proposal_id(item.get("proposal_id"), f"{item_path}.proposal_id", proposal_ids, errors)
        _bounded_string(item.get("text"), f"{item_path}.text", errors)
        _bounded_string(item.get("reason"), f"{item_path}.reason", errors)
        if item.get("grounding_status") != "EXACT":
            errors.append(f"{item_path}.grounding_status: durable review material must be 'EXACT'")
        source = request.get("source")
        if not isinstance(source, dict):
            errors.append(f"{item_path}: review records require selected source")
            continue
        if item.get("source_field") != source["field"]:
            errors.append(f"{item_path}.source_field: must match request source")
        if item.get("source_content_id") != source["content_id"]:
            errors.append(f"{item_path}.source_content_id: must match request source")
        if "category" in item:
            _enum(item.get("category"), set(EVIDENCE_CATEGORIES), f"{item_path}.category", errors)
            if item.get("category") not in request["requested_categories"]:
                errors.append(f"{item_path}.category: was not requested")
        if "kind" in item:
            _enum(item.get("kind"), REQUIREMENT_KINDS, f"{item_path}.kind", errors)
        _validate_citation(item.get("citation"), request, f"{item_path}.citation", errors)


def _validate_result_warnings(value: Any, errors: list[str]) -> None:
    warnings = _list(value, "$.result.warnings", errors)
    if len(warnings) > MAX_WARNINGS:
        errors.append(f"$.result.warnings: must contain at most {MAX_WARNINGS} items")
    for index, warning in enumerate(warnings):
        _bounded_string(warning, f"$.result.warnings[{index}]", errors)


def _validate_reconciliation(
    value: Any,
    duplicate_links: dict[str, str],
    job_snapshot: dict[str, Any],
    errors: list[str],
) -> None:
    items = _list(value, "$.result.reconciliation", errors)
    explicit_ids = {
        item["id"]
        for category in EVIDENCE_CATEGORIES
        for item in job_snapshot.get(category, [])
    }
    seen: set[str] = set()
    required = {"type", "extracted_evidence_id", "explicit_evidence_id"}
    for index, item in enumerate(items):
        path = f"$.result.reconciliation[{index}]"
        if not _object_shape(item, required, required, path, errors):
            continue
        if item.get("type") != "EXACT_DUPLICATE":
            errors.append(f"{path}.type: v0 only supports 'EXACT_DUPLICATE'")
        extracted = item.get("extracted_evidence_id")
        explicit = item.get("explicit_evidence_id")
        if extracted not in duplicate_links:
            errors.append(f"{path}.extracted_evidence_id: unknown accepted evidence")
        if explicit not in explicit_ids:
            errors.append(f"{path}.explicit_evidence_id: unknown explicit evidence")
        key = f"{extracted}:{explicit}"
        if key in seen:
            errors.append(f"{path}: duplicate reconciliation record")
        seen.add(key)
        if isinstance(extracted, str) and duplicate_links.get(extracted) != explicit:
            errors.append(f"{path}: must match the accepted evidence duplicate link")
    expected = {f"{extracted}:{explicit}" for extracted, explicit in duplicate_links.items()}
    if seen != expected:
        errors.append("$.result.reconciliation: must contain every exact duplicate link once")


def _validate_coverage(
    value: Any,
    request: dict[str, Any],
    result: dict[str, Any],
    errors: list[str],
) -> None:
    items = _list(value, "$.result.category_coverage", errors)
    if request["source"] is None:
        if items:
            errors.append("$.result.category_coverage: must be empty when source is unavailable")
        return
    if len(items) != len(request["requested_categories"]):
        errors.append("$.result.category_coverage: must cover every requested category exactly once")
    seen: set[str] = set()
    for index, item in enumerate(items):
        path = f"$.result.category_coverage[{index}]"
        required = {"category", "status", "accepted_count"}
        if not _object_shape(item, required, required, path, errors):
            continue
        category = item.get("category")
        _enum(category, set(request["requested_categories"]), f"{path}.category", errors)
        if isinstance(category, str):
            if category in seen:
                errors.append(f"{path}.category: duplicate coverage category")
            seen.add(category)
        if item.get("status") != "PROCESSED":
            errors.append(f"{path}.status: must be 'PROCESSED'")
        count = item.get("accepted_count")
        _nonnegative_integer(count, f"{path}.accepted_count", errors)
        if category in EVIDENCE_CATEGORIES and count != len(result.get(category, [])):
            errors.append(f"{path}.accepted_count: must match accepted collection")


def _result_status(result: dict[str, Any], unavailable: bool) -> str:
    if unavailable:
        return "UNAVAILABLE"
    has_unknown = any(
        item.get("kind") == "unknown"
        for category in EVIDENCE_CATEGORIES
        for item in result.get(category, [])
        if isinstance(item, dict)
    )
    if result.get("suggestions") or result.get("ambiguous_statements") or result.get("warnings") or has_unknown:
        return "NEEDS_REVIEW"
    return "READY"


def _content_id(prefix: str, value: Any) -> str:
    try:
        canonical = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise JobUnderstandingValidationError(f"$.{prefix}: must be canonical JSON: {exc}") from exc
    return f"{prefix}_{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _digest(value: Any, length: int) -> str:
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:length]


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


def _id(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or ID_RE.fullmatch(value) is None:
        errors.append(f"{path}: must match the schema ID pattern")


def _content_id_value(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or CONTENT_ID_RE.fullmatch(value) is None:
        errors.append(f"{path}: must match the schema content-ID pattern")


def _nonempty_string(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: must be a non-empty string")


def _bounded_string(value: Any, path: str, errors: list[str]) -> None:
    _nonempty_string(value, path, errors)
    if isinstance(value, str) and len(value) > MAX_PROVIDER_TEXT_LENGTH:
        errors.append(f"{path}: exceeds maximum length {MAX_PROVIDER_TEXT_LENGTH}")


def _enum(value: Any, allowed: set[str], path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or value not in allowed:
        errors.append(f"{path}: must be one of {', '.join(sorted(allowed))}")


def _nonnegative_integer(value: Any, path: str, errors: list[str]) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        errors.append(f"{path}: must be a non-negative integer")


def _exact_string_list(value: Any, expected: list[str], path: str, errors: list[str]) -> None:
    items = _list(value, path, errors)
    if not all(isinstance(item, str) for item in items):
        errors.append(f"{path}: must contain only strings")
        return
    if set(items) != set(expected) or len(items) != len(expected):
        errors.append(f"{path}: must contain each schema-owned value exactly once")


def _ordered_string_list(value: Any, expected: list[str], path: str, errors: list[str]) -> None:
    items = _list(value, path, errors)
    if items != expected:
        errors.append(f"{path}: must equal {expected!r}")
