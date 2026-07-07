# Contributing Orchestrator Changes

The orchestrator is opt-in. Changes should preserve the existing Claude Code workflow and treat `.claude/commands/apply.md` plus `.claude/skills/job-application-assistant/*.md` as the canonical spec.

## PR Checklist

- Tests are included or updated.
- Documentation is updated for new commands, adapters, config fields, or prompt behavior.
- No secrets, CVs, private profiles, or real job application artifacts are committed.
- CI runs without API keys and without network scraping.
- Backend selection remains opt-in.
- Existing `.claude` files are unchanged unless the PR is explicitly about the canonical workflow.
- Privacy implications are described in the PR.

## Adapter Checklist

- The adapter inherits from `BaseAdapter`.
- `send_chat` returns `{"text": str, "usage": dict}`.
- `single_shot` returns plain assistant text.
- API keys come from environment variables or config, never committed files.
- 429 and 5xx failures are retried when the remote API supports it.
- Tests use mocked responses and deterministic fixtures.

## PR Description Template

````markdown
## Purpose

What this changes and why.

## Files Changed

- ...

## How To Test Locally

```bash
python -m pytest orchestrator/tests
python -m orchestrator.runner apply --job-text-file orchestrator/tests/fixtures/example_job.md --profile orchestrator/tests/fixtures/example_profile.md --backend mock --output-dir /tmp/ai-job-search-smoke --skip-compile --yes
```

## Privacy Implications

Describe whether candidate data is sent to a remote model, which backend is affected, and how users can avoid upload.
````
