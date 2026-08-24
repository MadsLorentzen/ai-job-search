"""Pure construction and validation helpers for immutable Application Packs."""
from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from typing import Any, Iterable


APPLICATION_PACK_V0 = "application-pack.v0"
APPLICATION_PACK_V1 = "application-pack.v1"
SUPPORTED_PROFILE_SCHEMA_VERSIONS = frozenset(
    {"candidate-profile-evidence-snapshot.v0"}
)


class ApplicationPackContractError(ValueError):
    """Raised when an Application Pack contract cannot be constructed or validated."""


def _normalized_json(value: Any) -> str:
    """Mirror the pinned Profile Snapshot v0 normalized-value semantics."""

    def normalize(item: Any) -> Any:
        if isinstance(item, str):
            text = unicodedata.normalize("NFC", item)
            text = text.replace("–", "-").replace("—", "-")
            return re.sub(r"\s+", " ", text).strip().casefold()
        if isinstance(item, dict):
            return {key: normalize(item[key]) for key in sorted(item)}
        if isinstance(item, list):
            return [normalize(part) for part in item]
        return item

    return json.dumps(
        normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def _source_position(claim: dict[str, Any]) -> tuple[str, int, str]:
    source = claim.get("source") or {}
    file = source.get("file")
    line = source.get("line_start")
    claim_id = claim.get("id")
    if not isinstance(file, str) or not isinstance(line, int) or not isinstance(claim_id, str):
        raise ApplicationPackContractError("profile claim has invalid source position")
    return file, line, claim_id


def _presentation_value(claims: Iterable[dict[str, Any]]) -> tuple[dict[str, Any], tuple[str, int, str]]:
    candidates = list(claims)
    if not candidates:
        raise ApplicationPackContractError("cannot present an empty claim set")
    by_normalized: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for claim in candidates:
        by_normalized[_normalized_json(claim.get("value"))].append(claim)
    if len(by_normalized) != 1:
        raise ApplicationPackContractError(
            "one profile concept contains distinct normalized safe values"
        )
    equivalent = next(iter(by_normalized.values()))
    winner = min(equivalent, key=_source_position)
    evidence_ids = sorted(claim.get("id") for claim in equivalent)
    if any(not isinstance(claim_id, str) for claim_id in evidence_ids):
        raise ApplicationPackContractError("profile claim id must be a string")
    return (
        {"value": winner.get("value"), "profile_evidence_ids": evidence_ids},
        _source_position(winner),
    )


def _field_value(
    claims: list[dict[str, Any]], category: str, field: str, *, record_id: str | None = None
) -> dict[str, Any] | None:
    matches = [
        claim
        for claim in claims
        if claim.get("category") == category
        and claim.get("field") == field
        and (record_id is None or claim.get("record_id") == record_id)
    ]
    return _presentation_value(matches)[0] if matches else None


def _record_order(claims: list[dict[str, Any]], category: str) -> list[str]:
    positions: dict[str, tuple[str, int, str]] = {}
    for claim in claims:
        if claim.get("category") != category:
            continue
        record_id = claim.get("record_id")
        if not isinstance(record_id, str):
            raise ApplicationPackContractError("profile claim record_id must be a string")
        position = _source_position(claim)
        positions[record_id] = min(positions.get(record_id, position), position)
    return sorted(positions, key=lambda record_id: (*positions[record_id][:2], record_id))


def _concept_values(
    claims: list[dict[str, Any]], category: str, field: str, record_id: str
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for claim in claims:
        if (
            claim.get("category") == category
            and claim.get("field") == field
            and claim.get("record_id") == record_id
        ):
            concept_id = claim.get("concept_id")
            if not isinstance(concept_id, str):
                raise ApplicationPackContractError("profile claim concept_id must be a string")
            grouped[concept_id].append(claim)
    collapsed = [_presentation_value(group) for group in grouped.values()]
    collapsed.sort(key=lambda item: item[1])
    return [value for value, _ in collapsed]


def _scalar_records(
    claims: list[dict[str, Any]], category: str, fields: tuple[str, ...]
) -> list[dict[str, Any]]:
    return [
        {
            "record_id": record_id,
            **{
                field: _field_value(claims, category, field, record_id=record_id)
                for field in fields
            },
        }
        for record_id in _record_order(claims, category)
    ]


def build_candidate_snapshot(source_profile_artifact: dict[str, Any]) -> dict[str, Any]:
    """Project all safe v0 Profile facts into the closed candidate v1 shape."""

    if not isinstance(source_profile_artifact, dict):
        raise ApplicationPackContractError("source profile artifact must be an object")
    if source_profile_artifact.get("artifact_type") != "profile_snapshot":
        raise ApplicationPackContractError("source profile artifact has the wrong type")
    payload = source_profile_artifact.get("payload")
    if not isinstance(payload, dict):
        raise ApplicationPackContractError("source profile artifact payload must be an object")
    profile_version = payload.get("schema_version")
    if profile_version not in SUPPORTED_PROFILE_SCHEMA_VERSIONS:
        raise ApplicationPackContractError("unsupported profile schema version")
    raw_claims = payload.get("claims")
    raw_conflicts = payload.get("conflicts")
    if not isinstance(raw_claims, list) or not isinstance(raw_conflicts, list):
        raise ApplicationPackContractError("profile claims and conflicts must be arrays")
    conflicted_concepts = {
        conflict.get("concept_id")
        for conflict in raw_conflicts
        if isinstance(conflict, dict) and isinstance(conflict.get("concept_id"), str)
    }
    claims = [
        claim
        for claim in raw_claims
        if isinstance(claim, dict)
        and claim.get("placeholder") is False
        and claim.get("concept_id") not in conflicted_concepts
    ]

    name_claims = [
        claim
        for claim in claims
        if claim.get("category") == "identity" and claim.get("field") == "name"
    ]
    if not name_claims:
        raise ApplicationPackContractError("candidate name is required")
    try:
        name, _ = _presentation_value(name_claims)
    except ApplicationPackContractError as exc:
        raise ApplicationPackContractError(
            "candidate name must have one distinct normalized safe value"
        ) from exc

    employment = []
    for record_id in _record_order(claims, "employment"):
        employment.append(
            {
                "record_id": record_id,
                "role": _field_value(claims, "employment", "job_title", record_id=record_id),
                "employer": _field_value(claims, "employment", "employer", record_id=record_id),
                "date_range": _field_value(claims, "employment", "date_range", record_id=record_id),
                "location": _field_value(claims, "employment", "location", record_id=record_id),
                "details": _concept_values(
                    claims, "employment", "responsibility_or_achievement", record_id
                ),
            }
        )

    certifications = [
        {
            "record_id": record_id,
            "name": _field_value(
                claims, "certifications", "certification", record_id=record_id
            ),
        }
        for record_id in _record_order(claims, "certifications")
    ]
    skills = []
    for record_id in _record_order(claims, "skills"):
        skill_concepts: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for claim in claims:
            field = claim.get("field")
            concept_id = claim.get("concept_id")
            if (
                claim.get("category") == "skills"
                and claim.get("record_id") == record_id
                and isinstance(field, str)
                and isinstance(concept_id, str)
            ):
                skill_concepts[(field, concept_id)].append(claim)
        collapsed_skills = [
            (field, *_presentation_value(group))
            for (field, _), group in skill_concepts.items()
        ]
        collapsed_skills.sort(key=lambda item: item[2])
        for field, value, _ in collapsed_skills:
            skills.append({"record_id": record_id, "category": field, "value": value})

    publications = [
        {"record_id": record_id, "value": value}
        for record_id in _record_order(claims, "publications")
        for value in _concept_values(claims, "publications", "publication", record_id)
    ]
    awards = [
        {"record_id": record_id, "value": value}
        for record_id in _record_order(claims, "awards")
        for value in _concept_values(claims, "awards", "award", record_id)
    ]

    return {
        "profile_schema_version": profile_version,
        "identity": {"name": name},
        "contact": {
            "email": _field_value(claims, "contact", "email"),
            "phone": _field_value(claims, "contact", "phone"),
            "linkedin": _field_value(claims, "contact", "linkedin"),
            "github": _field_value(claims, "contact", "github"),
            "location": _field_value(claims, "location", "location"),
        },
        "employment": employment,
        "education": _scalar_records(
            claims,
            "education",
            ("qualification", "institution", "date_range", "location", "key_topics", "details"),
        ),
        "certifications": certifications,
        "skills": skills,
        "languages": _scalar_records(
            claims, "languages", ("language", "proficiency", "notes")
        ),
        "projects": _scalar_records(claims, "projects", ("name", "description")),
        "publications": publications,
        "awards": awards,
    }
