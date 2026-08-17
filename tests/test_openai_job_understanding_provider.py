from __future__ import annotations

import copy
import inspect
import json
import sys
import unittest
from datetime import datetime, timezone
from enum import Enum
from importlib.metadata import version
from pathlib import Path
from types import SimpleNamespace
from typing import Literal
from unittest.mock import patch

from product.job_understanding import (
    DEFAULT_POLICY,
    JobUnderstandingValidationError,
    SCHEMA,
    _provider_request,
    build_job_understanding_request,
    extract_job_understanding,
    validate_provider_candidate,
)
from product.job_understanding_providers import JobUnderstandingProviderError
from product.openai_job_understanding_provider import (
    MAX_OUTPUT_TOKENS,
    MAX_RETRY_AFTER_SECONDS,
    MAX_SOURCE_CHARACTERS,
    OPENAI_MODEL,
    OPENAI_PRODUCT_ONLY_SCHEMA_KEYWORDS,
    OPENAI_SUPPORTED_SCHEMA_KEYWORDS,
    OpenAIJobUnderstandingProvider,
    _validate_openai_schema,
    normalize_openai_candidate,
    openai_call_parameters,
    openai_candidate_schema,
)


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "tests" / "fixtures" / "job_understanding" / "job-snapshot.json"
SCHEMA_PATH = ROOT / "product" / "schemas" / "job-understanding.v0.schema.json"


def snapshot() -> dict:
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


def candidate(quote: str = "Python is required.") -> dict:
    return {
        "schema_version": "job-understanding-candidate.v0",
        "items": [
            {
                "proposal_id": "proposal-hosted-1",
                "category": "requirements",
                "kind": "required",
                "quote": quote,
                "certainty": "explicit",
            }
        ],
        "suggestions": [],
        "ambiguous_statements": [],
        "warnings": [],
    }


def internal_request(job: dict | None = None) -> dict:
    request = build_job_understanding_request(
        job or snapshot(), "hosted-test-request", requested_categories=["requirements"]
    )
    return _provider_request(request, DEFAULT_POLICY)


