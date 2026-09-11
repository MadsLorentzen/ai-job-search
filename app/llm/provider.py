"""Provider-neutral LLM requests and bounded structured-output repair."""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional, Protocol

from app.llm.exceptions import LLMError, ProviderTimeoutError, SchemaValidationError


LLMTimeoutError = ProviderTimeoutError
StructuredOutputError = SchemaValidationError


@dataclass(frozen=True)
class LLMRequest:
    system_prompt: str
    user_prompt: str
    model: Optional[str] = None
    temperature: float = 0.0
    max_tokens: Optional[int] = None
    timeout_seconds: float = 120.0
    response_format: Optional[str] = None
    metadata: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class LLMResponse:
    text: str
    model: str
    latency_ms: Optional[int] = None
    raw: Any = None


class LLMProvider(Protocol):
    def generate(self, request: LLMRequest) -> LLMResponse:
        """Generate text without interpreting it as executable content."""

    def health_check(self) -> bool:
        """Return whether the provider is reachable and usable."""

    def list_models(self) -> list[str]:
        """Return provider model names."""


def generate_structured(
    provider: LLMProvider,
    request: LLMRequest,
    validator: Callable[[str], Any],
    repair_request: Optional[Callable[[LLMRequest, str], LLMRequest]] = None,
) -> Any:
    """Generate and validate structured output, with at most one repair call."""
    response = provider.generate(request)
    try:
        return validator(response.text)
    except Exception as first_error:
        if repair_request is None:
            raise SchemaValidationError(str(first_error)) from first_error
        repaired = provider.generate(repair_request(request, str(first_error)))
        try:
            return validator(repaired.text)
        except Exception as second_error:
            raise SchemaValidationError(str(second_error)) from second_error