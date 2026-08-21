from __future__ import annotations

from product.application_material_contract import COMPLETION_CONTRACT_VERSION


def _words(count: int, prefix: str) -> str:
    return " ".join(f"{prefix}{index}" for index in range(count))


def completion_ready_pack_payload(marker: str = "ready") -> dict:
    units = [
        {
            "unit_id": f"{marker}_cv_bullet",
            "unit_type": "cv_bullet",
            "text": _words(10, f"{marker}b"),
            "status": "READY",
            "profile_evidence_ids": [],
        },
        {
            "unit_id": f"{marker}_cv_summary",
            "unit_type": "cv_summary_line",
            "text": _words(10, f"{marker}s"),
            "status": "READY",
            "profile_evidence_ids": [],
        },
        {
            "unit_id": f"{marker}_cover_paragraph",
            "unit_type": "cover_letter_paragraph",
            "text": _words(40, f"{marker}c"),
            "status": "READY",
            "profile_evidence_ids": [],
        },
    ]
    return {
        "completion_contract_version": COMPLETION_CONTRACT_VERSION,
        "completion_status": "READY",
        "cv_content": units[:2],
        "cover_letter_content": units[2:],
        "review_record": {
            "decisions_consulted": [
                {
                    "review_item_type": "content_unit",
                    "domain_item_id": unit["unit_id"],
                    "disposition": "acknowledged_and_proceed",
                }
                for unit in units
            ]
        },
    }
