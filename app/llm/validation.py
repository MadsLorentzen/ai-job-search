"""Small, dependency-free validators for model-generated JSON."""

import json
import re
from typing import Any, Dict, List, Optional, Tuple

from app.llm.exceptions import SchemaValidationError


def extract_json_payload(raw_text: str) -> str:
    """Extract an object or array from common markdown/prose wrappers."""
    text = raw_text.strip()
    match = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()

    start_candidates = [index for index in (text.find("{"), text.find("[")) if index != -1]
    if not start_candidates:
        return text
    start = min(start_candidates)
    end = max(text.rfind("}"), text.rfind("]"))
    return text[start : end + 1] if end > start else text


def parse_json_payload(raw_text: str) -> Any:
    """Extract and parse JSON, raising a typed validation error."""
    payload = extract_json_payload(raw_text)
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise SchemaValidationError(f"Invalid JSON: {exc.msg}") from exc


def validate_dict_schema(
    data: Dict[str, Any],
    required_keys: List[str],
    field_types: Optional[Dict[str, type]] = None,
) -> Tuple[bool, List[str]]:
    """Validate required keys and primitive field types."""
    errors: List[str] = []
    for key in required_keys:
        if key not in data:
            errors.append(f"Missing required field: '{key}'")
    if field_types:
        for field, expected_type in field_types.items():
            if field in data and data[field] is not None and not isinstance(data[field], expected_type):
                errors.append(
                    f"Field '{field}' must be of type {expected_type.__name__}, "
                    f"got {type(data[field]).__name__}"
                )
    return len(errors) == 0, errors


def validate_json_dict(
    raw_text: str,
    required_keys: List[str],
    field_types: Optional[Dict[str, type]] = None,
) -> Dict[str, Any]:
    """Parse and validate a JSON object, raising one typed error on failure."""
    data = parse_json_payload(raw_text)
    if not isinstance(data, dict):
        raise SchemaValidationError("Expected a JSON object")
    valid, errors = validate_dict_schema(data, required_keys, field_types)
    if not valid:
        raise SchemaValidationError("; ".join(errors))
    return data


def build_repair_prompt(original_output: str, error_messages: List[str]) -> str:
    """Build a minimal prompt asking for corrected JSON only."""
    formatted_errors = "\n".join(f"- {error}" for error in error_messages)
    return (
        "Your previous response failed validation with the following errors:\n"
        f"{formatted_errors}\n\n"
        "Please provide ONLY a valid JSON object matching the requested structure "
        "without markdown wrappers or explanatory text.\n"
        f"Original raw output:\n{original_output}"
    )