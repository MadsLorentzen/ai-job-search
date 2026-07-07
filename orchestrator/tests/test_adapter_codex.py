from orchestrator.adapters.codex_compat_adapter import CodexCompatAdapter


def test_codex_compat_flattens_chat_with_separators():
    adapter = CodexCompatAdapter(api_key="key", endpoint="https://example.test")

    prompt = adapter.flatten_messages(
        [
            {"role": "system", "content": "System rules"},
            {"role": "user", "content": "Current request"},
        ],
        reviewer_context="Drafts inline",
    )

    assert "====SYSTEM====" in prompt
    assert "System rules" in prompt
    assert "====PROFILE====" in prompt
    assert "====JOB====" in prompt
    assert "====CV====" in prompt
    assert "====COVER====" in prompt
    assert "====REVIEW CONTEXT START====" in prompt
    assert "Drafts inline" in prompt
    assert "====INSTRUCTION====" in prompt
    assert "USER:\nCurrent request" in prompt


def test_codex_compat_single_shot_extracts_text_from_mocked_endpoint():
    adapter = CodexCompatAdapter(api_key="key", endpoint="https://example.test")

    def fake_post_json(payload):
        assert payload["prompt"] == "hello"
        return {"choices": [{"text": "world"}]}

    adapter._post_json = fake_post_json
    assert adapter.single_shot("hello", max_tokens=10, temperature=0.0) == "world"
