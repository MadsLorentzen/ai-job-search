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

from product.semantic_job_fit import MATCH_CLASSIFICATIONS

FORBIDDEN_KEYS = {"overall_score", "verdict", "recommendation", "blocked", "blocking_gate_ids"}
SEMANTIC_CATEGORIES = frozenset({
    "employment", "education", "skills", "languages", "projects",
    "publications", "awards", "constraints", "location", "eligibility",
})
SEMANTIC_IDENTITY_FIELDS = frozenset({"employment_status"})


def _strip_forbidden(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip_forbidden(v) for k, v in value.items() if k not in FORBIDDEN_KEYS}
    if isinstance(value, list):
        return [_strip_forbidden(item) for item in value]
    return value


def _discard_unknown_evidence_references(
    proposals: dict[str, Any], context: dict[str, Any],
    resolved_job_evidence: dict[str, Any],
) -> dict[str, Any]:
    """Fail closed when the untrusted proposer invents evidence identifiers."""
    profile_ids = {
        item["id"] for item in context["profile_evidence"]
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    job_ids = {
        item["id"] for item in context["job_evidence"]
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    job_ids.update(
        alias["alias_id"] for alias in resolved_job_evidence.get("aliases", [])
        if isinstance(alias, dict) and isinstance(alias.get("alias_id"), str)
    )

    matches = []
    for match in proposals.get("matches", []):
        if not isinstance(match, dict):
            matches.append(match)
            continue
        proposed_profile_ids = match.get("profile_evidence_ids")
        if (
            match.get("job_evidence_id") not in job_ids
            or not isinstance(proposed_profile_ids, list)
            or any(profile_id not in profile_ids for profile_id in proposed_profile_ids)
        ):
            continue
        matches.append(match)

    gates = []
    for gate in proposals.get("gates", []):
        if not isinstance(gate, dict):
            gates.append(gate)
            continue
        filtered = copy.deepcopy(gate)
        proposed_job_ids = filtered.get("job_evidence_ids")
        if isinstance(proposed_job_ids, list) and any(job_id not in job_ids for job_id in proposed_job_ids):
            filtered["job_evidence_ids"] = []
        proposed_profile_ids = filtered.get("profile_evidence_ids")
        if (
            isinstance(proposed_profile_ids, list)
            and any(profile_id not in profile_ids for profile_id in proposed_profile_ids)
        ):
            filtered["profile_evidence_ids"] = []
        gates.append(filtered)
    return {"matches": matches, "gates": gates}


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
            "allowed_classifications": list(MATCH_CLASSIFICATIONS),
            "profile_evidence": [
                {"id": item["id"], "category": item.get("category"), "field": item.get("field"),
                 "value": item.get("value")}
                for item in profile_evidence
                if _is_semantic_claim(item)
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
        proposals = {"matches": cleaned.get("matches", []), "gates": cleaned.get("gates", [])}
        return _discard_unknown_evidence_references(proposals, context, resolved_job_evidence)

    @property
    def last_audit(self) -> dict[str, Any] | None:
        value = getattr(self._client, "last_audit", None)
        return copy.deepcopy(value) if isinstance(value, dict) else None


def select_semantic_profile_evidence(profile_snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Select locally valid, fit-relevant claims for the hosted proposer."""
    conflicts = {
        item.get("concept_id") for item in profile_snapshot.get("conflicts", [])
        if isinstance(item, dict) and item.get("concept_id")
    }
    selected = []
    for claim in profile_snapshot.get("claims", []):
        if not isinstance(claim, dict) or not _is_semantic_claim(claim):
            continue
        if claim.get("placeholder") or claim.get("concept_id") in conflicts:
            continue
        selected.append(copy.deepcopy(claim))
    return selected


def _is_semantic_claim(item: dict[str, Any]) -> bool:
    category = item.get("category")
    return category in SEMANTIC_CATEGORIES or (
        category == "identity" and item.get("field") in SEMANTIC_IDENTITY_FIELDS
    )


class FakeSemanticProposalAdapter(SemanticProposalAdapter):
    def __init__(self, canned_response: dict[str, Any]) -> None:
        super().__init__(client=_CannedClient(canned_response))


class _CannedClient:
    def __init__(self, canned_response: dict[str, Any]) -> None:
        self._canned_response = canned_response

    def complete(self, context: dict[str, Any]) -> dict[str, Any]:
        return copy.deepcopy(self._canned_response)
