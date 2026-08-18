# webapp/services/semantic_proposal_adapter.py
"""Untrusted semantic-proposal adapter for Ticket 7.

Proposes candidate<->job evidence relationships, a proposed classification,
and gate observations for analyze_semantic_job_fit() to locally adjudicate.
Every field this adapter emits matches Ticket 7's real semantic_proposals
schema (product/semantic_job_fit.py:801-826) exactly — including gate
`status` and match `classification`, which are REQUIRED proposal fields, not
authoritative answers. What this adapter must never emit is a field that
would let a proposal bypass adjudication: overall_score, verdict,
recommendation, blocked, blocking_gate_ids.
"""
from __future__ import annotations

import copy
from typing import Any, Protocol

FORBIDDEN_KEYS = {"overall_score", "verdict", "recommendation", "blocked", "blocking_gate_ids"}


def _strip_forbidden(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip_forbidden(v) for k, v in value.items() if k not in FORBIDDEN_KEYS}
    if isinstance(value, list):
        return [_strip_forbidden(item) for item in value]
    return value


class ProposerClient(Protocol):
    def complete(self, context: dict[str, Any]) -> dict[str, Any]: ...


class SemanticProposalAdapter:
    def __init__(self, client: ProposerClient) -> None:
        self._client = client

    def build_prompt_context(
        self, *, profile_evidence: list[dict[str, Any]], resolved_job_evidence: dict[str, Any],
        active_extensions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "profile_evidence": [
                {"id": item["id"], "category": item.get("category"), "field": item.get("field"),
                 "value": item.get("value")}
                for item in profile_evidence
            ],
            "job_evidence": [
                {"id": item["id"], "category": item.get("category"), "kind": item.get("kind"), "text": item.get("text")}
                for item in resolved_job_evidence.get("evidence", [])
            ],
            "active_extensions": [
                {
                    "extension_id": ext["id"],
                    "extension_version": ext["version"],
                    "transferable_mappings": [
                        {
                            "id": mapping["id"],
                            "source": mapping["source"],
                            "target": mapping["target"],
                            "transfer_strength": mapping["transfer_strength"],
                            "conditions": mapping.get("conditions"),
                            "limitations": mapping.get("limitations"),
                        }
                        for mapping in ext.get("transferable_mappings", [])
                    ],
                }
                for ext in active_extensions
            ],
        }

    def propose(
        self, *, profile_evidence: list[dict[str, Any]], resolved_job_evidence: dict[str, Any],
        active_extensions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        context = self.build_prompt_context(
            profile_evidence=profile_evidence, resolved_job_evidence=resolved_job_evidence,
            active_extensions=active_extensions,
        )
        raw = self._client.complete(context)
        cleaned = _strip_forbidden(copy.deepcopy(raw))
        return {"matches": cleaned.get("matches", []), "gates": cleaned.get("gates", [])}


class FakeSemanticProposalAdapter(SemanticProposalAdapter):
    def __init__(self, canned_response: dict[str, Any]) -> None:
        super().__init__(client=_CannedClient(canned_response))


class _CannedClient:
    def __init__(self, canned_response: dict[str, Any]) -> None:
        self._canned_response = canned_response

    def complete(self, context: dict[str, Any]) -> dict[str, Any]:
        return copy.deepcopy(self._canned_response)
