from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

from orchestrator.adapters.base import AdapterError, BaseAdapter


class OpenAIChatAdapter(BaseAdapter):
    """Adapter for the OpenAI Chat Completions API."""

    backend_name = "openai_chat"

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "gpt-4o",
        base_url: str = "https://api.openai.com/v1",
        timeout: int = 60,
        max_retries: int = 3,
    ) -> None:
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY") or os.environ.get("OPEN_AI_API_KEY")
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries

    def send_chat(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        stop: list[str] | None = None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise AdapterError("OPENAI_API_KEY is required for the openai backend. OPEN_AI_API_KEY is also accepted.")

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if stop:
            payload["stop"] = stop

        data = self._post_json(payload)
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise AdapterError(f"Unexpected OpenAI response shape: {data!r}") from exc
        return {"text": text, "usage": data.get("usage", {})}

    def single_shot(self, prompt: str, max_tokens: int, temperature: float) -> str:
        response = self.send_chat(
            [{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return self.response_text(response)

    def _post_json(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code not in {429, 500, 502, 503, 504} or attempt == self.max_retries:
                    detail = exc.read().decode("utf-8", errors="replace")
                    raise AdapterError(f"OpenAI API error {exc.code}: {detail}") from exc
            except urllib.error.URLError as exc:
                last_error = exc
                if attempt == self.max_retries:
                    raise AdapterError(f"OpenAI API request failed: {exc}") from exc
            time.sleep(min(2**attempt, 8))

        raise AdapterError(f"OpenAI API request failed: {last_error}")
