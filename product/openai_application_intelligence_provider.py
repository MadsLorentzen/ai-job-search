"""OpenAI Responses adapter for the untrusted Application Intelligence proposer.

Only the consumed Job Fit Result's structured fields, cited Profile Snapshot
claim summaries, and the strict atom-proposal response schema are serialized to
OpenAI. product.application_intelligence performs all atom validation, evidence-
preserving rendering, and claim acceptance locally. This provider's response
schema has no free-text field for candidate-bearing content -- only evidence id
selections, closed rendering_variant enums, and closed connective enums.
"""

from __future__ import annotations

import copy
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from product.application_intelligence import (
    ASSERTION_TYPES,
    CONNECTIVE_ALLOWLIST,
    PLAN_RATIONALE_KINDS,
    RENDERING_VARIANTS,
    TEMPLATE_TABLE,
    UNIT_TYPES,
    _compute_requirement_coverage,
)
from product.application_material_contract import substantive_completion_contract
from product.application_intelligence_providers import (
    ApplicationIntelligenceProviderError,
    ProviderCallAudit,
    ProviderResponse,
)


OPENAI_MODEL = "gpt-5.4-mini-2026-03-17"
OPENAI_MODEL_ID = "gpt-5.4-mini"
OPENAI_MODEL_VERSION = OPENAI_MODEL
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
MAX_OUTPUT_TOKENS = 4_096
MAX_ATTEMPTS = 2
CONNECT_TIMEOUT_SECONDS = 5.0
REQUEST_TIMEOUT_SECONDS = 60.0
OPENAI_RESPONSE_SCHEMA_NAME = "application_intelligence_atom_proposal_v1"
PROMPT_PATH = Path(__file__).with_name("prompts") / "application-intelligence.v0.txt"
INSTRUCTIONS = PROMPT_PATH.read_text(encoding="utf-8")

ClientFactory = Callable[[str], Any]
Clock = Callable[[], float]
UtcNow = Callable[[], datetime]
Sleeper = Callable[[float], None]


class OpenAIApplicationIntelligenceProvider:
    """One bounded OpenAI call implementing ``ApplicationIntelligenceProvider``."""

    provider_id = "openai"
    model_id = OPENAI_MODEL_ID
    model_version = OPENAI_MODEL_VERSION

    def __init__(
        self,
        *,
        environ: Mapping[str, str] | None = None,
        client_factory: ClientFactory | None = None,
        clock: Clock = time.monotonic,
        utc_now: UtcNow | None = None,
        sleep: Sleeper = time.sleep,
    ) -> None:
        self._environ = os.environ if environ is None else environ
        self._client_factory = client_factory or _default_client_factory
        self._clock = clock
        self._utc_now = utc_now or (lambda: datetime.now(timezone.utc))
        self._sleep = sleep
        self.last_audit: ProviderCallAudit | None = None

    def __repr__(self) -> str:
        return (
            "OpenAIApplicationIntelligenceProvider("
            f"model_version={self.model_version!r}, max_attempts={MAX_ATTEMPTS})"
        )

    def propose(self, request: dict[str, Any]) -> ProviderResponse:
        self.last_audit = None
        api_key = self._credential()
        model_input = _hosted_input(request)

        wire_schema = openai_atom_proposal_schema()
        call = openai_call_parameters(model_input=model_input, response_schema=wire_schema)
        client = self._make_client(api_key)
        started_at = self._utc_now().astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        started = self._clock()

        response = None
        attempt_count = 0
        for attempt_count in range(1, MAX_ATTEMPTS + 1):
            try:
                response = client.responses.create(**copy.deepcopy(call))
                break
            except Exception as exc:
                if attempt_count >= MAX_ATTEMPTS:
                    raise ApplicationIntelligenceProviderError(
                        f"openai application intelligence provider failed: {exc}"
                    ) from None
                self._sleep(1.0)

        elapsed_ms = max(0, round((self._clock() - started) * 1000))
        payload = _decode_response(response)
        response_id = getattr(response, "id", None)
        audit = ProviderCallAudit(
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            provider_response_id=response_id if isinstance(response_id, str) else None,
            started_at=started_at,
            elapsed_ms=elapsed_ms,
            attempt_count=attempt_count,
            local_request_id=request.get("request_id") if isinstance(request.get("request_id"), str) else None,
        )
        self.last_audit = audit
        return ProviderResponse(payload=payload, response_id=audit.provider_response_id, audit=audit)

    def _credential(self) -> str:
        value = self._environ.get(OPENAI_API_KEY_ENV)
        if not isinstance(value, str) or not value.strip():
            raise ApplicationIntelligenceProviderError(
                f"openai application intelligence provider is not configured: {OPENAI_API_KEY_ENV} is missing or blank"
            )
        return value.strip()

    def _make_client(self, api_key: str) -> Any:
        try:
            return self._client_factory(api_key)
        except ApplicationIntelligenceProviderError:
            raise
        except Exception:
            raise ApplicationIntelligenceProviderError(
                "openai application intelligence provider client initialization failed"
            ) from None


