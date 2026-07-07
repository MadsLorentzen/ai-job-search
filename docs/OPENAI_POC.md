# OpenAI Adapter PoC

This proof of concept verifies the `openai_chat` adapter with a non-PII prompt. It does not upload candidate profile content, job postings, CVs, cover letters, or local repository files.

## Command

```powershell
python -m orchestrator.examples.openai_adapter_poc --env-file ..\.env --model gpt-4o
```

The script accepts either `OPENAI_API_KEY` or `OPEN_AI_API_KEY` and never prints the key.

## Verified Output

Run date: 2026-07-07

```text
{"ok": true, "backend": "openai_chat", "purpose": "adapter_poc"}
usage={'prompt_tokens': 50, 'completion_tokens': 21, 'total_tokens': 71, ...}
```

The usage object is provider metadata only. It is included here to show that the real adapter request completed.
