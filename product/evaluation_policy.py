#!/usr/bin/env python3
"""Deterministic Evaluation Policy v0 loading, validation, and scoring.

This product-layer policy encodes executable mechanics from the canonical job
evaluation methodology without copying the workflow prose or interpreting jobs,
profiles, or extensions. It never creates candidate evidence.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable


SCHEMA_PATH = Path(__file__).with_name("schemas") / "evaluation-policy.v0.schema.json"
POLICY_PATH = Path(__file__).with_name("evaluation-policy.v0.json")
POLICY_CONTRACT = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
SCHEMA_VERSION = POLICY_CONTRACT["properties"]["schema_version"]["const"]
METHODOLOGY_REFERENCE = POLICY_CONTRACT["properties"]["methodology_reference"]["const"]
ID_RE = re.compile(POLICY_CONTRACT["$defs"]["id"]["pattern"])

REQUIRED_GATE_IDS = {"eligibility", "language", "location_logistics"}
REQUIRED_DIMENSION_IDS = {
    "technical_skills",
    "experience_match",
    "behavioral_fit",
    "career_alignment",
}
GATE_STATUSES = set(
    POLICY_CONTRACT["properties"]["gate_statuses"]["items"]["enum"]
)
EXPERIENCE_MATCH_CLASSES = set(
    POLICY_CONTRACT["properties"]["experience_match_classes"]["items"]["enum"]
)


class EvaluationPolicyValidationError(ValueError):
    """Raised when policy or evaluation input violates the v0 contract."""

    def __init__(self, errors: str | Iterable[str]):
        if isinstance(errors, str):
            self.errors = [errors]
        else:
            self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def load_evaluation_policy(path: str | Path | None = None) -> dict[str, Any]:
    """Load and validate the passive Evaluation Policy v0 JSON contract."""

    policy_path = POLICY_PATH if path is None else Path(path)
    try:
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvaluationPolicyValidationError(
            f"invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    validate_evaluation_policy(policy)
    return policy


def validate_evaluation_policy(policy: Any) -> None:
    """Validate the v0 policy shape and relational rules."""

    errors: list[str] = []
    if not isinstance(policy, dict):
        raise EvaluationPolicyValidationError("$: policy must be an object")

    required = {
        "schema_version",
        "id",
        "methodology_reference",
        "gate_statuses",
        "experience_match_classes",
        "gates",
        "dimensions",
        "verdict_thresholds",
        "rounding",
    }
    _object_shape(policy, required, required, "$", errors)
    if policy.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"$.schema_version: unsupported policy version; expected {SCHEMA_VERSION!r}")
    _id(policy.get("id"), "$.id", errors)
    if policy.get("methodology_reference") != METHODOLOGY_REFERENCE:
        errors.append(f"$.methodology_reference: must point to the canonical methodology")

    statuses = _string_list(policy.get("gate_statuses"), "$.gate_statuses", errors)
    if set(statuses) != GATE_STATUSES:
        errors.append("$.gate_statuses: must match the schema-owned v0 status enum")
    classes = _string_list(
        policy.get("experience_match_classes"),
        "$.experience_match_classes",
        errors,
    )
    if set(classes) != EXPERIENCE_MATCH_CLASSES:
        errors.append(
            "$.experience_match_classes: must match the schema-owned v0 class enum"
        )
    if any("title" in item for item in classes):
        errors.append(
            "$.experience_match_classes: title equality must not be an experience class"
        )

    gate_ids = _validate_gates(policy.get("gates"), errors)
    if gate_ids != REQUIRED_GATE_IDS:
        errors.append("$.gates: must contain exactly eligibility, language, and location_logistics")
    dimension_ids = _validate_dimensions(policy.get("dimensions"), errors)
    if dimension_ids != REQUIRED_DIMENSION_IDS:
        errors.append("$.dimensions: must contain exactly the four scored v0 dimensions")
    _validate_verdict_thresholds(policy.get("verdict_thresholds"), errors)
    _validate_rounding(policy.get("rounding"), errors)

    if errors:
        raise EvaluationPolicyValidationError(errors)


def normalized_evaluation_policy(policy: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return a validated deep copy with deterministic key ordering."""

    if policy is None:
        policy = load_evaluation_policy()
    validate_evaluation_policy(policy)
    return json.loads(normalized_evaluation_policy_json(policy))


