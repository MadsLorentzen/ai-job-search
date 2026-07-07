from orchestrator.adapters.openai_adapter import OpenAIChatAdapter


def test_openai_send_chat_maps_response_and_usage():
    adapter = OpenAIChatAdapter(api_key="test-key", model="gpt-4o")
    captured = {}

    def fake_post_json(payload):
        captured.update(payload)
        return {
            "choices": [{"message": {"content": "hello"}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1},
        }

    adapter._post_json = fake_post_json
    response = adapter.send_chat(
        [{"role": "user", "content": "Say hello"}],
        max_tokens=12,
        temperature=0.0,
    )

    assert captured["model"] == "gpt-4o"
    assert captured["messages"][0]["content"] == "Say hello"
    assert captured["max_tokens"] == 12
    assert response["text"] == "hello"
    assert response["usage"]["prompt_tokens"] == 3


def test_openai_adapter_accepts_legacy_env_alias(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPEN_AI_API_KEY", "alias-key")

    adapter = OpenAIChatAdapter()

    assert adapter.api_key == "alias-key"