def _default_client_factory(api_key: str) -> Any:
    try:
        import openai
    except ImportError:
        raise ApplicationIntelligenceProviderError(
            "openai provider dependency is unavailable"
        ) from None
    return openai.OpenAI(
        api_key=api_key,
        max_retries=0,
        timeout=openai.Timeout(REQUEST_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
    )


def _hosted_input(request: dict[str, Any]) -> str:
    """Minimize the request to exactly what the provider needs: consumed Ticket 7
    matches/gaps (structured fields only, never rationale-as-authoritative-text
    beyond what Ticket 7 itself already exposes as audit context) and a summary
    of cited Profile Snapshot claims (category/field/value only, no source file
    paths or line numbers)."""

    job_fit_result = request["job_fit_result"]
    coverage = _compute_requirement_coverage(job_fit_result, [])
    profile_by_id = {claim["id"]: claim for claim in request["profile_snapshot"]["claims"]}
    job_evidence = request.get("resolved_job_evidence", {}).get("evidence", [])
    minimized = {
        "job_fit_result": {
            "status": job_fit_result["status"],
            "blocked": job_fit_result["blocked"],
            "direct_matches": job_fit_result["direct_matches"],
            "functionally_equivalent_matches": job_fit_result["functionally_equivalent_matches"],
            "transferable_matches": job_fit_result["transferable_matches"],
            "gaps": job_fit_result["gaps"],
        },
        "job_evidence": [
            {"id": item["id"], "category": item["category"], "text": item["text"]}
            for item in job_evidence
        ],
        "profile_claims": [
            {"id": claim_id, "category": claim["category"], "field": claim["field"], "value": claim["value"]}
            for claim_id, claim in profile_by_id.items()
            if not claim.get("placeholder")
        ],
        "available_assertion_types": sorted(ASSERTION_TYPES),
        "available_rendering_variants": sorted(RENDERING_VARIANTS),
        "available_rendering_templates": {
            assertion_type: sorted(
                variant
                for candidate_type, variant in TEMPLATE_TABLE
                if candidate_type == assertion_type
            )
            for assertion_type in sorted(ASSERTION_TYPES)
        },
        "available_unit_types": sorted(UNIT_TYPES),
        "completion_contract": substantive_completion_contract(),
        "coverage": coverage,
    }
    return json.dumps(minimized, ensure_ascii=False, separators=(",", ":"))


def openai_call_parameters(*, model_input: str, response_schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": OPENAI_MODEL,
        "instructions": INSTRUCTIONS,
        "input": model_input,
        "reasoning": {"effort": "low"},
        "text": {
            "format": {
                "type": "json_schema",
                "name": OPENAI_RESPONSE_SCHEMA_NAME,
                "strict": True,
                "schema": copy.deepcopy(response_schema),
            }
        },
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "store": False,
        "stream": False,
        "background": False,
        "tools": [],
        "truncation": "disabled",
    }


def openai_atom_proposal_schema() -> dict[str, Any]:
    """Strict OpenAI-dialect schema for atom proposals only.

    Deliberately narrower than the full Application Intelligence Result
    contract: no free-text field for candidate-bearing content anywhere in
    this schema. The provider can only select evidence ids, closed
    rendering_variant enum values, and closed connective enum values.
    """

    plan_entry_schema = {
        "type": "object",
        "properties": {
            "plan_id": {"type": "string"},
            "target_unit_type": {"type": "string", "enum": sorted(UNIT_TYPES)},
            "target_job_requirement_ids": {"type": "array", "items": {"type": "string"}},
            "rationale_kind": {"type": "string", "enum": sorted(PLAN_RATIONALE_KINDS)},
        },
        "required": ["plan_id", "target_unit_type", "target_job_requirement_ids", "rationale_kind"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "content_units": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "unit_id": {"type": "string"},
                        "unit_type": {"type": "string", "enum": sorted(UNIT_TYPES)},
                        "atoms": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "atom_id": {"type": "string"},
                                    "atom_kind": {"type": "string", "enum": ["candidate_fact", "job_reference", "transferability"]},
                                    "assertion_type": {"type": ["string", "null"], "enum": sorted(ASSERTION_TYPES) + [None]},
                                    "profile_evidence_ids": {"type": "array", "items": {"type": "string"}},
                                    "job_evidence_ids": {"type": "array", "items": {"type": "string"}},
                                    "job_fit_match_id": {"type": ["string", "null"]},
                                    "rendering_variant": {"type": "string", "enum": sorted(RENDERING_VARIANTS)},
                                },
                                "required": [
                                    "atom_id", "atom_kind", "assertion_type", "profile_evidence_ids",
                                    "job_evidence_ids", "job_fit_match_id", "rendering_variant",
                                ],
                                "additionalProperties": False,
                            },
                        },
                        "connectives": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "after_atom_index": {"type": "integer", "minimum": 0},
                                    "text": {"type": "string", "enum": sorted(CONNECTIVE_ALLOWLIST)},
                                },
                                "required": ["after_atom_index", "text"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["unit_id", "unit_type", "atoms", "connectives"],
                    "additionalProperties": False,
                },
            },
            "cv_emphasis_plan": {"type": "array", "items": plan_entry_schema},
            "cover_letter_plan": {"type": "array", "items": plan_entry_schema},
        },
        "required": ["content_units", "cv_emphasis_plan", "cover_letter_plan"],
        "additionalProperties": False,
    }


def _decode_response(response: Any) -> Any:
    text = getattr(response, "output_text", None)
    if not isinstance(text, str):
        raise ApplicationIntelligenceProviderError("openai response missing output_text")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ApplicationIntelligenceProviderError(f"openai response is not valid JSON: {exc}") from exc
