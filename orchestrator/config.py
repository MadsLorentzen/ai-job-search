from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


DEFAULT_CONFIG_FILES = (
    ".ai-job-search.json",
    ".ai-job-search.config.json",
)


@dataclass
class SafetyConfig:
    local_only: bool = False
    log_full_prompts: bool = False


@dataclass
class OrchestratorConfig:
    backend: str = "mock"
    openai_model: str = "gpt-4o"
    codex_model: str = "gpt-4o"
    openai_base_url: str = "https://api.openai.com/v1"
    codex_endpoint: str | None = None
    max_tokens: int = 4096
    temperature: float = 0.1
    context_token_limit: int = 16000
    request_timeout_seconds: int = 60
    safety: SafetyConfig = field(default_factory=SafetyConfig)
    openai_api_key: str | None = None
    codex_api_key: str | None = None


def load_config(config_path: str | None = None, root: Path | None = None) -> OrchestratorConfig:
    """Load config from JSON and environment variables."""
    root = root or Path.cwd()
    raw: dict[str, Any] = {}
    path = _resolve_config_path(config_path, root)
    if path and path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))

    safety_raw = raw.get("safety", {}) if isinstance(raw.get("safety", {}), dict) else {}
    config = OrchestratorConfig(
        backend=raw.get("backend", "mock"),
        openai_model=raw.get("openai_model", "gpt-4o"),
        codex_model=raw.get("codex_model", raw.get("openai_model", "gpt-4o")),
        openai_base_url=raw.get("openai_base_url", "https://api.openai.com/v1"),
        codex_endpoint=raw.get("codex_endpoint"),
        max_tokens=int(raw.get("max_tokens", 4096)),
        temperature=float(raw.get("temperature", 0.1)),
        context_token_limit=int(raw.get("context_token_limit", 16000)),
        request_timeout_seconds=int(raw.get("request_timeout_seconds", 60)),
        safety=SafetyConfig(
            local_only=bool(safety_raw.get("local_only", False)),
            log_full_prompts=bool(safety_raw.get("log_full_prompts", False)),
        ),
        openai_api_key=os.environ.get("OPENAI_API_KEY") or os.environ.get("OPEN_AI_API_KEY"),
        codex_api_key=os.environ.get("CODEX_API_KEY"),
    )

    config.backend = os.environ.get("AI_JOB_SEARCH_BACKEND", config.backend)
    config.openai_model = os.environ.get("OPENAI_MODEL", config.openai_model)
    config.codex_model = os.environ.get("CODEX_MODEL", config.codex_model)
    config.openai_base_url = os.environ.get("OPENAI_BASE_URL", config.openai_base_url)
    config.codex_endpoint = os.environ.get("CODEX_COMPAT_ENDPOINT", config.codex_endpoint)
    return config


def _resolve_config_path(config_path: str | None, root: Path) -> Path | None:
    if config_path:
        return Path(config_path)
    for candidate in DEFAULT_CONFIG_FILES:
        path = root / candidate
        if path.exists():
            return path
    return None
