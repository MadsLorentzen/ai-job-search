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


_PACK_V1_KEYS = {
    "schema_version",
    "source_artifacts",
    "candidate_snapshot",
    "job",
    "fit_summary",
    "recommendation",
    "recommendation_reason",
    "cv_content",
    "cover_letter_content",
    "review_record",
    "completion_contract_version",
    "completion_status",
    "completion_issues",
    "completion_metrics",
}
_CANDIDATE_KEYS = {
    "profile_schema_version",
    "identity",
    "contact",
    "employment",
    "education",
    "certifications",
    "skills",
    "languages",
    "projects",
    "publications",
    "awards",
}
_ARTIFACT_TYPES = (
    "profile_snapshot",
    "job_posting_snapshot",
    "job_fit_result",
    "application_intelligence_result",
)


def _require_exact_keys(value: Any, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ApplicationPackContractError(f"{label} must be an object")
    if set(value) != expected:
        raise ApplicationPackContractError(f"{label} has invalid keys")
    return value


def _require_nonempty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApplicationPackContractError(f"{label} must be a non-empty string")
    return value


def _validate_provenanced_value(value: Any, label: str, *, nullable: bool = False) -> None:
    if value is None and nullable:
        return
    item = _require_exact_keys(value, {"value", "profile_evidence_ids"}, label)
    _require_nonempty_string(item["value"], f"{label}.value")
    evidence_ids = item["profile_evidence_ids"]
    if (
        not isinstance(evidence_ids, list)
        or not evidence_ids
        or any(
            not isinstance(evidence_id, str)
            or re.fullmatch(r"clm_[0-9a-f]{16}", evidence_id) is None
            for evidence_id in evidence_ids
        )
        or evidence_ids != sorted(set(evidence_ids))
    ):
        raise ApplicationPackContractError(
            f"{label}.profile_evidence_ids must be non-empty, unique, and sorted"
        )


def _validate_records(
    records: Any,
    label: str,
    fields: dict[str, bool],
    *,
    allow_repeated_record_ids: bool = False,
) -> None:
    if not isinstance(records, list):
        raise ApplicationPackContractError(f"{label} must be an array")
    seen: set[str] = set()
    for index, record in enumerate(records):
        row = _require_exact_keys(record, {"record_id", *fields}, f"{label}[{index}]")
        record_id = row["record_id"]
        if not isinstance(record_id, str) or re.fullmatch(r"rec_[0-9a-f]{16}", record_id) is None:
            raise ApplicationPackContractError(f"{label}[{index}].record_id is invalid")
        if not allow_repeated_record_ids and record_id in seen:
            raise ApplicationPackContractError(f"{label} contains duplicate record IDs")
        seen.add(record_id)
        for field, nullable in fields.items():
            _validate_provenanced_value(
                row[field], f"{label}[{index}].{field}", nullable=nullable
            )


def _validate_candidate_snapshot(candidate: Any) -> None:
    snapshot = _require_exact_keys(candidate, _CANDIDATE_KEYS, "candidate_snapshot")
    if snapshot["profile_schema_version"] not in SUPPORTED_PROFILE_SCHEMA_VERSIONS:
        raise ApplicationPackContractError("unsupported copied profile schema version")
    identity = _require_exact_keys(snapshot["identity"], {"name"}, "candidate_snapshot.identity")
    _validate_provenanced_value(identity["name"], "candidate_snapshot.identity.name")
    contact = _require_exact_keys(
        snapshot["contact"],
        {"email", "phone", "linkedin", "github", "location"},
        "candidate_snapshot.contact",
    )
    for field in ("email", "phone", "linkedin", "github", "location"):
        _validate_provenanced_value(
            contact[field], f"candidate_snapshot.contact.{field}", nullable=True
        )
    if not isinstance(snapshot["employment"], list):
        raise ApplicationPackContractError("candidate_snapshot.employment must be an array")
    employment_ids: set[str] = set()
    for index, raw in enumerate(snapshot["employment"]):
        row = _require_exact_keys(
            raw,
            {"record_id", "role", "employer", "date_range", "location", "details"},
            f"candidate_snapshot.employment[{index}]",
        )
        record_id = row["record_id"]
        if not isinstance(record_id, str) or re.fullmatch(r"rec_[0-9a-f]{16}", record_id) is None:
            raise ApplicationPackContractError("employment record_id is invalid")
        if record_id in employment_ids:
            raise ApplicationPackContractError("employment contains duplicate record IDs")
        employment_ids.add(record_id)
        for field in ("role", "employer", "date_range", "location"):
            _validate_provenanced_value(
                row[field], f"candidate_snapshot.employment[{index}].{field}", nullable=True
            )
        if not isinstance(row["details"], list):
            raise ApplicationPackContractError("employment.details must be an array")
        for detail_index, detail in enumerate(row["details"]):
            _validate_provenanced_value(
                detail, f"candidate_snapshot.employment[{index}].details[{detail_index}]"
            )
    _validate_records(
        snapshot["education"],
        "candidate_snapshot.education",
        {
            "qualification": True,
            "institution": True,
            "date_range": True,
            "location": True,
            "key_topics": True,
            "details": True,
        },
    )
    _validate_records(
        snapshot["certifications"],
        "candidate_snapshot.certifications",
        {"name": False},
    )
    if not isinstance(snapshot["skills"], list):
        raise ApplicationPackContractError("candidate_snapshot.skills must be an array")
    for index, raw in enumerate(snapshot["skills"]):
        row = _require_exact_keys(
            raw, {"record_id", "category", "value"}, f"candidate_snapshot.skills[{index}]"
        )
        if not isinstance(row["record_id"], str) or re.fullmatch(
            r"rec_[0-9a-f]{16}", row["record_id"]
        ) is None:
            raise ApplicationPackContractError("skill record_id is invalid")
        _require_nonempty_string(row["category"], "skill category")
        _validate_provenanced_value(row["value"], f"candidate_snapshot.skills[{index}].value")
    _validate_records(
        snapshot["languages"],
        "candidate_snapshot.languages",
        {"language": False, "proficiency": True, "notes": True},
    )
    _validate_records(
        snapshot["projects"],
        "candidate_snapshot.projects",
        {"name": True, "description": True},
    )
    _validate_records(
        snapshot["publications"],
        "candidate_snapshot.publications",
        {"value": False},
    )
    _validate_records(
        snapshot["awards"],
        "candidate_snapshot.awards",
        {"value": False},
    )


def _validate_source_artifacts(value: Any) -> dict[str, Any]:
    sources = _require_exact_keys(value, set(_ARTIFACT_TYPES), "source_artifacts")
    for artifact_type in _ARTIFACT_TYPES:
        ref = _require_exact_keys(
            sources[artifact_type],
            {"artifact_id", "artifact_type", "content_id"},
            f"source_artifacts.{artifact_type}",
        )
        _require_nonempty_string(ref["artifact_id"], f"{artifact_type}.artifact_id")
        _require_nonempty_string(ref["content_id"], f"{artifact_type}.content_id")
        if ref["artifact_type"] != artifact_type:
            raise ApplicationPackContractError(f"{artifact_type} reference type mismatch")
    return sources


def _validate_review_authorizations(pack: dict[str, Any], sources: dict[str, Any]) -> None:
    cv = pack["cv_content"]
    cover = pack["cover_letter_content"]
    if not isinstance(cv, list) or not isinstance(cover, list):
        raise ApplicationPackContractError("rendered content collections must be arrays")
    units: list[dict[str, Any]] = []
    for collection, allowed in (
        (cv, {"cv_summary_line", "cv_bullet"}),
        (cover, {"cover_letter_paragraph"}),
    ):
        for unit in collection:
            if not isinstance(unit, dict):
                raise ApplicationPackContractError("rendered content unit must be an object")
            unit_id = _require_nonempty_string(unit.get("unit_id"), "content unit id")
            if unit.get("unit_type") not in allowed:
                raise ApplicationPackContractError("rendered content unit has invalid type")
            _require_nonempty_string(unit.get("text"), "content unit text")
            units.append(unit)
    unit_ids = [unit["unit_id"] for unit in units]
    if len(unit_ids) != len(set(unit_ids)):
        raise ApplicationPackContractError("duplicate rendered content unit ID")
    review = _require_exact_keys(
        pack["review_record"],
        {"decisions_consulted", "exclusions", "informational_items"},
        "review_record",
    )
    decisions = review["decisions_consulted"]
    if (
        not isinstance(decisions, list)
        or not isinstance(review["exclusions"], list)
        or not isinstance(review["informational_items"], dict)
    ):
        raise ApplicationPackContractError("review decisions must be an array")
    for index, raw in enumerate(decisions):
        decision = _require_exact_keys(
            raw,
            {
                "id",
                "workspace_id",
                "review_item_type",
                "source_artifact_id",
                "domain_item_id",
                "disposition",
                "note",
                "created_at",
            },
            f"review_record.decisions_consulted[{index}]",
        )
        for field in ("id", "workspace_id", "review_item_type", "source_artifact_id", "created_at"):
            _require_nonempty_string(decision[field], f"review decision {field}")
        if decision["domain_item_id"] is not None and not isinstance(
            decision["domain_item_id"], str
        ):
            raise ApplicationPackContractError("review decision domain_item_id is invalid")
        if decision["note"] is not None and not isinstance(decision["note"], str):
            raise ApplicationPackContractError("review decision note is invalid")
        if decision["disposition"] not in {
            "acknowledged_and_proceed",
            "omit_from_positioning",
            "requires_upstream_change",
            "resolved_by_rerun",
        }:
            raise ApplicationPackContractError("review decision disposition is invalid")
    ai_artifact_id = sources["application_intelligence_result"]["artifact_id"]
    for unit_id in unit_ids:
        matching = [
            decision
            for decision in decisions
            if isinstance(decision, dict)
            and decision.get("review_item_type") == "content_unit"
            and decision.get("domain_item_id") == unit_id
            and decision.get("source_artifact_id") == ai_artifact_id
        ]
        if len(matching) != 1 or matching[0].get("disposition") != "acknowledged_and_proceed":
            raise ApplicationPackContractError(
                f"content unit {unit_id!r} lacks exactly one review authorization"
            )


def validate_application_pack_v1(
    pack: dict[str, Any], *, source_profile_artifact: dict[str, Any] | None = None
) -> None:
    """Validate v1 structurally, and prove exact Profile projection when supplied.

    Without ``source_profile_artifact`` this pure function intentionally cannot
    prove that embedded candidate values existed in a historical Profile
    Snapshot. Construction supplies that artifact and receives the stronger
    exact-projection guarantee; rendering remains self-contained.
    """

    value = _require_exact_keys(pack, _PACK_V1_KEYS, "application pack v1")
    if value["schema_version"] != APPLICATION_PACK_V1:
        raise ApplicationPackContractError("application pack schema version is not v1")
    sources = _validate_source_artifacts(value["source_artifacts"])
    _validate_candidate_snapshot(value["candidate_snapshot"])
    for key in ("job", "fit_summary", "completion_metrics"):
        if not isinstance(value[key], dict):
            raise ApplicationPackContractError(f"{key} must be an object")
    if not isinstance(value["completion_issues"], list):
        raise ApplicationPackContractError("completion_issues must be an array")
    _validate_review_authorizations(value, sources)

    if source_profile_artifact is None:
        return
    profile_ref = sources["profile_snapshot"]
    if (
        source_profile_artifact.get("id") != profile_ref["artifact_id"]
        or source_profile_artifact.get("artifact_type") != profile_ref["artifact_type"]
        or source_profile_artifact.get("content_id") != profile_ref["content_id"]
    ):
        raise ApplicationPackContractError("source Profile artifact reference mismatch")
    expected = build_candidate_snapshot(source_profile_artifact)
    if value["candidate_snapshot"] != expected:
        raise ApplicationPackContractError(
            "candidate_snapshot is not the exact projection of the source Profile artifact"
        )
