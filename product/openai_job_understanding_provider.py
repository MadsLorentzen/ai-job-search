"""OpenAI Responses adapter for the untrusted Job Understanding proposer.

Only extraction instructions, exact selected job text, requested categories,
and the strict response schema are serialized to OpenAI. Ticket 6 performs all
candidate validation, citation resolution, and evidence acceptance locally.
"""

from __future__ import annotations

import copy
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

from product.job_understanding import SCHEMA
from product.job_understanding_providers import (
    JobUnderstandingProviderError,
    ProviderCallAudit,
    ProviderResponse,
)


OPENAI_MODEL = "gpt-5.4-mini-2026-03-17"
OPENAI_MODEL_ID = "gpt-5.4-mini"
OPENAI_MODEL_VERSION = OPENAI_MODEL
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
MAX_SOURCE_CHARACTERS = 100_000
MAX_OUTPUT_TOKENS = 8_192
MAX_ATTEMPTS = 2
CONNECT_TIMEOUT_SECONDS = 5.0
REQUEST_TIMEOUT_SECONDS = 60.0
MAX_RETRY_AFTER_SECONDS = 15.0
DEFAULT_RETRY_DELAY_SECONDS = 1.0
OPENAI_RESPONSE_SCHEMA_NAME = "job_understanding_candidate_v0"
OPENAI_SCHEMA_MAX_PROPERTIES = 5_000
OPENAI_SCHEMA_MAX_DEPTH = 10
OPENAI_SCHEMA_MAX_TOTAL_STRING_LENGTH = 120_000
OPENAI_SCHEMA_MAX_ENUM_VALUES = 1_000
OPENAI_SCHEMA_LARGE_ENUM_THRESHOLD = 250
OPENAI_SCHEMA_MAX_LARGE_ENUM_STRING_LENGTH = 15_000
OPENAI_SUPPORTED_SCHEMA_TYPES = frozenset(
    {"string", "number", "boolean", "integer", "object", "array", "null"}
)
OPENAI_SUPPORTED_SCHEMA_KEYWORDS = frozenset(
    {
        "$defs",
        "$ref",
        "additionalProperties",
        "anyOf",
        "enum",
        "items",
        "maxItems",
        "maximum",
        "minimum",
        "multipleOf",
        "pattern",
        "properties",
        "required",
        "type",
    }
)
# The product validator remains authoritative for these constraints. They are
# intentionally omitted only from the strict OpenAI Structured Outputs schema.
OPENAI_PRODUCT_ONLY_SCHEMA_KEYWORDS = frozenset({"minLength", "maxLength"})
OPENAI_SCHEMA_DIAGNOSTIC_KEYWORDS = frozenset(
    OPENAI_PRODUCT_ONLY_SCHEMA_KEYWORDS
    | {
        "allOf",
        "dependentRequired",
        "dependentSchemas",
        "else",
        "if",
        "not",
        "oneOf",
        "patternProperties",
        "then",
        "uniqueItems",
    }
)
OPTIONAL_PRODUCT_FIELDS = frozenset(
    {
        ("providerItem", "occurrence"),
        ("reviewProposal", "category"),
        ("reviewProposal", "kind"),
        ("reviewProposal", "occurrence"),
    }
)

ClientFactory = Callable[[str], Any]
Clock = Callable[[], float]
UtcNow = Callable[[], datetime]
Sleeper = Callable[[float], None]


