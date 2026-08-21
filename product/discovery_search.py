from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


SUPPORTED_DISCOVERY_SOURCES = ("freehire-search", "linkedin-search")
SOURCE_CLI_PATHS = {
    "freehire-search": Path(".agents/skills/freehire-search/cli/src/cli.ts"),
    "linkedin-search": Path(".agents/skills/linkedin-search/cli/src/cli.ts"),
}


class DiscoverySourceError(RuntimeError):
    pass


class DiscoveryPortalRunner(Protocol):
    def search(
        self,
        source: str,
        *,
        queries: list[str],
        locations: list[str],
        recency_days: int,
        limit: int,
        remote_mode: str | None = None,
    ) -> list[dict[str, Any]]: ...


@dataclass(frozen=True)
class CliDiscoveryPortalRunner:
    root: Path
    timeout_seconds: int = 45

    def search(
        self,
        source: str,
        *,
        queries: list[str],
        locations: list[str],
        recency_days: int,
        limit: int,
        remote_mode: str | None = None,
    ) -> list[dict[str, Any]]:
        if source not in SUPPORTED_DISCOVERY_SOURCES:
            raise DiscoverySourceError(f"unsupported discovery source {source!r}")
        if source == "linkedin-search" and not locations:
            raise DiscoverySourceError("LinkedIn search requires at least one location")
        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        query_values = queries or [""]
        location_values = locations if source == "linkedin-search" else [""]
        for query in query_values:
            for location in location_values:
                remaining = limit - len(results)
                if remaining <= 0:
                    return results
                payload = self._search_once(
                    source,
                    query=query,
                    location=location,
                    recency_days=recency_days,
                    limit=remaining,
                    remote_mode=remote_mode,
                )
                for item in payload:
                    identity = str(item.get("id", ""))
                    if not identity or identity in seen:
                        continue
                    seen.add(identity)
                    if source == "linkedin-search":
                        item = self._detail(source, identity)
                    results.append(item)
                    if len(results) >= limit:
                        return results
        return results

    def _search_once(
        self, source: str, *, query: str, location: str, recency_days: int, limit: int,
        remote_mode: str | None,
    ) -> list[dict[str, Any]]:
        args = ["search", "--format", "json", "--limit", str(limit)]
        if query:
            args.extend(["--query", query])
        if remote_mode is not None:
            if remote_mode not in {"remote", "hybrid", "onsite"}:
                raise DiscoverySourceError("remote mode must be remote, hybrid, or onsite")
            args.extend(["--remote", remote_mode])
        if source == "linkedin-search":
            args.extend(["--location", location])
            # LinkedIn exposes a controlled recency set; round outward so the
            # source never silently excludes jobs within the requested window.
            allowed = next((days for days in (1, 7, 14, 30) if days >= recency_days), None)
            if allowed is not None:
                args.extend(["--jobage", str(allowed)])
        else:
            args.extend(["--jobage", str(recency_days), "--description-format", "markdown"])
        payload = self._run(source, args)
        results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list):
            raise DiscoverySourceError(f"{source} returned an invalid search envelope")
        return results

    def _detail(self, source: str, record_id: str) -> dict[str, Any]:
        payload = self._run(source, ["detail", record_id, "--format", "json"])
        if not isinstance(payload, dict):
            raise DiscoverySourceError(f"{source} returned an invalid detail record")
        return payload

    def _run(self, source: str, args: list[str]) -> Any:
        cli = self.root / SOURCE_CLI_PATHS[source]
        if not cli.is_file():
            raise DiscoverySourceError(f"installed CLI for {source} was not found")
        try:
            completed = subprocess.run(
                ["bun", "run", str(cli), *args],
                cwd=self.root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=self.timeout_seconds,
                check=False,
                shell=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise DiscoverySourceError(f"{source} could not run: {exc}") from exc
        if completed.returncode != 0:
            message = completed.stderr.strip() or "portal CLI failed"
            raise DiscoverySourceError(f"{source} failed: {message[:500]}")
        try:
            return json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise DiscoverySourceError(f"{source} returned invalid JSON") from exc
