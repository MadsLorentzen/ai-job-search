# Pluggable LLM Orchestrator

The orchestrator is an opt-in Python runner for the canonical ai-job-search `/apply` workflow. The existing Claude files stay authoritative: `.claude/commands/apply.md` defines the workflow and the markdown files under `.claude/skills/job-application-assistant/` define the profile, style, evaluation, CV, cover letter, and interview rules.

## Architecture

```text
job text file
  -> runner.py
  -> prompt templates
  -> adapter interface
  -> openai_chat | codex_compat | mock
  -> draft files
  -> reviewer structured edits
  -> LaTeX compile and optional pdftotext ATS check
  -> orchestrator_apply_report.md
```

The runner preserves the existing repo tools. Portal CLIs stay in `.agents/skills/`, `salary_lookup.py` remains optional, and LaTeX compilation still uses `lualatex` for CVs and `xelatex` for cover letters.

## Run Locally

Create a virtual environment and install test dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
```

Run a no-secret smoke test:

```bash
python -m orchestrator.runner apply \
  --job-text-file orchestrator/tests/fixtures/example_job.md \
  --profile orchestrator/tests/fixtures/example_profile.md \
  --backend mock \
  --output-dir /tmp/ai-job-search-smoke \
  --skip-compile \
  --yes
```

Run with OpenAI:

```bash
export OPENAI_API_KEY=...
python -m orchestrator.runner apply \
  --job-text-file ./job.md \
  --profile ./CLAUDE.md \
  --backend openai \
  --yes
```

On Windows PowerShell:

```powershell
$env:OPENAI_API_KEY = "..."
python -m orchestrator.runner apply --job-text-file .\job.md --profile .\CLAUDE.md --backend openai --yes
```

## Configuration

Copy `.ai-job-search.config.example.json` to `.ai-job-search.json` or `.ai-job-search.config.json`. Environment variables override JSON values.

Supported environment variables:

- `AI_JOB_SEARCH_BACKEND`
- `OPENAI_API_KEY`
- `OPEN_AI_API_KEY` for compatibility with local `.env` files that use this spelling
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `CODEX_API_KEY`
- `CODEX_MODEL`
- `CODEX_COMPAT_ENDPOINT`

## OpenAI Adapter PoC

The repo includes a tiny OpenAI health check that does not send profile or job posting data. It only verifies that the adapter can authenticate and receive a JSON response:

```bash
python -m orchestrator.examples.openai_adapter_poc --env-file ../.env --model gpt-4o
```

The script accepts either `OPENAI_API_KEY` or `OPEN_AI_API_KEY` and never prints the key.

See `docs/OPENAI_POC.md` for a redacted example run.

## Adapter Interface

Adapters inherit from `orchestrator.adapters.base.BaseAdapter` and implement:

- `send_chat(messages, max_tokens, temperature, stop=None) -> {"text": str, "usage": dict}`
- `single_shot(prompt, max_tokens, temperature) -> str`
- `spawn_fresh_context() -> dict`
- `count_tokens(text) -> int`

`openai_chat` sends standard chat messages to `/chat/completions`. `codex_compat` flattens conversation into one prompt using explicit separators:

```text
====SYSTEM====
...
====PROFILE====
...
====JOB====
...
====CV====
...
====COVER====
...
====INSTRUCTION====
...
```

Prefer chat models for reviewer quality. The codex-compatible mode is designed for endpoints that accept one large instruction and may produce less reliable comparative critique.

## Prompt Templates

Templates live in `orchestrator/prompts/` and use JSON metadata on the first line followed by `## SYSTEM` and `## INSTRUCTION` sections. The current workflow uses:

- `parse_input.tpl.md`
- `drafter_eval.tpl.md`
- `drafter_draft.tpl.md`
- `reviewer.tpl.md`
- `verification.tpl.md`

Prompt engineering defaults are conservative: temperature `0.0` to `0.2` for factual and structured phases, with slightly more room for reviewer narrative suggestions.

## Safety And Privacy

Remote backends upload candidate profile snippets and job text to the selected provider. The runner prints this warning before any remote call:

```text
This operation will upload parts of your CV and job posting to <backend>. By continuing you consent. To avoid uploading PII, run in local mode or redact personally identifiable fields.
```

Use `--local-only` to refuse remote calls. Use `--skip-compile` in CI or environments without a LaTeX toolchain. The runner logs minimal metadata and does not write full prompts unless an explicit future debugging flow opts into it.

## Testing

Run:

```bash
python -m pytest orchestrator/tests
```

The default CI workflow runs tests without secrets or network scraping. Maintainers can add a protected workflow later for real-backend integration checks.

## Adding An Adapter

1. Create `orchestrator/adapters/<name>_adapter.py`.
2. Inherit from `BaseAdapter`.
3. Implement `send_chat` and `single_shot`.
4. Add the backend name to `orchestrator/adapters/__init__.py`.
5. Add tests with mocked responses.
6. Document required environment variables here.
