"""Adapter registry for orchestrator backends."""

from orchestrator.adapters.base import AdapterError, BaseAdapter
from orchestrator.adapters.codex_compat_adapter import CodexCompatAdapter
from orchestrator.adapters.mock_adapter import MockAdapter
from orchestrator.adapters.openai_adapter import OpenAIChatAdapter


def build_adapter(backend: str, config):
    """Build an adapter from a backend name and loaded config."""
    normalized = backend.replace("-", "_").lower()
    if normalized in {"openai", "openai_chat"}:
        return OpenAIChatAdapter(
            api_key=config.openai_api_key,
            model=config.openai_model,
            base_url=config.openai_base_url,
            timeout=config.request_timeout_seconds,
        )
    if normalized in {"codex", "codex_compat"}:
        return CodexCompatAdapter(
            api_key=config.codex_api_key or config.openai_api_key,
            model=config.codex_model,
            endpoint=config.codex_endpoint,
            token_limit=config.context_token_limit,
            timeout=config.request_timeout_seconds,
        )
    if normalized == "mock":
        return MockAdapter()
    raise AdapterError(f"Unknown backend: {backend}")


__all__ = [
    "AdapterError",
    "BaseAdapter",
    "CodexCompatAdapter",
    "MockAdapter",
    "OpenAIChatAdapter",
    "build_adapter",
]
