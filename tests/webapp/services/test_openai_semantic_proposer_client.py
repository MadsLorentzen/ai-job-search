import json

import pytest

from webapp.services.semantic_proposer_errors import SemanticProposerProviderError
from webapp.services.openai_semantic_proposer_client import OpenAISemanticProposerClient


class _FakeResponse:
    def __init__(self, text):
        self.output_text = text
        self.id = "resp_fake_1"


class _FakeResponses:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        next_item = self._responses.pop(0)
        if isinstance(next_item, Exception):
            raise next_item
        return next_item


class _FakeClient:
    def __init__(self, responses):
        self.responses = _FakeResponses(responses)


def _client(responses, environ=None):
    fake = _FakeClient(responses)
    return OpenAISemanticProposerClient(
        environ={"OPENAI_API_KEY": "sk-test"} if environ is None else environ,
        client_factory=lambda api_key: fake,
        sleep=lambda seconds: None,
    ), fake


def test_complete_parses_strict_json_schema_response_into_matches_and_gates():
    client, fake = _client([_FakeResponse(json.dumps({"matches": [{"proposal_id": "p1"}], "gates": []}))])
    result = client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    assert result == {"matches": [{"proposal_id": "p1"}], "gates": []}


def test_complete_uses_pinned_model_and_strict_schema_call_shape():
    client, fake = _client([_FakeResponse(json.dumps({"matches": [], "gates": []}))])
    client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    call = fake.responses.calls[0]
    assert call["model"] == "gpt-5.4-mini-2026-03-17"
    assert call["text"]["format"]["type"] == "json_schema"
    assert call["text"]["format"]["strict"] is True
    assert call["tools"] == []
    assert call["store"] is False


def test_strict_schema_requires_all_optional_match_fields_present_as_nullable():
    # OpenAI strict mode requires every declared property to be listed in
    # "required" — confidence/functional_basis/extension_ref are still
    # semantically optional, expressed by each accepting null via a
    # type: [<real type>, "null"] union (verified against the identical
    # pattern already used in product/openai_application_intelligence_provider.py,
    # e.g. "assertion_type": {"type": ["string", "null"], ...}) rather than
    # being absent from "required" (OpenAI strict mode rejects that).
    client, fake = _client([_FakeResponse(json.dumps({"matches": [], "gates": []}))])
    client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    match_schema = fake.responses.calls[0]["text"]["format"]["schema"]["properties"]["matches"]["items"]
    assert set(match_schema["required"]) == {
        "proposal_id", "job_evidence_id", "profile_evidence_ids", "classification",
        "rationale", "confidence", "functional_basis", "extension_ref",
    }
    assert match_schema["properties"]["confidence"]["type"] == ["string", "null"]
    assert match_schema["properties"]["functional_basis"]["type"] == ["object", "null"]
    assert match_schema["properties"]["extension_ref"]["type"] == ["object", "null"]
    # the nested object schemas must still declare their own properties/required
    # (nullability at the parent level does not exempt the object shape when
    # non-null)
    assert match_schema["properties"]["functional_basis"]["required"] == [
        "responsibility_alignment", "competency_alignment", "title_similarity_only",
    ]


def test_complete_strips_null_optional_fields_so_ticket7_sees_them_as_absent():
    # Ticket 7's real validator treats a present-but-null optional key as a
    # shape violation (verified against product/semantic_job_fit.py source);
    # it expects the key to be ABSENT, not present-with-null. The proposer
    # must therefore strip null values before returning.
    client, fake = _client([_FakeResponse(json.dumps({
        "matches": [{
            "proposal_id": "p1", "job_evidence_id": "j1", "profile_evidence_ids": ["c1"],
            "classification": "direct", "rationale": "x",
            "confidence": None, "functional_basis": None, "extension_ref": None,
        }],
        "gates": [],
    }))])
    result = client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    match = result["matches"][0]
    assert "confidence" not in match
    assert "functional_basis" not in match
    assert "extension_ref" not in match
    assert match["proposal_id"] == "p1"


def test_complete_preserves_non_null_functional_basis():
    client, fake = _client([_FakeResponse(json.dumps({
        "matches": [{
            "proposal_id": "p1", "job_evidence_id": "j1", "profile_evidence_ids": ["c1"],
            "classification": "functionally_equivalent", "rationale": "x",
            "confidence": "high",
            "functional_basis": {"responsibility_alignment": ["a"], "competency_alignment": [], "title_similarity_only": False},
            "extension_ref": None,
        }],
        "gates": [],
    }))])
    result = client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    match = result["matches"][0]
    assert match["functional_basis"]["responsibility_alignment"] == ["a"]
    assert "extension_ref" not in match


def test_missing_api_key_raises_provider_error_not_silent_fallback():
    client, fake = _client([_FakeResponse("{}")], environ={})
    with pytest.raises(SemanticProposerProviderError, match="OPENAI_API_KEY"):
        client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})


def test_malformed_json_raises_provider_error_not_silent_fallback():
    client, fake = _client([_FakeResponse("not valid json {")])
    with pytest.raises(SemanticProposerProviderError, match="not valid JSON"):
        client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})


def test_exhausted_retries_raise_provider_error_not_silent_fallback():
    client, fake = _client([RuntimeError("network down"), RuntimeError("network down again")])
    with pytest.raises(SemanticProposerProviderError, match="network down again"):
        client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})


def test_transient_failure_then_success_retries_within_bound():
    client, fake = _client([RuntimeError("transient"), _FakeResponse(json.dumps({"matches": [], "gates": []}))])
    result = client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    assert result == {"matches": [], "gates": []}
    assert len(fake.responses.calls) == 2


def test_sanitized_audit_records_success_without_prompt_key_or_candidate_payload():
    client, _ = _client([_FakeResponse(json.dumps({"matches": [], "gates": []}))])
    client.complete({"profile_evidence": [{"value": "private@example.test"}]})
    audit = client.last_audit
    assert audit["success"] is True
    assert audit["attempt_count"] == 1
    assert audit["provider_response_id"] == "resp_fake_1"
    assert audit["provider_id"] == "openai"
    serialized = json.dumps(audit)
    assert "sk-test" not in serialized
    assert "private@example.test" not in serialized
    assert "profile_evidence" not in serialized
    assert "instructions" not in serialized


def test_sanitized_audit_records_bounded_failure_metadata():
    client, _ = _client([RuntimeError("secret provider detail"), RuntimeError("again")])
    with pytest.raises(SemanticProposerProviderError):
        client.complete({"profile_evidence": [{"value": "private"}]})
    assert client.last_audit["success"] is False
    assert client.last_audit["attempt_count"] == 2
    assert client.last_audit["error_type"] == "RuntimeError"
    assert "secret provider detail" not in json.dumps(client.last_audit)
