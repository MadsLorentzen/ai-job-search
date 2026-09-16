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
    """Test double. Supports two construction modes:

    - ``canned_response`` (the original, still-default mode): a fixed
      matches/gates dict returned for every call, regardless of input.
    - ``propose_fn`` (test-support extension, Phase 4C Task 11): a callable
      ``(context) -> dict`` invoked fresh on every ``propose()`` call,
      given the exact same ``context`` shape ``build_prompt_context``
      already builds for the canned-response path (profile_evidence,
      job_evidence, active_extensions).

    Why this exists: webapp/services/pipeline.py's run_job_fit calls
    semantic_adapter.propose(profile_evidence=..., resolved_job_evidence=...,
    active_extensions=...) BEFORE it materializes the resolved_blocker_
    answers bundle (the bundle is only computed afterward, at line ~305, so
    it could never be threaded into propose()'s own parameters without
    reordering run_job_fit itself -- out of scope here). A fixed
    canned_response therefore cannot vary its gate proposal (PASS vs. FAIL,
    which resolved_answer_ids to cite) depending on a blocker answer's
    *current* value, because that value is not visible to it at all. A
    caller that needs the proposal to react to the live, correctable
    answer (Phase 4C's correction-scenario acceptance test: the SAME
    eligibility question must propose PASS before a correction and FAIL
    after it, over the real resume path) supplies propose_fn as a closure
    over its own conn/workspace_id and reads the actual current effective
    resolution itself (e.g. via
    webapp.persistence.application_blockers.get_effective_resolution),
    deciding what to propose from that live value. This is still just a
    test double choosing its own canned-ish answer -- it is not a second
    semantic reasoning engine: it does no adjudication, citation
    validation, or policy classification of its own; it only decides what
    proposal to hand to the real, unmodified _build_gate_assessments/
    validate_resolved_answer_citation/execute_job_fit_policy pipeline,
    exactly as the fixed canned_response mode already does.
    """

    def __init__(
        self,
        canned_response: dict[str, Any] | None = None,
        *,
        propose_fn: Any = None,
    ) -> None:
        if (canned_response is None) == (propose_fn is None):
            raise ValueError("supply exactly one of canned_response or propose_fn")
        client: Any = _CannedClient(canned_response) if propose_fn is None else _CallableClient(propose_fn)
        super().__init__(client=client)


class _CannedClient:
    def __init__(self, canned_response: dict[str, Any]) -> None:
        self._canned_response = canned_response

    def complete(self, context: dict[str, Any]) -> dict[str, Any]:
        return copy.deepcopy(self._canned_response)


class _CallableClient:
    def __init__(self, propose_fn: Any) -> None:
        self._propose_fn = propose_fn

    def complete(self, context: dict[str, Any]) -> dict[str, Any]:
        return copy.deepcopy(self._propose_fn(context))
