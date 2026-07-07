from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

from orchestrator.adapters.base import AdapterError, BaseAdapter


class CodexCompatAdapter(BaseAdapter):
    """Compatibility adapter for single-instruction, code-centric endpoints."""

    backend_name = "codex_compat"

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "gpt-4o",
        endpoint: str | None = None,
        token_limit: int = 16000,
        timeout: int = 60,
        max_retries: int = 3,
    ) -> None:
        self.api_key = api_key or os.environ.get("CODEX_API_KEY") or os.environ.get("OPENAI_API_KEY")
        self.model = model
        self.endpoint = endpoint or os.environ.get("CODEX_COMPAT_ENDPOINT")
        self.token_limit = token_limit
        self.timeout = timeout
        self.max_retries = max_retries

    def send_chat(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        stop: list[str] | None = None,
    ) -> dict[str, Any]:
        prompt = self.flatten_messages(messages)
        text = self.single_shot(prompt, max_tokens=max_tokens, temperature=temperature)
        return {"text": text, "usage": {"estimated_prompt_tokens": self.count_tokens(prompt)}}

    def single_shot(self, prompt: str, max_tokens: int, temperature: float) -> str:
        if not self.endpoint:
            raise AdapterError(
                "CODEX_COMPAT_ENDPOINT is required for codex_compat unless tests provide a mocked transport."
            )
        if not self.api_key:
            raise AdapterError("CODEX_API_KEY or OPENAI_API_KEY is required for codex_compat.")

        payload = {
            "model": self.model,
            "prompt": self.truncate_prompt(prompt),
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        data = self._post_json(payload)
        return self._extract_text(data)

    def flatten_messages(self, messages: list[dict[str, str]], reviewer_context: str | None = None) -> str:
        system_parts: list[str] = []
        history_parts: list[str] = []
        for message in messages:
            role = message.get("role", "user").upper()
            content = message.get("content", "")
            if role == "SYSTEM":
                system_parts.append(content)
            else:
                history_parts.append(f"{role}:\n{content}")

        instruction = "\n\n".join(history_parts).strip()
        context = self._extract_context_sections(instruction)
        sections = [
            "====SYSTEM====",
            "\n\n".join(system_parts).strip(),
            "====PROFILE====",
            context.get("profile", ""),
            "====JOB====",
            context.get("job", ""),
            "====CV====",
            context.get("cv", ""),
            "====COVER====",
            context.get("cover", ""),
        ]
        if reviewer_context:
            sections.extend(["====REVIEW CONTEXT START====", reviewer_context, "====REVIEW CONTEXT END===="])
        sections.extend(["====INSTRUCTION====", instruction])
        return "\n".join(section for section in sections if section != "")

    def _extract_context_sections(self, instruction: str) -> dict[str, str]:
        labels = {
            "profile": ["Candidate profile:", "Candidate profile (short):"],
            "job": ["Job posting:"],
            "cv": ["CV draft"],
            "cover": ["Cover letter draft"],
        }
        return {key: self._extract_after_any_label(instruction, options) for key, options in labels.items()}

    @staticmethod
    def _extract_after_any_label(text: str, labels: list[str]) -> str:
        starts = [(text.find(label), label) for label in labels if text.find(label) != -1]
        if not starts:
            return ""
        start_index, label = min(starts)
        start = start_index + len(label)
        next_markers = [
            "\n\nJob posting:",
            "\n\nCandidate profile:",
            "\n\nCandidate profile (short):",
            "\n\nCV draft",
            "\n\nCover letter draft",
            "\n\nReturn ",
            "\n\nResponse format",
            "\n\nParsed posting metadata:",
            "\n\nEvaluation JSON:",
        ]
        end_candidates = [text.find(marker, start) for marker in next_markers if text.find(marker, start) != -1]
        end = min(end_candidates) if end_candidates else len(text)
        return text[start:end].strip()

    def truncate_prompt(self, prompt: str) -> str:
        if self.count_tokens(prompt) <= self.token_limit:
            return prompt
        approx_chars = max(1000, self.token_limit * 4)
        return (
            prompt[:approx_chars]
            + "\n\n[TRUNCATED_TO_CONTEXT_LIMIT]\n"
            + "SEE_FULL_PROFILE: file://profile-path-provided-in-runner-output"
        )

    def _post_json(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
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
                    raise AdapterError(f"codex_compat endpoint error {exc.code}: {detail}") from exc
            except urllib.error.URLError as exc:
                last_error = exc
                if attempt == self.max_retries:
                    raise AdapterError(f"codex_compat endpoint request failed: {exc}") from exc
            time.sleep(min(2**attempt, 8))
        raise AdapterError(f"codex_compat endpoint request failed: {last_error}")

    @staticmethod
    def _extract_text(data: dict[str, Any]) -> str:
        if "text" in data:
            return str(data["text"])
        if "output_text" in data:
            return str(data["output_text"])
        try:
            choice = data["choices"][0]
            if "text" in choice:
                return str(choice["text"])
            return str(choice["message"]["content"])
        except (KeyError, IndexError, TypeError) as exc:
            raise AdapterError(f"Unexpected codex_compat response shape: {data!r}") from exc
