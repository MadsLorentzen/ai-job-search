#!/usr/bin/env python3
"""Regenerate Lane B's golden render snapshots. Run manually with
`python -m tests.fixtures.application_intelligence.scenarios.update_snapshots`
after a deliberate, understood change to generation behavior. Never run
automatically by pytest -- normal test runs compare against these files and
fail on drift, they do not rewrite them."""

from __future__ import annotations

import json
from pathlib import Path

from product.application_intelligence import DEFAULT_POLICY, analyze_application_intelligence

from tests.test_lane_b_scenarios import SCENARIO_DIR, _canned_proposal_covering_all_evidence, build_request, scenario

GOLDEN_DIR = SCENARIO_DIR / "golden"
SCENARIO_NAMES = ("strong_evidence", "sparse_evidence", "transferable_only", "gaps", "conflicting_evidence")


def _render_summary(result: dict) -> dict:
    return {
        "cv_content": [{"unit_id": u["unit_id"], "unit_type": u["unit_type"], "status": u["status"], "text": u["text"]} for u in result["cv_content"]],
        "cover_letter_content": [{"unit_id": u["unit_id"], "unit_type": u["unit_type"], "status": u["status"], "text": u["text"]} for u in result["cover_letter_content"]],
        "requirement_coverage": result["requirement_coverage"],
        "status": result["status"],
    }


def main() -> None:
    GOLDEN_DIR.mkdir(exist_ok=True)
    for name in SCENARIO_NAMES:
        payload = scenario(name)
        request = build_request(payload, f"laneb-golden-{name}")
        proposal = _canned_proposal_covering_all_evidence(payload)
        result = analyze_application_intelligence(request, proposal)
        summary = _render_summary(result)
        (GOLDEN_DIR / f"{name}.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8",
        )
        print(f"wrote golden/{name}.json")


if __name__ == "__main__":
    main()
