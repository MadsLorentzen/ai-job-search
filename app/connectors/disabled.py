"""Explicitly disabled connector failures."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List


class DisabledByDefaultError(RuntimeError):
    """Raised until an integration is intentionally enabled and implemented."""


class MailConnector(ABC):
    """Future mail connector contract.

    ``search_messages`` accepts a plain mapping of search criteria and returns a
    list of plain message dictionaries. Implementations must not send, label,
    archive, or delete messages as part of this read operation.
    """

    @abstractmethod
    def search_messages(self, criteria: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Accept a plain mapping of criteria and return message mappings."""


class PipelineConnector(ABC):
    """Future pipeline connector contract.

    ``upsert_job`` accepts one plain job mapping and returns a plain mapping
    containing the destination identifier and operation status. Implementations
    must preserve the local repository as the source of truth.
    """

    @abstractmethod
    def upsert_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """Accept a plain job mapping and return an operation result mapping."""


class DisabledMailConnector(MailConnector):
    """Concrete disabled implementation used until Gmail support is approved."""

    def search_messages(self, criteria: Dict[str, Any]) -> List[Dict[str, Any]]:
        raise DisabledByDefaultError(
            "Gmail connector is disabled by default; no credentials are configured"
        )


class DisabledPipelineConnector(PipelineConnector):
    """Concrete disabled implementation used until Notion support is approved."""

    def upsert_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        raise DisabledByDefaultError(
            "Notion connector is disabled by default; no credentials are configured"
        )