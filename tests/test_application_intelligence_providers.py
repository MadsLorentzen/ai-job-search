"""Tests for the Ticket 8 provider-neutral boundary."""

import unittest

from product.application_intelligence_providers import (
    ApplicationIntelligenceProvider,
    DeterministicFakeProvider,
    ProviderResponse,
)


class TestDeterministicFakeProvider(unittest.TestCase):
    def test_returns_configured_payload_and_records_call(self):
        provider = DeterministicFakeProvider({"atoms": []})
        request = {"request_id": "req-1"}

        response = provider.propose(request)

        self.assertIsInstance(response, ProviderResponse)
        self.assertEqual(response.payload, {"atoms": []})
        self.assertEqual(response.response_id, "fake-response-v0")
        self.assertEqual(provider.calls, [request])

    def test_does_not_mutate_caller_payload_or_request(self):
        payload = {"atoms": [{"atom_id": "a1"}]}
        provider = DeterministicFakeProvider(payload)
        request = {"request_id": "req-1", "nested": {"x": 1}}

        response = provider.propose(request)
        response.payload["atoms"].append({"atom_id": "a2"})
        request["nested"]["x"] = 999

        self.assertEqual(payload, {"atoms": [{"atom_id": "a1"}]})
        self.assertEqual(provider.calls[0]["nested"]["x"], 1)

    def test_satisfies_protocol_structurally(self):
        provider = DeterministicFakeProvider({})
        self.assertIsInstance(provider, ApplicationIntelligenceProvider)


import os
import unittest
from unittest import mock

from product.application_intelligence_providers import ApplicationIntelligenceProviderError
from product.openai_application_intelligence_provider import (
    OpenAIApplicationIntelligenceProvider,
    openai_atom_proposal_schema,
    openai_call_parameters,
)


class TestOpenAIProviderSchema(unittest.TestCase):
    def test_atom_proposal_schema_has_no_free_text_field_for_content(self):
        schema = openai_atom_proposal_schema()
        atom_properties = schema["properties"]["content_units"]["items"]["properties"]["atoms"]["items"]["properties"]
        # The only string-typed fields are identifiers, kind/type enums, and
        # evidence-id references -- never a "text" or "rendered_text" field.
        self.assertNotIn("text", atom_properties)
        self.assertNotIn("rendered_text", atom_properties)

        # connectives[].text must be a closed enum, not free text, so the
        # OpenAI Structured Outputs API itself rejects non-allowlisted
        # connective strings at the wire level (defense-in-depth alongside
        # product.application_intelligence.CONNECTIVE_ALLOWLIST validation).
        connective_properties = schema["properties"]["content_units"]["items"]["properties"]["connectives"]["items"]["properties"]
        self.assertIn("enum", connective_properties["text"])

        # after_atom_index carries a wire-level minimum:0 as defense-in-depth
        # alongside product.application_intelligence._validate_connective_shape's
        # Python-side bounds check (negative indices are never structurally
        # valid regardless of how many atoms the unit has).
        self.assertEqual(connective_properties["after_atom_index"].get("minimum"), 0)

    def test_call_parameters_use_strict_structured_output(self):
        params = openai_call_parameters(model_input="{}", response_schema={"type": "object"})
        self.assertEqual(params["text"]["format"]["strict"], True)
        self.assertEqual(params["store"], False)


class TestOpenAIProviderCredential(unittest.TestCase):
    def test_missing_api_key_raises_provider_error(self):
        provider = OpenAIApplicationIntelligenceProvider(environ={})
        with self.assertRaises(ApplicationIntelligenceProviderError):
            provider.propose({
                "request_id": "r1",
                "job_fit_result": {},
                "resolved_job_evidence": {"evidence": []},
                "profile_snapshot": {"claims": []},
            })

    def test_present_api_key_reaches_client_factory(self):
        recorded = {}

        class FakeResponses:
            def create(self, **kwargs):
                recorded["kwargs"] = kwargs

                class FakeResponse:
                    id = "resp-123"
                    output_text = '{"content_units": []}'
                    usage = None

                return FakeResponse()

        class FakeClient:
            responses = FakeResponses()

        provider = OpenAIApplicationIntelligenceProvider(
            environ={"OPENAI_API_KEY": "test-key"},
            client_factory=lambda api_key: FakeClient(),
        )
        request = {
            "request_id": "r1",
            "job_fit_result": {
                "status": "READY", "blocked": False,
                "direct_matches": [], "functionally_equivalent_matches": [],
                "transferable_matches": [], "gaps": [],
            },
            "resolved_job_evidence": {"evidence": []},
            "profile_snapshot": {"claims": []},
        }

        response = provider.propose(request)

        self.assertEqual(response.payload, {"content_units": []})
        self.assertEqual(recorded["kwargs"]["model"], "gpt-5.4-mini-2026-03-17")
        self.assertEqual(provider.last_audit.provider_id, "openai")


if __name__ == "__main__":
    unittest.main()