class OpenAIJobUnderstandingProvider:
    """One bounded OpenAI call implementing ``JobUnderstandingProvider``."""

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
            "OpenAIJobUnderstandingProvider("
            f"model_version={self.model_version!r}, max_attempts={MAX_ATTEMPTS})"
        )

    def extract(self, request: dict[str, Any]) -> ProviderResponse:
        self.last_audit = None
        api_key = self._credential()
        source_text, instructions, categories = _hosted_inputs(request)
        if len(source_text) > MAX_SOURCE_CHARACTERS:
            raise JobUnderstandingProviderError(
                f"openai input exceeds {MAX_SOURCE_CHARACTERS} Unicode code points"
            )

        wire_schema = openai_candidate_schema()
        call = openai_call_parameters(
            instructions=instructions,
            source_text=source_text,
            requested_categories=categories,
            response_schema=wire_schema,
        )
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
                failure = _classify_exception(exc)
                if not failure["retryable"] or attempt_count >= MAX_ATTEMPTS:
                    diagnostic = _live_api_diagnostic(exc, self._environ)
                    raise JobUnderstandingProviderError(
                        f"openai provider failed: {failure['category']}{diagnostic}"
                    ) from None
                self._sleep(_retry_delay(exc))

        elapsed_ms = max(0, round((self._clock() - started) * 1000))
        _validate_response_model(response)
        payload = _decode_response(response)
        response_id = _safe_identifier(getattr(response, "id", None))
        usage = _usage(response)
        audit = ProviderCallAudit(
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            provider_response_id=response_id,
            started_at=started_at,
            elapsed_ms=elapsed_ms,
            attempt_count=attempt_count,
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            total_tokens=usage["total_tokens"],
            local_request_id=_local_string(request.get("request_id")),
            source_content_id=_local_string(request.get("source", {}).get("content_id")),
        )
        self.last_audit = audit
        return ProviderResponse(payload=payload, response_id=response_id, audit=audit)

    def _credential(self) -> str:
        value = self._environ.get(OPENAI_API_KEY_ENV)
        if not isinstance(value, str) or not value.strip():
            raise JobUnderstandingProviderError(
                f"openai provider is not configured: {OPENAI_API_KEY_ENV} is missing or blank"
            )
        return value.strip()

    def _make_client(self, api_key: str) -> Any:
        try:
            return self._client_factory(api_key)
        except JobUnderstandingProviderError:
            raise
        except Exception:
            raise JobUnderstandingProviderError(
                "openai provider client initialization failed"
            ) from None


def _default_client_factory(api_key: str) -> Any:
    try:
        import openai
    except ImportError:
        raise JobUnderstandingProviderError(
            "openai provider dependency is unavailable"
        ) from None
    return openai.OpenAI(
        api_key=api_key,
        max_retries=0,
        timeout=openai.Timeout(
            REQUEST_TIMEOUT_SECONDS,
            connect=CONNECT_TIMEOUT_SECONDS,
        ),
    )


