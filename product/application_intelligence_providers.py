#!/usr/bin/env python3
"""Provider-neutral boundary for Application Intelligence v0.

Providers receive only the deliberately minimized proposal payload prepared by
``product.application_intelligence``: the consumed Job Fit Result v1's matches,
gaps, and identity fields, plus cited Profile Snapshot claim text and referenced
extension mapping text. They have no tools, repository access, raw candidate
source files, or authority to validate their own output. A provider proposes
atom selections, bounded rendering-variant choices, and guarded connectives —
never free text for candidate-bearing content. Local code in
``product.application_intelligence`` is the sole authority on what enters
accepted output.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable


class ApplicationIntelligenceProviderError(RuntimeError):
    """A product-owned provider execution error safe to expose to callers."""


@dataclass(frozen=True)
class ProviderCallAudit:
    """Bounded adapter-owned runtime telemetry kept outside result JSON."""

    provider_id: str
    model_id: str
    model_version: str
    provider_response_id: str | None
    started_at: str
    elapsed_ms: int
    attempt_count: int
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    local_request_id: str | None = None
    source_content_id: str | None = None


@dataclass(frozen=True)
class ProviderResponse:
    """Untrusted provider payload plus bounded adapter-owned metadata."""

    payload: Any
    response_id: str | None = None
    audit: ProviderCallAudit | None = None


@runtime_checkable
class ApplicationIntelligenceProvider(Protocol):
    """Minimal provider interface; implementations must not mutate requests."""

    provider_id: str
    model_id: str
    model_version: str

    def propose(self, request: dict[str, Any]) -> ProviderResponse:
        """Return an untrusted atom-selection/composition proposal."""


class DeterministicFakeProvider:
    """Offline test provider returning one preconfigured candidate payload.

    This class exercises orchestration and trust-boundary behavior. It does not
    simulate model intelligence and performs no network or filesystem access.
    """

    provider_id = "deterministic-fake"
    model_id = "fixture-response"
    model_version = "v0"

    def __init__(
        self,
        payload: Any,
        *,
        response_id: str | None = "fake-response-v0",
    ) -> None:
        self._payload = copy.deepcopy(payload)
        self._response_id = response_id
        self.calls: list[dict[str, Any]] = []

    def propose(self, request: dict[str, Any]) -> ProviderResponse:
        self.calls.append(copy.deepcopy(request))
        return ProviderResponse(
            payload=copy.deepcopy(self._payload),
            response_id=self._response_id,
        )