def normalized_evaluation_policy_json(policy: dict[str, Any] | None = None) -> str:
    """Return canonical JSON for deterministic inspection."""

    if policy is None:
        policy = load_evaluation_policy()
    validate_evaluation_policy(policy)
    return json.dumps(policy, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def validate_experience_class(value: Any, policy: dict[str, Any] | None = None) -> None:
    """Validate a supplied experience-match classification label."""

    if policy is None:
        policy = load_evaluation_policy()
    validate_evaluation_policy(policy)
    if not isinstance(value, str) or value not in set(policy["experience_match_classes"]):
        raise EvaluationPolicyValidationError(
            f"experience_class: must be one of {', '.join(policy['experience_match_classes'])}"
        )


def calculate_overall_score(
    dimension_scores: dict[str, Any],
    policy: dict[str, Any] | None = None,
) -> float:
    """Calculate a deterministic weighted score from required dimension scores."""

    if policy is None:
        policy = load_evaluation_policy()
    validate_evaluation_policy(policy)
    scores = _validated_dimension_scores(dimension_scores, policy)
    total = Decimal("0")
    for dimension in policy["dimensions"]:
        score = Decimal(str(scores[dimension["id"]]))
        weight = Decimal(str(dimension["weight"]))
        total += score * weight
    return float(_round_score(total, policy))


def classify_verdict(
    overall_score: Any,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return the machine-readable verdict for a validated overall score."""

    if policy is None:
        policy = load_evaluation_policy()
    validate_evaluation_policy(policy)
    score = _score(overall_score, "$.overall_score")
    for threshold in policy["verdict_thresholds"]:
        lower = Decimal(str(threshold["min_score"]))
        upper = threshold["max_score_exclusive"]
        if score >= lower and (upper is None or score < Decimal(str(upper))):
            return {
                "id": threshold["id"],
                "display_name": threshold["display_name"],
                "score": float(score),
            }
    raise EvaluationPolicyValidationError(
        f"$.overall_score: no verdict threshold covers {overall_score!r}"
    )


def evaluate_scores(
    dimension_scores: dict[str, Any],
    gate_results: dict[str, Any] | list[dict[str, Any]] | None = None,
    policy: dict[str, Any] | None = None,
    notes: list[str] | None = None,
) -> dict[str, Any]:
    """Evaluate supplied gate states and dimension scores against the policy.

    Gate failures are valid evaluation state, so they return a blocked result
    instead of raising. Malformed inputs still raise validation errors.
    """

    if policy is None:
        policy = load_evaluation_policy()
    validate_evaluation_policy(policy)
    normalized_gates = _normalized_gate_results(gate_results, policy)
    blocking_gate_ids = _blocking_gate_ids(normalized_gates, policy)
    scores = _validated_dimension_scores(dimension_scores, policy)
    flags = [
        {"gate_id": gate["gate_id"], "status": gate["status"], "reason": gate.get("reason")}
        for gate in normalized_gates
        if gate["status"] == "FLAG"
    ]

    result = {
        "policy_version": policy["schema_version"],
        "gate_results": normalized_gates,
        "dimension_scores": scores,
        "overall_score": None,
        "verdict": None,
        "blocked": bool(blocking_gate_ids),
        "blocking_gate_ids": blocking_gate_ids,
        "flags": flags,
        "notes": list(notes or []),
    }
    if blocking_gate_ids:
        result["notes"].append("Scoring blocked by hard-stop gate failure.")
        return result

    overall = calculate_overall_score(scores, policy)
    result["dimension_scores"] = scores
    result["overall_score"] = overall
    result["verdict"] = classify_verdict(overall, policy)
    return result


def _validate_gates(value: Any, errors: list[str]) -> set[str]:
    gates = _list(value, "$.gates", errors)
    ids: set[str] = set()
    for index, gate in enumerate(gates):
        path = f"$.gates[{index}]"
        if not _object_shape(
            gate,
            {
                "id",
                "display_name",
                "description",
                "blocking_statuses",
                "warning_statuses",
                "unverified_statuses",
                "proceed_statuses",
            },
            {
                "id",
                "display_name",
                "description",
                "blocking_statuses",
                "warning_statuses",
                "unverified_statuses",
                "proceed_statuses",
            },
            path,
            errors,
        ):
            continue
        gate_id = gate.get("id")
        _id(gate_id, f"{path}.id", errors)
        if isinstance(gate_id, str):
            if gate_id in ids:
                errors.append(f"{path}.id: duplicate gate id {gate_id!r}")
            ids.add(gate_id)
        _nonempty_string(gate.get("display_name"), f"{path}.display_name", errors)
        _nonempty_string(gate.get("description"), f"{path}.description", errors)
        status_sets: dict[str, set[str]] = {}
        for field in (
            "blocking_statuses",
            "warning_statuses",
            "unverified_statuses",
            "proceed_statuses",
        ):
            statuses = _string_list(gate.get(field), f"{path}.{field}", errors)
            status_sets[field] = set(statuses)
            for item_index, status in enumerate(statuses):
                if status not in GATE_STATUSES:
                    errors.append(f"{path}.{field}[{item_index}]: unknown gate status {status!r}")
        if "FAIL" not in status_sets.get("blocking_statuses", set()):
            errors.append(f"{path}.blocking_statuses: FAIL must be blocking")
        contradictions = (
            status_sets.get("blocking_statuses", set())
            & status_sets.get("proceed_statuses", set())
        )
        if contradictions:
            errors.append(
                f"{path}: blocking_statuses and proceed_statuses overlap: "
                f"{', '.join(sorted(contradictions))}"
            )
    return ids


def _validate_dimensions(value: Any, errors: list[str]) -> set[str]:
    dimensions = _list(value, "$.dimensions", errors)
    ids: set[str] = set()
    weight_total = Decimal("0")
    for index, dimension in enumerate(dimensions):
        path = f"$.dimensions[{index}]"
        if not _object_shape(
            dimension,
            {"id", "display_name", "description", "weight", "score_min", "score_max", "bands"},
            {"id", "display_name", "description", "weight", "score_min", "score_max", "bands"},
            path,
            errors,
        ):
            continue
        dimension_id = dimension.get("id")
        _id(dimension_id, f"{path}.id", errors)
        if isinstance(dimension_id, str):
            if dimension_id in ids:
                errors.append(f"{path}.id: duplicate dimension id {dimension_id!r}")
            ids.add(dimension_id)
        _nonempty_string(dimension.get("display_name"), f"{path}.display_name", errors)
        _nonempty_string(dimension.get("description"), f"{path}.description", errors)
        weight = _finite_decimal(dimension.get("weight"), f"{path}.weight", errors)
        if weight is not None:
            if weight < 0 or weight > 1:
                errors.append(f"{path}.weight: must be between 0 and 1")
            weight_total += weight
        if dimension.get("score_min") != 0:
            errors.append(f"{path}.score_min: must be 0")
        if dimension.get("score_max") != 100:
            errors.append(f"{path}.score_max: must be 100")
        _validate_contiguous_bands(dimension.get("bands"), path, errors)
    if dimensions and weight_total != Decimal("1.0"):
        errors.append("$.dimensions: weights must sum to 1.0")
    return ids


def _validate_contiguous_bands(value: Any, parent_path: str, errors: list[str]) -> None:
    bands = _list(value, f"{parent_path}.bands", errors)
    expected = Decimal("0")
    for index, band in enumerate(bands):
        path = f"{parent_path}.bands[{index}]"
        if not _object_shape(
            band,
            {"min_score", "max_score_exclusive", "label", "description"},
            {"min_score", "max_score_exclusive", "label", "description"},
            path,
            errors,
        ):
            continue
        minimum = _finite_decimal(band.get("min_score"), f"{path}.min_score", errors)
        maximum = None
        if band.get("max_score_exclusive") is not None:
            maximum = _finite_decimal(
                band.get("max_score_exclusive"),
                f"{path}.max_score_exclusive",
                errors,
            )
        _id(band.get("label"), f"{path}.label", errors)
        _nonempty_string(band.get("description"), f"{path}.description", errors)
        if minimum is None:
            continue
        if minimum != expected:
            errors.append(f"{path}.min_score: expected contiguous lower bound {expected}")
        if maximum is None:
            expected = Decimal("100")
            continue
        if maximum <= minimum:
            errors.append(f"{path}.max_score_exclusive: must exceed min_score")
        expected = maximum
    if bands and expected != Decimal("100"):
        errors.append(f"{parent_path}.bands: must cover scores from 0 through 100")


def _validate_verdict_thresholds(value: Any, errors: list[str]) -> None:
    thresholds = _list(value, "$.verdict_thresholds", errors)
    ids: set[str] = set()
    expected = Decimal("0")
    for index, threshold in enumerate(thresholds):
        path = f"$.verdict_thresholds[{index}]"
        if not _object_shape(
            threshold,
            {"id", "display_name", "min_score", "max_score_exclusive"},
            {"id", "display_name", "min_score", "max_score_exclusive"},
            path,
            errors,
        ):
            continue
        verdict_id = threshold.get("id")
        _id(verdict_id, f"{path}.id", errors)
        if isinstance(verdict_id, str):
            if verdict_id in ids:
                errors.append(f"{path}.id: duplicate verdict id {verdict_id!r}")
            ids.add(verdict_id)
        _nonempty_string(threshold.get("display_name"), f"{path}.display_name", errors)
        minimum = _finite_decimal(threshold.get("min_score"), f"{path}.min_score", errors)
        maximum = None
        if threshold.get("max_score_exclusive") is not None:
            maximum = _finite_decimal(
                threshold.get("max_score_exclusive"),
                f"{path}.max_score_exclusive",
                errors,
            )
        if minimum is None:
            continue
        if minimum != expected:
            errors.append(f"{path}.min_score: expected contiguous lower bound {expected}")
        if maximum is None:
            expected = Decimal("100")
            continue
        if maximum <= minimum:
            errors.append(f"{path}.max_score_exclusive: must exceed min_score")
        expected = maximum
    if thresholds and expected != Decimal("100"):
        errors.append("$.verdict_thresholds: must cover scores from 0 through 100")


def _validate_rounding(value: Any, errors: list[str]) -> None:
    if not _object_shape(
        value,
        {"mode", "decimal_places"},
        {"mode", "decimal_places"},
        "$.rounding",
        errors,
    ):
        return
    if value.get("mode") != "half_up":
        errors.append("$.rounding.mode: must be 'half_up'")
    if value.get("decimal_places") != 1:
        errors.append("$.rounding.decimal_places: must be 1")


def _validated_dimension_scores(
    dimension_scores: Any,
    policy: dict[str, Any],
) -> dict[str, float]:
    if not isinstance(dimension_scores, dict):
        raise EvaluationPolicyValidationError("$.dimension_scores: must be an object")
    expected = {dimension["id"] for dimension in policy["dimensions"]}
    supplied = set(dimension_scores)
    missing = expected - supplied
    unknown = supplied - expected
    errors: list[str] = []
    for key in sorted(missing):
        errors.append(f"$.dimension_scores.{key}: required score is missing")
    for key in sorted(unknown):
        errors.append(f"$.dimension_scores.{key}: unknown scored dimension")
    result: dict[str, float] = {}
    for key in sorted(expected & supplied):
        try:
            result[key] = float(_score(dimension_scores[key], f"$.dimension_scores.{key}"))
        except EvaluationPolicyValidationError as exc:
            errors.extend(exc.errors)
    if errors:
        raise EvaluationPolicyValidationError(errors)
    return result


def _normalized_gate_results(
    gate_results: dict[str, Any] | list[dict[str, Any]] | None,
    policy: dict[str, Any],
) -> list[dict[str, Any]]:
    gate_ids = [gate["id"] for gate in policy["gates"]]
    if gate_results is None:
        raw = {gate_id: "UNVERIFIED" for gate_id in gate_ids}
    elif isinstance(gate_results, dict):
        raw = gate_results
    elif isinstance(gate_results, list):
        raw = {}
        for index, item in enumerate(gate_results):
            if not isinstance(item, dict):
                raise EvaluationPolicyValidationError(
                    f"$.gate_results[{index}]: must be an object"
                )
            gate_id = item.get("gate_id")
            if gate_id in raw:
                raise EvaluationPolicyValidationError(
                    f"$.gate_results[{index}].gate_id: duplicate gate result {gate_id!r}"
                )
            raw[gate_id] = item
    else:
        raise EvaluationPolicyValidationError("$.gate_results: must be an object or array")

    unknown = set(raw) - set(gate_ids)
    if unknown:
        raise EvaluationPolicyValidationError(
            [f"$.gate_results.{gate_id}: unknown gate id" for gate_id in sorted(unknown)]
        )

    results: list[dict[str, Any]] = []
    for gate_id in gate_ids:
        item = raw.get(gate_id, "UNVERIFIED")
        if isinstance(item, str):
            status = item
            reason = None
        elif isinstance(item, dict):
            status = item.get("status")
            reason = item.get("reason")
        else:
            raise EvaluationPolicyValidationError(
                f"$.gate_results.{gate_id}: must be a status string or object"
            )
        if status not in GATE_STATUSES:
            raise EvaluationPolicyValidationError(
                f"$.gate_results.{gate_id}.status: unknown gate status {status!r}"
            )
        normalized = {"gate_id": gate_id, "status": status}
        if reason is not None:
            if not isinstance(reason, str) or not reason.strip():
                raise EvaluationPolicyValidationError(
                    f"$.gate_results.{gate_id}.reason: must be a non-empty string"
                )
            normalized["reason"] = reason
        results.append(normalized)
    return results


def _blocking_gate_ids(
    gate_results: list[dict[str, Any]],
    policy: dict[str, Any],
) -> list[str]:
    blocking_by_gate = {
        gate["id"]: set(gate["blocking_statuses"])
        for gate in policy["gates"]
    }
    return [
        result["gate_id"]
        for result in gate_results
        if result["status"] in blocking_by_gate[result["gate_id"]]
    ]


def _score(value: Any, path: str) -> Decimal:
    errors: list[str] = []
    score = _finite_decimal(value, path, errors)
    if score is None:
        raise EvaluationPolicyValidationError(errors)
    if score < 0 or score > 100:
        raise EvaluationPolicyValidationError(f"{path}: score must be between 0 and 100")
    return score


def _round_score(value: Decimal, policy: dict[str, Any]) -> Decimal:
    places = int(policy["rounding"]["decimal_places"])
    quantum = Decimal("1").scaleb(-places)
    return value.quantize(quantum, rounding=ROUND_HALF_UP)


def _object_shape(
    value: Any,
    required: set[str],
    allowed: set[str],
    path: str,
    errors: list[str],
) -> bool:
    if not isinstance(value, dict):
        errors.append(f"{path}: must be an object")
        return False
    missing = required - value.keys()
    unknown = value.keys() - allowed
    for key in sorted(missing):
        errors.append(f"{path}.{key}: required field is missing")
    for key in sorted(unknown):
        errors.append(f"{path}.{key}: unsupported field")
    return not missing


def _list(value: Any, path: str, errors: list[str]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(f"{path}: must be an array")
        return []
    return value


def _string_list(value: Any, path: str, errors: list[str]) -> list[str]:
    items = _list(value, path, errors)
    result: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        if not isinstance(item, str) or not item.strip():
            errors.append(f"{path}[{index}]: must be a non-empty string")
            continue
        if item in seen:
            errors.append(f"{path}[{index}]: duplicate value {item!r}")
        seen.add(item)
        result.append(item)
    return result


def _nonempty_string(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: must be a non-empty string")


def _id(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        errors.append(f"{path}: must match schema id pattern {ID_RE.pattern!r}")


def _finite_decimal(value: Any, path: str, errors: list[str]) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        errors.append(f"{path}: must be numeric")
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        errors.append(f"{path}: must be finite")
        return None
    try:
        decimal_value = Decimal(str(value))
    except Exception:
        errors.append(f"{path}: must be numeric")
        return None
    if not decimal_value.is_finite():
        errors.append(f"{path}: must be finite")
        return None
    return decimal_value


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect Evaluation Policy v0")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_parser = subparsers.add_parser("validate", help="validate a policy file")
    validate_parser.add_argument("path", nargs="?", type=Path, default=POLICY_PATH)
    show_parser = subparsers.add_parser("show", help="show normalized policy JSON")
    show_parser.add_argument("path", nargs="?", type=Path, default=POLICY_PATH)
    score_parser = subparsers.add_parser("score", help="calculate a weighted score")
    score_parser.add_argument("scores_json", help="JSON object of dimension scores")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.command == "validate":
            policy = load_evaluation_policy(args.path)
            print(json.dumps({"valid": True, "policy_version": policy["schema_version"]}))
        elif args.command == "show":
            policy = load_evaluation_policy(args.path)
            print(json.dumps(normalized_evaluation_policy(policy), ensure_ascii=False, indent=2))
        else:
            scores = json.loads(args.scores_json)
            policy = load_evaluation_policy()
            result = evaluate_scores(scores, policy=policy)
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except (EvaluationPolicyValidationError, FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors = exc.errors if isinstance(exc, EvaluationPolicyValidationError) else [str(exc)]
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
