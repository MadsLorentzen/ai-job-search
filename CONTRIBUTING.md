# Contributing

This repository is a local Python/Ollama job-search application with independent Bun portal CLIs.

## Before submitting changes

Run:

```powershell
py -m unittest discover -s tests -t . -v
python tools/security_guards.py
```

For a touched portal CLI, also run its local `bun run typecheck` and `bun test` commands. Keep job postings untrusted, keep LLM output schema-validated, and do not add credentials or paid API dependencies.

Preserve the master-CV source-of-truth rule: historical facts come from the master CV, while application preferences come from `CLAUDE.md` and approved preference files.