def response(payload: dict | str | None = None, **overrides):
    if isinstance(payload, dict):
        output_text = json.dumps(payload, ensure_ascii=False)
    else:
        output_text = payload
    values = {
        "id": "resp_test_123",
        "status": "completed",
        "output_text": output_text,
        "output": [],
        "usage": SimpleNamespace(input_tokens=101, output_tokens=42, total_tokens=143),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class FakeResponses:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(copy.deepcopy(kwargs))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeClient:
    def __init__(self, outcomes):
        self.responses = FakeResponses(outcomes)


def provider(outcomes, **kwargs):
    client = FakeClient(outcomes)
    times = iter([10.0, 10.125])
    environ = {"OPENAI_API_KEY": "test-secret-key"}
    if kwargs.get("live_debug"):
        environ["RUN_OPENAI_LIVE_TESTS"] = "1"
    instance = OpenAIJobUnderstandingProvider(
        environ=environ,
        client_factory=lambda _: client,
        clock=lambda: next(times),
        utc_now=lambda: datetime(2026, 8, 16, 12, 0, tzinfo=timezone.utc),
        sleep=kwargs.get("sleep", lambda _: None),
    )
    return instance, client


class OpenAISchemaTranslationTests(unittest.TestCase):
    def test_every_wire_enum_has_type_and_no_const_survives(self):
        enum_nodes = []

        def visit(node):
            self.assertNotIn("const", node)
            if "enum" in node:
                enum_nodes.append(node)
                self.assertIn("type", node)
            for keyword in ("properties", "$defs"):
                for child in node.get(keyword, {}).values():
                    visit(child)
            if "items" in node:
                visit(node["items"])
            for child in node.get("anyOf", []):
                visit(child)

        visit(openai_candidate_schema())
        self.assertGreaterEqual(len(enum_nodes), 4)

    def test_literal_and_enums_remain_exactly_constrained(self):
        definitions = openai_candidate_schema()["$defs"]
        self.assertEqual(
            definitions["candidateVersion"],
            {"type": "string", "enum": ["job-understanding-candidate.v0"]},
        )
        for name in ("category", "requirementKind", "certainty"):
            self.assertEqual(definitions[name]["type"], "string")
            self.assertEqual(definitions[name]["enum"], SCHEMA["$defs"][name]["enum"])

    def test_nullable_enum_is_exact_ref_plus_null(self):
        review = openai_candidate_schema()["$defs"]["reviewProposal"]
        for field, definition in (
            ("category", "category"),
            ("kind", "requirementKind"),
        ):
            self.assertEqual(
                review["properties"][field],
                {
                    "anyOf": [
                        {"$ref": f"#/$defs/{definition}"},
                        {"type": "null"},
                    ]
                },
            )

    def test_wire_scalar_shapes_match_official_sdk_strict_schema_patterns(self):
        from openai.lib._pydantic import to_strict_json_schema
        from pydantic import BaseModel

        class SDKCategory(str, Enum):
            REQUIREMENTS = "requirements"
            RESPONSIBILITIES = "responsibilities"

        class SDKShape(BaseModel):
            schema_version: Literal["job-understanding-candidate.v0"]
            category: SDKCategory
            optional_category: SDKCategory | None

        sdk_schema = to_strict_json_schema(SDKShape)
        sdk_literal = sdk_schema["properties"]["schema_version"]
        sdk_enum = sdk_schema["$defs"]["SDKCategory"]
        sdk_nullable = sdk_schema["properties"]["optional_category"]
        wire = openai_candidate_schema()

        self.assertEqual(sdk_literal["type"], "string")
        self.assertEqual(
            sdk_literal["const"], wire["$defs"]["candidateVersion"]["enum"][0]
        )
        self.assertEqual(sdk_enum["type"], wire["$defs"]["category"]["type"])
        self.assertEqual(sdk_enum["enum"], ["requirements", "responsibilities"])
        self.assertEqual(
            sdk_nullable["anyOf"][-1],
            wire["$defs"]["reviewProposal"]["properties"]["category"]["anyOf"][-1],
        )
        self.assertIn("$ref", sdk_schema["properties"]["category"])

    def test_wire_schema_contains_only_reviewed_openai_dialect_keywords(self):
        discovered = set()

        def visit(schema):
            self.assertIsInstance(schema, dict)
            for keyword, value in schema.items():
                discovered.add(keyword)
                if keyword in {"properties", "$defs"}:
                    for child in value.values():
                        visit(child)
                elif keyword == "items":
                    visit(value)
                elif keyword == "anyOf":
                    for child in value:
                        visit(child)

        visit(openai_candidate_schema())
        self.assertLessEqual(discovered, OPENAI_SUPPORTED_SCHEMA_KEYWORDS)
        self.assertTrue(discovered.isdisjoint(OPENAI_PRODUCT_ONLY_SCHEMA_KEYWORDS))
        self.assertNotIn("minLength", discovered)
        self.assertNotIn("maxLength", discovered)

    def test_removed_wire_constraints_remain_product_enforced(self):
        request = build_job_understanding_request(
            snapshot(), "product-constraints", requested_categories=["requirements"]
        )
        blank_quote = candidate()
        blank_quote["items"][0]["quote"] = ""
        oversized_warning = candidate()
        oversized_warning["warnings"] = ["x" * 20_001]
        for malformed in (blank_quote, oversized_warning):
            with self.subTest(malformed=malformed):
                with self.assertRaises(JobUnderstandingValidationError):
                    validate_provider_candidate(request, malformed)

    def test_projection_does_not_mutate_authoritative_product_schema(self):
        before = copy.deepcopy(SCHEMA)
        before_bytes = SCHEMA_PATH.read_bytes()
        openai_candidate_schema()
        self.assertEqual(SCHEMA, before)
        self.assertEqual(SCHEMA_PATH.read_bytes(), before_bytes)

    def test_schema_translation_fails_closed_for_unreviewed_keyword(self):
        candidate_schema = SCHEMA["$defs"]["candidateResponse"]
        with patch.dict(candidate_schema, {"title": "unreviewed"}):
            with self.assertRaises(JobUnderstandingProviderError) as error:
                openai_candidate_schema()
        self.assertIn("unreviewed keyword", str(error.exception))
        self.assertIn("title", str(error.exception))

    def test_preflight_rejects_malformed_wire_contracts(self):
        valid = openai_candidate_schema()
        cases = []

        missing_root_type = copy.deepcopy(valid)
        missing_root_type.pop("type")
        cases.append(missing_root_type)

        missing_required = copy.deepcopy(valid)
        missing_required["required"] = missing_required["required"][:-1]
        cases.append(missing_required)

        untyped_enum = copy.deepcopy(valid)
        untyped_enum["$defs"]["category"].pop("type")
        cases.append(untyped_enum)

        unresolved_ref = copy.deepcopy(valid)
        unresolved_ref["properties"]["schema_version"]["$ref"] = "#/$defs/missing"
        cases.append(unresolved_ref)

        malformed_nullable = copy.deepcopy(valid)
        malformed_nullable["$defs"]["reviewProposal"]["properties"]["category"] = {
            "anyOf": [{"$ref": "#/$defs/category"}, {"type": "string"}]
        }
        cases.append(malformed_nullable)

        unsupported = copy.deepcopy(valid)
        unsupported["title"] = "not reviewed"
        cases.append(unsupported)

        for malformed in cases:
            with self.subTest(malformed=malformed):
                with self.assertRaises(JobUnderstandingProviderError):
                    _validate_openai_schema(malformed)

    def test_preflight_enforces_provider_schema_limits(self):
        limits = (
            "OPENAI_SCHEMA_MAX_PROPERTIES",
            "OPENAI_SCHEMA_MAX_DEPTH",
            "OPENAI_SCHEMA_MAX_TOTAL_STRING_LENGTH",
            "OPENAI_SCHEMA_MAX_ENUM_VALUES",
        )
        for name in limits:
            with self.subTest(limit=name):
                with patch(
                    f"product.openai_job_understanding_provider.{name}", 0
                ):
                    with self.assertRaises(JobUnderstandingProviderError):
                        _validate_openai_schema(openai_candidate_schema())

    def test_product_validator_rejects_invalid_literal_and_enum_values(self):
        request = build_job_understanding_request(
            snapshot(), "enum-parity", requested_categories=["requirements"]
        )
        wrong_version = candidate()
        wrong_version["schema_version"] = "other"
        wrong_category = candidate()
        wrong_category["items"][0]["category"] = "arbitrary"
        wrong_kind = candidate()
        wrong_kind["items"][0]["kind"] = "arbitrary"
        wrong_certainty = candidate()
        wrong_certainty["items"][0]["certainty"] = "arbitrary"
        for malformed in (wrong_version, wrong_category, wrong_kind, wrong_certainty):
            with self.subTest(malformed=malformed):
                with self.assertRaises(JobUnderstandingValidationError):
                    validate_provider_candidate(request, malformed)

    def test_root_and_every_object_require_all_properties(self):
        schema = openai_candidate_schema()

        def visit(value):
            if isinstance(value, dict):
                if isinstance(value.get("properties"), dict):
                    self.assertEqual(list(value["properties"]), value["required"])
                    self.assertIs(value.get("additionalProperties"), False)
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(schema)

    def test_only_product_optional_fields_become_nullable(self):
        schema = openai_candidate_schema()
        item = schema["$defs"]["providerItem"]
        review = schema["$defs"]["reviewProposal"]
        self.assertEqual(item["properties"]["occurrence"]["anyOf"][-1], {"type": "null"})
        for field in ("category", "kind", "occurrence"):
            self.assertEqual(review["properties"][field]["anyOf"][-1], {"type": "null"})
        self.assertNotIn("anyOf", item["properties"]["quote"])

    def test_schema_is_derived_from_only_reachable_product_definitions(self):
        schema = openai_candidate_schema()
        self.assertEqual(
            set(schema["$defs"]),
            {"candidateVersion", "category", "certainty", "id", "providerItem", "requirementKind", "reviewProposal"},
        )
        self.assertEqual(
            schema["$defs"]["category"]["enum"],
            SCHEMA["$defs"]["category"]["enum"],
        )

    def test_null_normalization_removes_only_known_optional_fields(self):
        wire = candidate()
        wire["items"][0]["occurrence"] = None
        wire["suggestions"] = [
            {
                "proposal_id": "review-1",
                "text": "text",
                "reason": "reason",
                "quote": "quote",
                "category": None,
                "kind": None,
                "occurrence": None,
            }
        ]
        normalized = normalize_openai_candidate(wire)
        self.assertNotIn("occurrence", normalized["items"][0])
        for field in ("category", "kind", "occurrence"):
            self.assertNotIn(field, normalized["suggestions"][0])

    def test_normalized_candidate_still_uses_product_validator(self):
        request = build_job_understanding_request(
            snapshot(), "schema-parity", requested_categories=["requirements"]
        )
        validate_provider_candidate(request, normalize_openai_candidate(candidate()))

    def test_wire_projection_does_not_weaken_local_citation_grounding(self):
        instance, client = provider([response(candidate("fabricated requirement"))])
        with self.assertRaises(JobUnderstandingValidationError):
            extract_job_understanding(
                snapshot(),
                instance,
                "projection-grounding",
                requested_categories=["requirements"],
            )
        self.assertEqual(len(client.responses.calls), 1)


class OpenAIProviderTests(unittest.TestCase):
    def test_pinned_sdk_accepts_the_exact_responses_api_parameters(self):
        import openai

        self.assertEqual(version("openai"), "3.1.0")
        client = openai.OpenAI(api_key="offline-signature-check", max_retries=0)
        try:
            call = openai_call_parameters(
                instructions="instructions",
                source_text="Synthetic requirement.",
                requested_categories=["requirements"],
                response_schema=openai_candidate_schema(),
            )
            inspect.signature(client.responses.create).bind(**call)
        finally:
            client.close()

    def test_successful_response_and_locally_owned_audit(self):
        instance, client = provider([response(candidate())])
        result = instance.extract(internal_request())
        self.assertEqual(result.payload, candidate())
        self.assertEqual(result.response_id, "resp_test_123")
        self.assertEqual(result.audit.provider_id, "openai")
        self.assertEqual(result.audit.model_version, OPENAI_MODEL)
        self.assertEqual(result.audit.elapsed_ms, 125)
        self.assertEqual(result.audit.attempt_count, 1)
        self.assertEqual(result.audit.total_tokens, 143)
        self.assertEqual(result.audit.local_request_id, "hosted-test-request")
        self.assertEqual(
            result.audit.source_content_id,
            internal_request()["source"]["content_id"],
        )
        self.assertEqual(len(client.responses.calls), 1)

    def test_actual_serialized_model_data_is_minimized(self):
        request = internal_request()
        forbidden_values = [
            request["request_id"],
            request["source"]["content_id"],
            request["source"]["field"],
            str(request["source"]["character_length"]),
            request["policy"]["id"],
            request["policy"]["prompt_id"],
        ]
        instance, client = provider([response(candidate())])
        instance.extract(request)
        call = client.responses.calls[0]
        model_input = json.loads(call["input"])
        self.assertEqual(
            set(model_input), {"selected_job_text", "requested_categories"}
        )
        self.assertEqual(model_input["selected_job_text"], request["source"]["text"])
        self.assertEqual(model_input["requested_categories"], ["requirements"])
        serialized = json.dumps(call, ensure_ascii=False)
        for value in forbidden_values:
            self.assertNotIn(value, serialized)

    def test_pinned_bounded_stateless_configuration(self):
        instance, client = provider([response(candidate())])
        instance.extract(internal_request())
        call = client.responses.calls[0]
        self.assertEqual(call["model"], OPENAI_MODEL)
        self.assertEqual(call["reasoning"], {"effort": "low"})
        self.assertEqual(call["max_output_tokens"], MAX_OUTPUT_TOKENS)
        self.assertIs(call["store"], False)
        self.assertIs(call["stream"], False)
        self.assertIs(call["background"], False)
        self.assertEqual(call["tools"], [])
        self.assertEqual(call["truncation"], "disabled")
        self.assertNotIn("temperature", call)
        self.assertNotIn("previous_response_id", call)
        self.assertNotIn("metadata", call)
        self.assertTrue(call["text"]["format"]["strict"])

    def test_unexpected_returned_model_is_rejected(self):
        instance, client = provider(
            [response(candidate(), model="gpt-unexpected")]
        )
        with self.assertRaises(JobUnderstandingProviderError) as error:
            instance.extract(internal_request())
        self.assertIn("unexpected model", str(error.exception))
        self.assertEqual(len(client.responses.calls), 1)

    def test_api_key_is_read_from_environment_but_not_serialized_or_represented(self):
        captured = []
        client = FakeClient([response(candidate())])
        instance = OpenAIJobUnderstandingProvider(
            environ={"OPENAI_API_KEY": "highly-secret"},
            client_factory=lambda key: captured.append(key) or client,
        )
        instance.extract(internal_request())
        self.assertEqual(captured, ["highly-secret"])
        self.assertNotIn("highly-secret", repr(instance))
        self.assertNotIn("highly-secret", json.dumps(client.responses.calls[0]))

    def test_default_sdk_client_disables_retries_and_sets_connect_and_request_timeouts(self):
        client = FakeClient([response(candidate())])
        constructed = []
        fake_sdk = SimpleNamespace(
            Timeout=lambda total, **kwargs: (total, kwargs),
            OpenAI=lambda **kwargs: constructed.append(kwargs) or client,
        )
        instance = OpenAIJobUnderstandingProvider(
            environ={"OPENAI_API_KEY": "sdk-test-key"}
        )
        with patch.dict(sys.modules, {"openai": fake_sdk}):
            instance.extract(internal_request())
        self.assertEqual(constructed[0]["max_retries"], 0)
        self.assertEqual(constructed[0]["timeout"], (60.0, {"connect": 5.0}))
        self.assertEqual(constructed[0]["api_key"], "sdk-test-key")

    def test_missing_and_blank_credentials_fail_before_client_creation(self):
        for environ in ({}, {"OPENAI_API_KEY": "  "}):
            called = []
            instance = OpenAIJobUnderstandingProvider(
                environ=environ, client_factory=lambda key: called.append(key)
            )
            with self.assertRaises(JobUnderstandingProviderError) as error:
                instance.extract(internal_request())
            self.assertIn("OPENAI_API_KEY", str(error.exception))
            self.assertEqual(called, [])

    def test_credential_is_not_leaked_by_client_initialization_failure(self):
        def broken(key):
            raise RuntimeError(f"bad key {key}")

        instance = OpenAIJobUnderstandingProvider(
            environ={"OPENAI_API_KEY": "never-leak-me"}, client_factory=broken
        )
        with self.assertRaises(JobUnderstandingProviderError) as error:
            instance.extract(internal_request())
        self.assertNotIn("never-leak-me", str(error.exception))

    def test_oversized_source_fails_before_client_invocation_without_truncation(self):
        job = snapshot()
        job["raw_text"] = "x" * (MAX_SOURCE_CHARACTERS + 1)
        called = []
        instance = OpenAIJobUnderstandingProvider(
            environ={"OPENAI_API_KEY": "test"},
            client_factory=lambda key: called.append(key),
        )
        with self.assertRaises(JobUnderstandingProviderError) as error:
            instance.extract(internal_request(job))
        self.assertIn(str(MAX_SOURCE_CHARACTERS), str(error.exception))
        self.assertEqual(called, [])

    def test_exact_source_at_limit_is_not_truncated(self):
        job = snapshot()
        job["raw_text"] = "å" * MAX_SOURCE_CHARACTERS
        empty = candidate(quote="å")
        empty["items"][0]["occurrence"] = 0
        instance, client = provider([response(empty)])
        instance.extract(internal_request(job))
        self.assertEqual(
            json.loads(client.responses.calls[0]["input"])["selected_job_text"],
            job["raw_text"],
        )

    def test_transport_timeout_network_429_and_5xx_retry_once(self):
        exception_types = [
            type("APITimeoutError", (Exception,), {}),
            type("APIConnectionError", (Exception,), {}),
        ]
        failures = [cls("secret transport detail") for cls in exception_types]
        failures.extend([StatusError(429), StatusError(500), StatusError(503)])
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                sleeps = []
                instance, client = provider(
                    [failure, response(candidate())], sleep=sleeps.append
                )
                result = instance.extract(internal_request())
                self.assertEqual(len(client.responses.calls), 2)
                self.assertEqual(result.audit.attempt_count, 2)
                self.assertEqual(len(sleeps), 1)

    def test_retry_after_is_bounded(self):
        sleeps = []
        instance, _ = provider(
            [StatusError(429, retry_after="999"), response(candidate())],
            sleep=sleeps.append,
        )
        instance.extract(internal_request())
        self.assertEqual(sleeps, [MAX_RETRY_AFTER_SECONDS])

    def test_retry_limit_is_enforced_and_exception_detail_is_redacted(self):
        instance, client = provider([StatusError(500), StatusError(500)])
        with self.assertRaises(JobUnderstandingProviderError) as error:
            instance.extract(internal_request())
        self.assertEqual(len(client.responses.calls), 2)
        self.assertEqual(str(error.exception), "openai provider failed: http_500")

    def test_normal_4xx_and_authentication_are_not_retried(self):
        for status in (400, 401, 403, 404, 422):
            with self.subTest(status=status):
                instance, client = provider([StatusError(status)])
                with self.assertRaises(JobUnderstandingProviderError):
                    instance.extract(internal_request())
                self.assertEqual(len(client.responses.calls), 1)

    def test_live_debug_400_diagnostic_is_bounded_and_schema_specific(self):
        failure = StatusError(
            400,
            body={
                "error": {
                    "code": "invalid_json_schema",
                    "param": "text.format.schema",
                    "message": (
                        "Invalid schema near minLength; secret job text and auth must not leak"
                    ),
                }
            },
        )
        instance, _ = provider([failure], live_debug=True)
        with self.assertRaises(JobUnderstandingProviderError) as error:
            instance.extract(internal_request())
        rendered = str(error.exception)
        self.assertEqual(
            rendered,
            "openai provider failed: http_400 "
            "[code=invalid_json_schema; param=text.format.schema; schema_keyword=minLength]",
        )
        self.assertNotIn("secret job text", rendered)

    def test_normal_400_never_exposes_provider_error_details(self):
        failure = StatusError(
            400,
            body={
                "error": {
                    "code": "invalid_json_schema",
                    "param": "text.format.schema",
                    "message": "Invalid schema near minLength and private content",
                }
            },
        )
        instance, _ = provider([failure])
        with self.assertRaises(JobUnderstandingProviderError) as error:
            instance.extract(internal_request())
        self.assertEqual(str(error.exception), "openai provider failed: http_400")

    def test_refusal_incomplete_empty_and_malformed_outputs_are_not_retried(self):
        refusal = response(
            None,
            output=[SimpleNamespace(content=[SimpleNamespace(type="refusal", refusal="private")])],
        )
        cases = [
            refusal,
            response(None, status="incomplete"),
            response(""),
            response("not-json"),
        ]
        for outcome in cases:
            with self.subTest(outcome=outcome):
                instance, client = provider([outcome])
                with self.assertRaises(JobUnderstandingProviderError):
                    instance.extract(internal_request())
                self.assertEqual(len(client.responses.calls), 1)

    def test_model_cannot_spoof_execution_metadata(self):
        spoofed = candidate()
        spoofed["execution"] = {"provider_id": "attacker"}
        instance, client = provider([response(spoofed)])
        with self.assertRaises(JobUnderstandingValidationError):
            extract_job_understanding(
                snapshot(), instance, "spoof-test", requested_categories=["requirements"]
            )
        self.assertEqual(len(client.responses.calls), 1)

    def test_schema_invalid_candidate_is_not_retried(self):
        instance, client = provider([response({"schema_version": "wrong"})])
        with self.assertRaises(JobUnderstandingValidationError):
            extract_job_understanding(
                snapshot(), instance, "invalid-schema", requested_categories=["requirements"]
            )
        self.assertEqual(len(client.responses.calls), 1)

    def test_ungrounded_quote_is_rejected_locally_without_model_retry(self):
        instance, client = provider([response(candidate("fabricated requirement"))])
        with self.assertRaises(JobUnderstandingValidationError):
            extract_job_understanding(
                snapshot(), instance, "invalid-grounding", requested_categories=["requirements"]
            )
        self.assertEqual(len(client.responses.calls), 1)

    def test_successful_provider_integrates_with_normal_ticket_6_result(self):
        instance, _ = provider([response(candidate())])
        result = extract_job_understanding(
            snapshot(), instance, "hosted-integration", requested_categories=["requirements"]
        )
        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["requirements"][0]["text"], candidate()["items"][0]["quote"])
        self.assertEqual(result["execution"]["provider_id"], "openai")
        self.assertNotIn("audit", result)


class StatusError(Exception):
    def __init__(
        self,
        status_code: int,
        *,
        retry_after: str | None = None,
        body: dict | None = None,
    ):
        super().__init__(f"sensitive HTTP {status_code} body")
        self.status_code = status_code
        self.response = SimpleNamespace(headers={"retry-after": retry_after})
        self.body = body


if __name__ == "__main__":
    unittest.main()
