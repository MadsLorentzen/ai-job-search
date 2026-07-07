from __future__ import annotations

import argparse
import os
from pathlib import Path

from orchestrator.adapters.openai_adapter import OpenAIChatAdapter


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PoC health check for the OpenAI chat adapter.")
    parser.add_argument("--env-file", default=None, help="Optional .env file containing OPENAI_API_KEY or OPEN_AI_API_KEY.")
    parser.add_argument("--model", default=os.environ.get("OPENAI_MODEL", "gpt-4o"))
    args = parser.parse_args(argv)

    if args.env_file:
        load_env_file(Path(args.env_file))

    adapter = OpenAIChatAdapter(model=args.model)
    response = adapter.send_chat(
        [
            {
                "role": "system",
                "content": "You are a health-check endpoint for a Python adapter. Return strict JSON only.",
            },
            {
                "role": "user",
                "content": 'Return {"ok": true, "backend": "openai_chat", "purpose": "adapter_poc"}.',
            },
        ],
        max_tokens=80,
        temperature=0.0,
    )

    print(response["text"].strip())
    usage = response.get("usage") or {}
    if usage:
        print(f"usage={usage}")
    return 0


def load_env_file(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)
    if "OPENAI_API_KEY" not in os.environ and "OPEN_AI_API_KEY" in os.environ:
        os.environ["OPENAI_API_KEY"] = os.environ["OPEN_AI_API_KEY"]


if __name__ == "__main__":
    raise SystemExit(main())
