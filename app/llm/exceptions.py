"""Typed failures raised by providers and LLM response handling."""


class LLMError(Exception):
    """Base exception for all LLM and provider failures."""


class ProviderConnectionError(LLMError):
    """Raised when the provider endpoint is unreachable."""


class ProviderTimeoutError(LLMError):
    """Raised when a request exceeds the configured timeout."""


class SchemaValidationError(LLMError):
    """Raised when model output fails JSON parsing or schema validation."""


class ContextLimitExceededError(LLMError):
    """Raised when required context exceeds the configured budget."""