from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from product.discovery_search import CliDiscoveryPortalRunner, DiscoverySourceError


def test_cli_runner_uses_allowlisted_argv_without_shell_and_bounds_linkedin_detail(tmp_path, monkeypatch):
    for source in ("freehire-search", "linkedin-search"):
        cli = tmp_path / f".agents/skills/{source}/cli/src/cli.ts"
        cli.parent.mkdir(parents=True)
        cli.write_text("// fixture", encoding="utf-8")
    calls = []

    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))
        if "detail" in argv:
            payload = {
                "id": argv[argv.index("detail") + 1], "title": "Planner", "company": "Energy Co",
                "url": "https://linkedin.com/jobs/view/planner-4426311357", "description": "Plan work.",
            }
        else:
            payload = {"meta": {"count": 1}, "results": [{"id": "4426311357"}]}
        return SimpleNamespace(returncode=0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("product.discovery_search.subprocess.run", fake_run)
    runner = CliDiscoveryPortalRunner(tmp_path)

    results = runner.search(
        "linkedin-search", queries=["planner"], locations=["London"], recency_days=10, limit=1
    )

    assert results[0]["description"] == "Plan work."
    assert len(calls) == 2
    assert all(call[1]["shell"] is False for call in calls)
    assert calls[0][0][:2] == ["bun", "run"]
    assert calls[0][0][-2:] == ["--jobage", "14"]
    assert calls[1][0][-3:] == ["4426311357", "--format", "json"]


def test_cli_runner_rejects_unknown_source_and_linkedin_without_location(tmp_path):
    runner = CliDiscoveryPortalRunner(tmp_path)
    with pytest.raises(DiscoverySourceError, match="unsupported"):
        runner.search("invented", queries=[], locations=[], recency_days=7, limit=10)
    with pytest.raises(DiscoverySourceError, match="requires at least one location"):
        runner.search("linkedin-search", queries=["planner"], locations=[], recency_days=7, limit=10)
