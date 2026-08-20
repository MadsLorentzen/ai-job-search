# webapp/services/openai_semantic_proposer_client.py
"""OpenAI Responses adapter for the untrusted semantic proposer.

Mirrors the verified pattern in product/openai_application_intelligence_provider.py:
pinned model/version, disabled SDK retries with explicit timeouts, a bounded
manual retry loop, strict JSON-schema structured output, and a dedicated
provider-error type raised on every failure path — never a silent fallback.

The response schema here is hand-authored (not derived from a product/ schema
file) because product/semantic_job_fit.py's proposal shape is a small,
self-contained fragment {matches, gates} that does not have its own standalone
JSON Schema file in product/ — it is validated inline by
_validate_semantic_proposals_shape. Keeping this schema hand-authored, small,
and directly matched against that validator (see Task 6's round-trip test)
is simpler and more auditable than deriving/filtering a larger schema file
the way Job Understanding and Application Intelligence do.
"""
from __future__ import annotations

import copy
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from webapp.services.semantic_proposer_errors import SemanticProposerProviderError

OPENAI_MODEL = "gpt-5.4-mini-2026-03-17"
OPENAI_MODEL_ID = "gpt-5.4-mini"
OPENAI_MODEL_VERSION = OPENAI_MODEL
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
MAX_OUTPUT_TOKENS = 4_096
MAX_ATTEMPTS = 2
CONNECT_TIMEOUT_SECONDS = 5.0
REQUEST_TIMEOUT_SECONDS = 60.0
OPENAI_RESPONSE_SCHEMA_NAME = "semantic_proposal_v0"
PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "semantic-proposer.v0.txt"
INSTRUCTIONS = PROMPT_PATH.read_text(encoding="utf-8")

# Hand-authored strict schema matching product/semantic_job_fit.py's
# _validate_semantic_proposals_shape exactly (verified: proposal_id,
# job_evidence_id, profile_evidence_ids, classification, rationale required
# per match; gate_id, status, reason, job_evidence_ids, profile_evidence_ids
# required==allowed per gate; extension_ref has extension_id, extension_version,
# record_type, record_id).
_EXTENSION_REF_SCHEMA = {
    "type": "object",
    "properties": {
        "extension_id": {"type": "string"},
        "extension_version": {"type": "string"},
        "record_type": {"type": "string", "enum": ["transferable_mapping"]},
        "record_id": {"type": "string"},
    },
    "required": ["extension_id", "extension_version", "record_type", "record_id"],
    "additionalProperties": False,
}

_FUNCTIONAL_BASIS_SCHEMA = {
    "type": "object",
    "properties": {
        "responsibility_alignment": {"type": "array", "items": {"type": "string"}},
        "competency_alignment": {"type": "array", "items": {"type": "string"}},
        "title_similarity_only": {"type": "boolean"},
    },
    "required": ["responsibility_alignment", "competency_alignment", "title_similarity_only"],
    "additionalProperties": False,
}

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "proposal_id": {"type": "string"},
                    "job_evidence_id": {"type": "string"},
                    "profile_evidence_ids": {"type": "array", "items": {"type": "string"}},
                    "classification": {"type": "string"},
                    "rationale": {"type": "string"},
                    "confidence": {"type": ["string", "null"]},
                    "functional_basis": {**_FUNCTIONAL_BASIS_SCHEMA, "type": ["object", "null"]},
                    "extension_ref": {**_EXTENSION_REF_SCHEMA, "type": ["object", "null"]},
                },
                # OpenAI structured-output strict mode requires every key in
                # "properties" to also appear in "required" (optional fields
                # are expressed by allowing null on the value's own schema,
                # not by omitting them from "required"). confidence,
                # functional_basis, and extension_ref are therefore listed as
                # required here but each accepts null — the proposer emits
                # null for whichever of these three genuinely don't apply to
                # a given match, and webapp/services/semantic_proposal_adapter.py's
                # _strip_forbidden pass-through leaves null values as-is;
                # product/semantic_job_fit.py's own validator (verified
                # against source) only inspects a key's presence via "in
                # match", so this code adds one line before returning from
                # OpenAISemanticProposerClient.complete() to drop any key
                # whose value is exactly None from each match dict before
                # they reach product/*, since Ticket 7's validator treats a
                # present-but-null optional key as a shape violation (it
                # calls _nonempty_string/_validate_extension_ref_shape
                # directly on whatever value is present, which rejects None).
                "required": ["proposal_id", "job_evidence_id", "profile_evidence_ids", "classification", "rationale",
                             "confidence", "functional_basis", "extension_ref"],
                "additionalProperties": False,
            },
        },
        "gates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "gate_id": {"type": "string", "enum": ["eligibility", "language", "location_logistics"]},
                    "status": {"type": "string", "enum": ["PASS", "FAIL", "FLAG", "UNVERIFIED", "NOT_APPLICABLE"]},
                    "reason": {"type": "string"},
                    "job_evidence_ids": {"type": "array", "items": {"type": "string"}},
                    "profile_evidence_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["gate_id", "status", "reason", "job_evidence_ids", "profile_evidence_ids"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["matches", "gates"],
    "additionalProperties": False,
}

