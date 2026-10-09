"""OpenAI-compatible chat completion adapter for local AI matching.

The adapter is provider-neutral and uses only the Python standard library.
Credentials are read from environment variables and never returned or logged.
Network calls are opt-in: callers must pass ``allow_external=True``.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class AIProviderError(RuntimeError):
    """A safe, user-facing provider error without secrets or raw payloads."""


_REQUEST_LOCK = threading.Lock()
_LAST_REQUEST_AT = 0.0
MAX_INPUT_CHARS = 180_000
MIN_REQUEST_INTERVAL = 0.5


@dataclass(frozen=True)
class OpenAICompatibleConfig:
    base_url: str
    model: str
    api_key: str | None
    timeout: float = 60.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.model)


def load_config(environ: dict[str, str] | None = None) -> OpenAICompatibleConfig:
    env = environ if environ is not None else os.environ
    base_url = (env.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
    model = (env.get("OPENAI_MODEL") or "").strip()
    api_key = (env.get("OPENAI_API_KEY") or "").strip() or None
    try:
        timeout = max(5.0, min(float(env.get("OPENAI_TIMEOUT", "60")), 180.0))
    except ValueError:
        timeout = 60.0
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        base_url = "https://api.openai.com/v1"
    return OpenAICompatibleConfig(base_url, model, api_key, timeout)


def build_match_messages(job_text: str, candidate_text: str) -> list[dict[str, str]]:
    system = (
        "你是求职匹配分析助手。只根据用户提供的候选人资料和职位正文分析，"
        "不得捏造经历、技能、语言、学历或薪资。返回严格 JSON，不要 Markdown。"
        "JSON 字段必须包含 technical、experience、behavioral、career（0-100 数字）、"
        "location_verdict、language_gate、strengths（字符串数组）、gaps（字符串数组）、summary（字符串）。"
    )
    user = json.dumps({"candidate": candidate_text, "job": job_text}, ensure_ascii=False)
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_request(config: OpenAICompatibleConfig, messages: list[dict[str, str]], *, include_response_format: bool = True) -> bytes:
    payload = {
        "model": config.model,
        "messages": messages,
        "temperature": 0.1,
    }
    if include_response_format:
        payload["response_format"] = {"type": "json_object"}
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _number(value: Any) -> int:
    if isinstance(value, bool):
        raise AIProviderError("模型返回的分数格式不正确")
    try:
        result = int(round(float(value)))
    except (TypeError, ValueError):
        raise AIProviderError("模型返回的分数格式不正确") from None
    if not 0 <= result <= 100:
        raise AIProviderError("模型返回的分数超出 0-100 范围")
    return result


def validate_match_result(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AIProviderError("模型返回的匹配结果不是 JSON 对象")
    result = {
        "technical": _number(value.get("technical")),
        "experience": _number(value.get("experience")),
        "behavioral": _number(value.get("behavioral")),
        "career": _number(value.get("career")),
        "location_verdict": str(value.get("location_verdict") or "FLAG"),
        "language_gate": str(value.get("language_gate") or "FLAG"),
        "strengths": [str(item) for item in value.get("strengths", []) if isinstance(item, str)][:3],
        "gaps": [str(item) for item in value.get("gaps", []) if isinstance(item, str)][:3],
        "summary": str(value.get("summary") or ""),
    }
    if result["location_verdict"] not in {"PASS", "FAIL", "FLAG"}:
        result["location_verdict"] = "FLAG"
    if result["language_gate"] not in {"PASS", "FAIL", "FLAG"}:
        result["language_gate"] = "FLAG"
    result["overall"] = round(result["technical"] * 0.30 + result["experience"] * 0.25 + result["behavioral"] * 0.15 + result["career"] * 0.30)
    return result


def extract_completion_result(payload: Any) -> dict[str, Any]:
    try:
        content = payload["choices"][0]["message"]["content"]
        parsed = json.loads(content) if isinstance(content, str) else content
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise AIProviderError("模型响应缺少可解析的匹配结果") from exc
    return validate_match_result(parsed)


def complete_match(config: OpenAICompatibleConfig, job_text: str, candidate_text: str, *, allow_external: bool = False) -> dict[str, Any]:
    if not allow_external:
        raise AIProviderError("未确认外部模型请求；当前为预览模式")
    if not config.configured:
        raise AIProviderError("未配置 OPENAI_API_KEY 或 OPENAI_MODEL")
    if len(job_text) + len(candidate_text) > MAX_INPUT_CHARS:
        raise AIProviderError("职位和候选人资料过长，请先缩短内容")
    messages = build_match_messages(job_text, candidate_text)
    global _LAST_REQUEST_AT
    with _REQUEST_LOCK:
        wait = MIN_REQUEST_INTERVAL - (time.monotonic() - _LAST_REQUEST_AT)
        if wait > 0:
            time.sleep(wait)
        _LAST_REQUEST_AT = time.monotonic()

    def request(include_response_format: bool) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{config.base_url}/chat/completions",
            data=build_request(config, messages, include_response_format=include_response_format),
            headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json", "User-Agent": "ai-job-search-local/0.1"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=config.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in {401, 403}:
                raise AIProviderError("AI 服务鉴权失败，请检查本机环境变量配置") from None
            if exc.code == 429:
                raise AIProviderError("AI 服务暂时限流，请稍后重试") from None
            if exc.code in {400, 404, 422} and include_response_format:
                return request(False)
            raise AIProviderError(f"AI 服务请求失败（HTTP {exc.code}）") from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            raise AIProviderError("AI 服务暂时不可用或返回格式无法解析") from None

    return extract_completion_result(request(True))


def redact_preview(value: str, max_chars: int = 5000) -> str:
    """Return a local-only preview with direct contact values masked."""
    value = value[:max_chars]
    value = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[邮箱已脱敏]", value)
    value = re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "[手机号已脱敏]", value)
    return value


def estimate_input_tokens(job_text: str, candidate_text: str) -> int:
    """Conservative token estimate for user-facing budget guidance."""
    return max(1, (len(job_text) + len(candidate_text)) // 4)
