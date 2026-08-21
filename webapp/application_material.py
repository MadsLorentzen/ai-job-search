"""Pure completion checks for reviewed, user-usable application material."""
from __future__ import annotations

from typing import Any


MATERIAL_COLLECTIONS = ("cv_content", "cover_letter_content")
NO_USABLE_MATERIAL = "no_reviewed_usable_application_material"


def usable_application_units(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        unit
        for collection in MATERIAL_COLLECTIONS
        for unit in payload.get(collection, [])
        if isinstance(unit, dict)
        and isinstance(unit.get("text"), str)
        and bool(unit["text"].strip())
    ]


def application_material_completion(payload: dict[str, Any]) -> dict[str, Any]:
    usable = usable_application_units(payload)
    return {
        "status": "READY" if usable else "INCOMPLETE",
        "issues": [] if usable else [NO_USABLE_MATERIAL],
        "usable_unit_count": len(usable),
    }


def application_material_is_completion_ready(payload: dict[str, Any]) -> bool:
    return application_material_completion(payload)["status"] == "READY"
