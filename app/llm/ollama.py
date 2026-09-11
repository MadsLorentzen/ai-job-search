"""Ollama HTTP implementation of the provider-neutral LLM contract."""

import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.llm.exceptions import ProviderConnectionError, ProviderTimeoutError, LLMError
from app.llm.provider import LLMRequest, LLMResponse


class OllamaProvider:
    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3.2"):
        self.base_url = base_url.rstrip("/")
        self.default_model = model

    def health_check(self) -> bool:
        try:
            self._request("/api/version", {}, timeout_seconds=5.0)
        except LLMError:
            return False
        return True

    def list_models(self) -> list[str]:
        payload = self._request("/api/tags", {}, timeout_seconds=10.0)
        return [item["name"] for item in payload.get("models", []) if item.get("name")]

    def generate(self, request: LLMRequest) -> LLMResponse:
        model = request.model or self.default_model
        prompt = f"{request.system_prompt}\n\n{request.user_prompt}"
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": request.temperature,
            },
        }
        if request.max_tokens is not None:
            payload["options"]["num_predict"] = request.max_tokens
        if request.response_format == "json":
            payload["format"] = "json"

        started = time.monotonic()
        result = self._request(
            "/api/generate",
            payload,
            timeout_seconds=request.timeout_seconds,
        )
        text = result.get("response")
        if not isinstance(text, str):
            raise LLMError("Ollama response did not contain a text response")
        return LLMResponse(
            text=text,
            model=model,
            latency_ms=round((time.monotonic() - started) * 1000),
            raw=result,
        )

    def _request(self, path: str, payload: dict, timeout_seconds: float) -> dict:
        request = Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8") if payload else None,
            headers={"Content-Type": "application/json"},
            method="POST" if payload else "GET",
        )
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ProviderConnectionError(f"Ollama HTTP {exc.code}: {detail[:500]}") from exc
        except TimeoutError as exc:
            raise ProviderTimeoutError(f"Ollama request timed out: {exc}") from exc
        except URLError as exc:
            raise ProviderConnectionError(f"Ollama endpoint is unreachable: {exc}") from exc
        try:
            value = json.loads(body)
        except json.JSONDecodeError as exc:
            raise LLMError("Ollama returned malformed JSON") from exc
        if not isinstance(value, dict):
            raise LLMError("Ollama returned a non-object JSON response")
        if "error" in value:
            raise LLMError(f"Ollama error: {value['error']}")
        return value