ClientFactory = Callable[[str], Any]
Clock = Callable[[], float]
UtcNow = Callable[[], datetime]
Sleeper = Callable[[float], None]


class OpenAISemanticProposerClient:
    provider_id = "openai"
    model_id = OPENAI_MODEL_ID
    model_version = OPENAI_MODEL_VERSION

    def __init__(
        self, *, environ: Mapping[str, str] | None = None, client_factory: ClientFactory | None = None,
        clock: Clock = time.monotonic, utc_now: UtcNow | None = None, sleep: Sleeper = time.sleep,
    ) -> None:
        self._environ = os.environ if environ is None else environ
        self._client_factory = client_factory or _default_client_factory
        self._clock = clock
        self._utc_now = utc_now or (lambda: datetime.now(timezone.utc))
        self._sleep = sleep

    def complete(self, context: dict[str, Any]) -> dict[str, Any]:
        api_key = self._credential()
        client = self._make_client(api_key)
        call = {
            "model": OPENAI_MODEL,
            "instructions": INSTRUCTIONS,
            "input": json.dumps(context, ensure_ascii=False, separators=(",", ":")),
            "reasoning": {"effort": "low"},
            "text": {"format": {"type": "json_schema", "name": OPENAI_RESPONSE_SCHEMA_NAME,
                                 "strict": True, "schema": copy.deepcopy(_RESPONSE_SCHEMA)}},
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            "store": False, "stream": False, "background": False, "tools": [],
            "truncation": "disabled",
        }

        response = None
        last_exc: Exception | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = client.responses.create(**copy.deepcopy(call))
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                if attempt >= MAX_ATTEMPTS:
                    break
                self._sleep(1.0)

        if last_exc is not None:
            raise SemanticProposerProviderError(f"openai semantic proposer failed: {last_exc}") from None

        return _decode_response(response)

    def _credential(self) -> str:
        value = self._environ.get(OPENAI_API_KEY_ENV)
        if not isinstance(value, str) or not value.strip():
            raise SemanticProposerProviderError(
                f"openai semantic proposer is not configured: {OPENAI_API_KEY_ENV} is missing or blank"
            )
        return value.strip()

    def _make_client(self, api_key: str) -> Any:
        try:
            return self._client_factory(api_key)
        except SemanticProposerProviderError:
            raise
        except Exception:
            raise SemanticProposerProviderError("openai semantic proposer client initialization failed") from None


def _default_client_factory(api_key: str) -> Any:
    try:
        import openai
    except ImportError:
        raise SemanticProposerProviderError("openai provider dependency is unavailable") from None
    return openai.OpenAI(
        api_key=api_key, max_retries=0,
        timeout=openai.Timeout(REQUEST_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
    )


def _decode_response(response: Any) -> dict[str, Any]:
    text = getattr(response, "output_text", None)
    if not isinstance(text, str):
        raise SemanticProposerProviderError("openai response missing output_text")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SemanticProposerProviderError(f"openai response is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict) or "matches" not in parsed or "gates" not in parsed:
        raise SemanticProposerProviderError("openai response missing matches/gates")

    # OpenAI strict structured output requires confidence/functional_basis/
    # extension_ref to be present on every match (see _RESPONSE_SCHEMA's
    # comment above), with null standing in for "does not apply." Ticket 7's
    # real validator (product/semantic_job_fit.py, verified against source)
    # treats a present-but-null optional key as a shape violation — it calls
    # field-specific validators directly on whatever value is present rather
    # than skipping null values. Drop any such key whose value is exactly
    # None before returning, so downstream validation sees "key absent"
    # (matching Ticket 7's actual optional-field contract) rather than "key
    # present with value null."
    matches = []
    for match in parsed.get("matches", []):
        if not isinstance(match, dict):
            matches.append(match)
            continue
        matches.append({key: value for key, value in match.items() if value is not None})

    return {"matches": matches, "gates": parsed["gates"]}
