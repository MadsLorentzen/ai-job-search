"""Tests for the Ticket 8 provider-neutral boundary."""

import json
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
    INSTRUCTIONS,
    OpenAIApplicationIntelligenceProvider,
    openai_atom_proposal_schema,
    openai_call_parameters,
)


class TestOpenAIProviderSchema(unittest.TestCase):
    def test_provider_receives_the_locked_substantive_completion_contract(self):
        normalized = " ".join(INSTRUCTIONS.split())
        self.assertIn("at least 2 CV units", normalized)
        self.assertIn("at least 1 cv_bullet", normalized)
        self.assertIn("at least 20 normalized words", normalized)
        self.assertIn("at least 1 cover_letter_paragraph", normalized)
        self.assertIn("at least 40 normalized words", normalized)

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

    def test_schema_name_is_v1(self):
        from product.openai_application_intelligence_provider import OPENAI_RESPONSE_SCHEMA_NAME
        self.assertEqual(OPENAI_RESPONSE_SCHEMA_NAME, "application_intelligence_atom_proposal_v1")

    def test_schema_includes_typed_cv_emphasis_plan(self):
        schema = openai_atom_proposal_schema()
        self.assertIn("cv_emphasis_plan", schema["properties"])
        plan_schema = schema["properties"]["cv_emphasis_plan"]["items"]
        self.assertEqual(plan_schema["additionalProperties"], False)
        self.assertIn("rationale_kind", plan_schema["properties"])
        self.assertIn("covers_uncovered_requirement", plan_schema["properties"]["rationale_kind"]["enum"])

    def test_schema_includes_typed_cover_letter_plan(self):
        schema = openai_atom_proposal_schema()
        self.assertIn("cover_letter_plan", schema["properties"])

    def test_schema_still_forbids_free_text_fields(self):
        schema = openai_atom_proposal_schema()
        plan_props = schema["properties"]["cv_emphasis_plan"]["items"]["properties"]
        # plan_id and target_job_requirement_ids are opaque identifiers (a
        # provider-supplied id and references to job-posting-specific
        # requirement ids computed by Ticket 7's matching, respectively) --
        # not candidate-bearing prose -- exactly like content_units' existing
        # profile_evidence_ids/job_evidence_ids fields, which are also plain
        # string arrays rather than enums for the same reason.
        opaque_id_fields = {"plan_id", "target_job_requirement_ids"}
        for prop_name, prop_schema in plan_props.items():
            if prop_name in opaque_id_fields:
                continue
            self.assertIn("enum", prop_schema.get("items", prop_schema), f"{prop_name} must be enum-constrained, not free text")


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
        hosted_input = json.loads(recorded["kwargs"]["input"])
        self.assertEqual(
            hosted_input["available_rendering_templates"]["responsibility"],
            ["AS_STRENGTH", "PLAIN"],
        )
        self.assertEqual(
            hosted_input["available_rendering_templates"]["certification"], ["PLAIN"]
        )
        self.assertEqual(hosted_input["completion_contract"], {
            "version": "substantive-completion.v1",
            "minimum_cv_units": 2,
            "requires_cv_bullet": True,
            "minimum_cv_words": 20,
            "minimum_cover_letter_paragraphs": 1,
            "minimum_cover_letter_words": 40,
            "word_normalization": "NFKC; collapse Unicode whitespace; trim Unicode punctuation at token edges",
        })
        self.assertEqual(provider.last_audit.provider_id, "openai")


class TestPromptCoversLaneBAdditions(unittest.TestCase):
    def test_prompt_mentions_coverage(self):
        from product.openai_application_intelligence_provider import INSTRUCTIONS
        self.assertIn("coverage", INSTRUCTIONS.lower())

    def test_prompt_mentions_cv_emphasis_plan(self):
        from product.openai_application_intelligence_provider import INSTRUCTIONS
        self.assertIn("cv_emphasis_plan", INSTRUCTIONS)

    def test_prompt_mentions_rationale_kind(self):
        from product.openai_application_intelligence_provider import INSTRUCTIONS
        self.assertIn("rationale_kind", INSTRUCTIONS)

    def test_prompt_still_forbids_free_text(self):
        from product.openai_application_intelligence_provider import INSTRUCTIONS
        self.assertIn("Do not write free-text sentences", INSTRUCTIONS)


if __name__ == "__main__":
    unittest.main()
