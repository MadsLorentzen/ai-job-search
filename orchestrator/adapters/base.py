from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class AdapterError(RuntimeError):
    """Raised when an adapter cannot complete a model request."""


class BaseAdapter(ABC):
    """Common interface for chat and single-shot model backends."""

    backend_name = "base"

    @abstractmethod
    def send_chat(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        stop: list[str] | None = None,
    ) -> dict[str, Any]:
        """Send chat messages and return {"text": str, "usage": dict}."""

    @abstractmethod
    def single_shot(self, prompt: str, max_tokens: int, temperature: float) -> str:
        """Send a single flattened prompt and return assistant text."""

    def spawn_fresh_context(self) -> dict[str, Any]:
        """Return metadata for a fresh reviewer context."""
        return {"messages": [], "fresh_context": True}

    def count_tokens(self, text: str) -> int:
        """Estimate token count without pulling in tokenizer dependencies."""
        return max(1, len(text) // 4)

    @staticmethod
    def response_text(response: dict[str, Any] | str) -> str:
        if isinstance(response, str):
            return response
        return str(response.get("text", ""))