def openai_call_parameters(
    *,
    instructions: str,
    source_text: str,
    requested_categories: list[str],
    response_schema: dict[str, Any],
) -> dict[str, Any]:
    """Return the exact minimized parameters serialized through the SDK."""

    model_input = json.dumps(
        {
            "selected_job_text": source_text,
            "requested_categories": requested_categories,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return {
        "model": OPENAI_MODEL,
        "instructions": instructions,
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


def openai_candidate_schema() -> dict[str, Any]:
    """Derive the strict OpenAI-dialect wire schema from the product schema."""

    root = copy.deepcopy(SCHEMA["$defs"]["candidateResponse"])
    reachable = _reachable_definitions(root)
    definitions = {
        name: copy.deepcopy(SCHEMA["$defs"][name])
        for name in sorted(reachable)
    }
    discovered_optional = {
        (name, field)
        for name, definition in definitions.items()
        if isinstance(definition.get("properties"), dict)
        for field in definition["properties"]
        if field not in set(definition.get("required", []))
    }
    if discovered_optional != OPTIONAL_PRODUCT_FIELDS:
        raise JobUnderstandingProviderError(
            "openai response schema optional-field parity check failed"
        )
    converted_defs = {
        name: _require_and_nullable(schema, definition_name=name)
        for name, schema in definitions.items()
    }
    converted_root = _require_and_nullable(root, definition_name="candidateResponse")
    converted_root["$defs"] = converted_defs
    wire_schema = _project_openai_schema(converted_root)
    _validate_openai_schema(wire_schema)
    return wire_schema


def normalize_openai_candidate(value: Any) -> Any:
    """Remove null only where the authoritative product schema allows omission."""

    candidate = copy.deepcopy(value)
    if not isinstance(candidate, dict):
        return candidate
    for item in candidate.get("items", []) if isinstance(candidate.get("items"), list) else []:
        if isinstance(item, dict) and item.get("occurrence", object()) is None:
            item.pop("occurrence")
    for collection in ("suggestions", "ambiguous_statements"):
        proposals = candidate.get(collection, [])
        if not isinstance(proposals, list):
            continue
        for proposal in proposals:
            if not isinstance(proposal, dict):
                continue
            for field in ("category", "kind", "occurrence"):
                if proposal.get(field, object()) is None:
                    proposal.pop(field)
    return candidate


def _hosted_inputs(request: Any) -> tuple[str, str, list[str]]:
    try:
        source_text = request["source"]["text"]
        instructions = request["policy"]["instructions"]
        categories = request["requested_categories"]
    except (KeyError, TypeError):
        raise JobUnderstandingProviderError(
            "openai provider received a malformed internal request"
        ) from None
    if not isinstance(source_text, str) or not source_text.strip():
        raise JobUnderstandingProviderError("openai provider source text is missing")
    if not isinstance(instructions, str) or not instructions.strip():
        raise JobUnderstandingProviderError("openai provider instructions are missing")
    if not isinstance(categories, list) or not all(isinstance(item, str) for item in categories):
        raise JobUnderstandingProviderError("openai provider categories are malformed")
    return source_text, instructions, copy.deepcopy(categories)


def _reachable_definitions(schema: Any) -> set[str]:
    found: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            reference = value.get("$ref")
            if isinstance(reference, str) and reference.startswith("#/$defs/"):
                name = reference.removeprefix("#/$defs/")
                if name not in found:
                    if name not in SCHEMA["$defs"]:
                        raise JobUnderstandingProviderError(
                            "openai response schema references an unknown product definition"
                        )
                    found.add(name)
                    visit(SCHEMA["$defs"][name])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(schema)
    return found


def _require_and_nullable(value: Any, *, definition_name: str) -> Any:
    if isinstance(value, list):
        return [
            _require_and_nullable(item, definition_name=definition_name)
            for item in value
        ]
    if not isinstance(value, dict):
        return copy.deepcopy(value)
    converted = {
        key: _require_and_nullable(item, definition_name=definition_name)
        for key, item in value.items()
        if key not in {"properties", "required"}
    }
    properties = value.get("properties")
    if isinstance(properties, dict):
        original_required = set(value.get("required", []))
        converted_properties: dict[str, Any] = {}
        for name, schema in properties.items():
            field_schema = _require_and_nullable(schema, definition_name=definition_name)
            if name not in original_required:
                if (definition_name, name) not in OPTIONAL_PRODUCT_FIELDS:
                    raise JobUnderstandingProviderError(
                        "openai schema translation found an unreviewed optional product field"
                    )
                field_schema = {"anyOf": [field_schema, {"type": "null"}]}
            converted_properties[name] = field_schema
        converted["properties"] = converted_properties
        converted["required"] = list(properties)
    elif "required" in value:
        converted["required"] = copy.deepcopy(value["required"])
    return converted


def _project_openai_schema(value: Any, *, path: str = "$") -> Any:
    """Project reviewed product-schema features into OpenAI's strict dialect."""

    if not isinstance(value, dict):
        raise JobUnderstandingProviderError(
            f"openai schema translation expected an object at {path}"
        )
    normalized = copy.deepcopy(value)
    if "const" in normalized:
        if "enum" in normalized:
            raise JobUnderstandingProviderError(
                f"openai schema translation found const and enum together at {path}"
            )
        literal = normalized.pop("const")
        primitive_type = _enum_primitive_type([literal], path=path)
        _ensure_declared_enum_type(normalized.get("type"), primitive_type, path=path)
        normalized["type"] = primitive_type
        normalized["enum"] = [literal]
    elif "enum" in normalized:
        primitive_type = _enum_primitive_type(normalized["enum"], path=path)
        _ensure_declared_enum_type(normalized.get("type"), primitive_type, path=path)
        normalized["type"] = primitive_type

    projected: dict[str, Any] = {}
    for keyword, child in normalized.items():
        if keyword in OPENAI_PRODUCT_ONLY_SCHEMA_KEYWORDS:
            continue
        if keyword not in OPENAI_SUPPORTED_SCHEMA_KEYWORDS:
            raise JobUnderstandingProviderError(
                f"openai schema translation found unreviewed keyword {keyword!r} at {path}"
            )
        if keyword in {"properties", "$defs"}:
            if not isinstance(child, dict):
                raise JobUnderstandingProviderError(
                    f"openai schema translation expected an object at {path}.{keyword}"
                )
            projected[keyword] = {
                name: _project_openai_schema(schema, path=f"{path}.{keyword}.{name}")
                for name, schema in child.items()
            }
        elif keyword == "items":
            projected[keyword] = _project_openai_schema(
                child, path=f"{path}.{keyword}"
            )
        elif keyword == "anyOf":
            if not isinstance(child, list):
                raise JobUnderstandingProviderError(
                    f"openai schema translation expected a list at {path}.{keyword}"
                )
            projected[keyword] = [
                _project_openai_schema(schema, path=f"{path}.{keyword}[{index}]")
                for index, schema in enumerate(child)
            ]
        else:
            projected[keyword] = copy.deepcopy(child)
    return projected


def _enum_primitive_type(values: Any, *, path: str) -> str:
    if not isinstance(values, list) or not values:
        raise JobUnderstandingProviderError(
            f"openai schema translation expected a non-empty enum at {path}"
        )
    primitive_types = {_json_primitive_type(item) for item in values}
    if None in primitive_types:
        raise JobUnderstandingProviderError(
            f"openai schema translation found a non-scalar enum value at {path}"
        )
    if primitive_types <= {"integer", "number"}:
        return "number" if "number" in primitive_types else "integer"
    if len(primitive_types) != 1:
        raise JobUnderstandingProviderError(
            f"openai schema translation found a mixed-type enum at {path}"
        )
    return primitive_types.pop()  # type: ignore[return-value]


def _json_primitive_type(value: Any) -> str | None:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    return None


def _ensure_declared_enum_type(
    declared: Any, inferred: str, *, path: str
) -> None:
    if declared is None:
        return
    if declared == inferred or (declared == "number" and inferred == "integer"):
        return
    raise JobUnderstandingProviderError(
        f"openai schema translation found an incompatible enum type at {path}"
    )


def _validate_openai_schema(schema: Any) -> None:
    """Fail locally if the generated wire schema violates our reviewed subset."""

    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise JobUnderstandingProviderError(
            "openai response schema preflight requires a root object"
        )
    definitions = schema.get("$defs", {})
    if not isinstance(definitions, dict):
        raise JobUnderstandingProviderError(
            "openai response schema preflight found malformed definitions"
        )

    property_count = 0
    enum_count = 0
    total_string_length = 0
    max_depth = 0

    def fail(message: str, path: str) -> None:
        raise JobUnderstandingProviderError(
            f"openai response schema preflight {message} at {path}"
        )

    def visit(node: Any, path: str, depth: int) -> None:
        nonlocal property_count, enum_count, total_string_length, max_depth
        if not isinstance(node, dict):
            fail("expected an object", path)
        max_depth = max(max_depth, depth)
        unknown = set(node) - OPENAI_SUPPORTED_SCHEMA_KEYWORDS
        if unknown:
            fail(f"found unsupported keyword {sorted(unknown)[0]!r}", path)

        reference = node.get("$ref")
        if reference is not None:
            if set(node) != {"$ref"}:
                fail("found a reference with sibling keywords", path)
            if not isinstance(reference, str) or not reference.startswith("#/$defs/"):
                fail("found an unsupported reference", path)
            if reference.removeprefix("#/$defs/") not in definitions:
                fail("found an unresolved local reference", path)
            return

        branches = node.get("anyOf")
        if branches is not None:
            if set(node) != {"anyOf"} or not isinstance(branches, list):
                fail("found a malformed nullable union", path)
            if len(branches) != 2:
                fail("requires exactly two nullable-union branches", path)
            null_branches = [
                branch for branch in branches
                if isinstance(branch, dict) and branch == {"type": "null"}
            ]
            if len(null_branches) != 1:
                fail("requires exactly one explicit null branch", path)
            for index, branch in enumerate(branches):
                visit(branch, f"{path}.anyOf[{index}]", depth + 1)
            return

        declared_type = node.get("type")
        if declared_type not in OPENAI_SUPPORTED_SCHEMA_TYPES:
            fail("requires an explicit supported type", path)

        enum_values = node.get("enum")
        if enum_values is not None:
            if not isinstance(enum_values, list) or not enum_values:
                fail("requires a non-empty enum", path)
            if any(not _value_matches_type(item, declared_type) for item in enum_values):
                fail("found enum values incompatible with their type", path)
            enum_count += len(enum_values)
            enum_strings = [item for item in enum_values if isinstance(item, str)]
            enum_string_length = sum(len(item) for item in enum_strings)
            total_string_length += enum_string_length
            if (
                len(enum_values) > OPENAI_SCHEMA_LARGE_ENUM_THRESHOLD
                and enum_string_length > OPENAI_SCHEMA_MAX_LARGE_ENUM_STRING_LENGTH
            ):
                fail("exceeded the large-enum string limit", path)

        properties = node.get("properties")
        if declared_type == "object":
            if not isinstance(properties, dict):
                fail("requires object properties", path)
            if node.get("additionalProperties") is not False:
                fail("requires additionalProperties=false", path)
            required = node.get("required")
            if not isinstance(required, list) or required != list(properties):
                fail("requires every property in deterministic required order", path)
            property_count += len(properties)
            total_string_length += sum(len(name) for name in properties)
            for name, child in properties.items():
                visit(child, f"{path}.properties.{name}", depth + 1)
        elif properties is not None or "required" in node or "additionalProperties" in node:
            fail("found object keywords on a non-object", path)

        if declared_type == "array":
            if "items" not in node:
                fail("requires array items", path)
            visit(node["items"], f"{path}.items", depth + 1)
        elif "items" in node or "maxItems" in node:
            fail("found array keywords on a non-array", path)

        if "pattern" in node and declared_type != "string":
            fail("found pattern on a non-string", path)
        if "minimum" in node and declared_type not in {"integer", "number"}:
            fail("found minimum on a non-number", path)

        nested_definitions = node.get("$defs")
        if nested_definitions is not None:
            if path != "$" or nested_definitions is not definitions:
                fail("found nested or malformed definitions", path)
            total_string_length += sum(len(name) for name in nested_definitions)
            for name, child in nested_definitions.items():
                visit(child, f"$.$defs.{name}", depth + 1)

    visit(schema, "$", 1)
    if property_count > OPENAI_SCHEMA_MAX_PROPERTIES:
        raise JobUnderstandingProviderError(
            "openai response schema preflight exceeded the property limit"
        )
    if max_depth > OPENAI_SCHEMA_MAX_DEPTH:
        raise JobUnderstandingProviderError(
            "openai response schema preflight exceeded the nesting-depth limit"
        )
    if total_string_length > OPENAI_SCHEMA_MAX_TOTAL_STRING_LENGTH:
        raise JobUnderstandingProviderError(
            "openai response schema preflight exceeded the total-string limit"
        )
    if enum_count > OPENAI_SCHEMA_MAX_ENUM_VALUES:
        raise JobUnderstandingProviderError(
            "openai response schema preflight exceeded the enum-value limit"
        )


def _value_matches_type(value: Any, declared_type: str) -> bool:
    actual_type = _json_primitive_type(value)
    return actual_type == declared_type or (
        declared_type == "number" and actual_type == "integer"
    )


def _decode_response(response: Any) -> Any:
    if response is None:
        raise JobUnderstandingProviderError("openai provider returned no response")
    if _has_refusal(response):
        raise JobUnderstandingProviderError("openai provider refused the extraction")
    status = getattr(response, "status", None)
    if status not in (None, "completed"):
        raise JobUnderstandingProviderError("openai provider returned an incomplete response")
    output_text = getattr(response, "output_text", None)
    if not isinstance(output_text, str) or not output_text.strip():
        raise JobUnderstandingProviderError("openai provider returned an empty response")
    try:
        decoded = json.loads(output_text)
    except (json.JSONDecodeError, TypeError):
        raise JobUnderstandingProviderError(
            "openai provider returned malformed structured JSON"
        ) from None
    return normalize_openai_candidate(decoded)


def _validate_response_model(response: Any) -> None:
    returned_model = getattr(response, "model", None)
    if returned_model is not None and returned_model != OPENAI_MODEL:
        raise JobUnderstandingProviderError(
            "openai provider returned an unexpected model identity"
        )


def _has_refusal(response: Any) -> bool:
    for output in getattr(response, "output", []) or []:
        for content in getattr(output, "content", []) or []:
            if getattr(content, "type", None) == "refusal":
                return True
    return False


def _usage(response: Any) -> dict[str, int | None]:
    usage = getattr(response, "usage", None)
    return {
        "input_tokens": _nonnegative_int(getattr(usage, "input_tokens", None)),
        "output_tokens": _nonnegative_int(getattr(usage, "output_tokens", None)),
        "total_tokens": _nonnegative_int(getattr(usage, "total_tokens", None)),
    }


def _nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _safe_identifier(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        return None
    return value


def _local_string(value: Any) -> str | None:
    if not isinstance(value, str) or not value or len(value) > 200:
        return None
    return value


def _classify_exception(exc: Exception) -> dict[str, Any]:
    name = type(exc).__name__
    status = getattr(exc, "status_code", None)
    if name in {"APIConnectionError", "APITimeoutError", "ConnectError", "ReadTimeout"}:
        return {"category": "transport", "retryable": True}
    if isinstance(status, int):
        if status in {408, 429} or 500 <= status <= 599:
            return {"category": f"http_{status}", "retryable": True}
        if status in {401, 403}:
            return {"category": "authentication", "retryable": False}
        return {"category": f"http_{status}", "retryable": False}
    return {"category": "sdk_error", "retryable": False}


def _live_api_diagnostic(exc: Exception, environ: Mapping[str, str]) -> str:
    """Return bounded schema diagnostics only for the opt-in live-test path."""

    if environ.get("RUN_OPENAI_LIVE_TESTS") != "1":
        return ""
    if getattr(exc, "status_code", None) != 400:
        return ""
    error = _api_error_fields(exc)
    details: list[str] = []
    for field in ("code", "param"):
        safe = _safe_diagnostic_token(error.get(field), limit=160)
        if safe is not None:
            details.append(f"{field}={safe}")
    message = error.get("message")
    if isinstance(message, str):
        for keyword in sorted(OPENAI_SCHEMA_DIAGNOSTIC_KEYWORDS):
            if keyword in message:
                details.append(f"schema_keyword={keyword}")
                break
    return f" [{'; '.join(details)}]" if details else ""


def _api_error_fields(exc: Exception) -> dict[str, Any]:
    fields = {
        "code": getattr(exc, "code", None),
        "param": getattr(exc, "param", None),
        "message": getattr(exc, "message", None),
    }
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        nested = body.get("error", body)
        if isinstance(nested, dict):
            for field in fields:
                if fields[field] is None:
                    fields[field] = nested.get(field)
    return fields


def _safe_diagnostic_token(value: Any, *, limit: int) -> str | None:
    if not isinstance(value, str) or not value or len(value) > limit:
        return None
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.$:-[]")
    if any(character not in allowed for character in value):
        return None
    return value


def _retry_delay(exc: Exception) -> float:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    value = headers.get("retry-after") if hasattr(headers, "get") else None
    try:
        delay = float(value)
    except (TypeError, ValueError):
        return DEFAULT_RETRY_DELAY_SECONDS
    return min(max(delay, 0.0), MAX_RETRY_AFTER_SECONDS)
