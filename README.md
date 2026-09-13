# AI Job Search — pi workspace

A role-bound [pi](https://github.com/badlogic/pi-mono) agent workspace for job
search and applications, forked from
[MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
and migrated from Claude Code to a pi-native architecture.

## The agent

The agent's identity is `.pi-agent/`, not the chat:

| Path | Purpose |
| --- | --- |
| `.pi-agent/SYSTEM.md` | Policy: hard rules + behavior (replaces the system prompt) |
| `.pi-agent/settings.json` | Model allowlist, theme |
| `.pi-agent/skills/` | Skills, loaded explicitly (portal CLIs, scrape, apply guidance) |
| `.pi-agent/extensions/job-tools.ts` | Native tools: `job_candidates`, `job_rank_apply`, `job_key`, `cv_verify` |
| `profile/profile.md` | Candidate profile (populated via the setup workflow) |
| `profile/workflows/*.md` | Workflow specs (setup, scrape, apply, rank, outcome, …) — read on demand |
| `state/` | `seen_jobs.json` (dedup backlog), `job_search_tracker.csv` |
| `documents/`, `cv/`, `cover_letters/`, `templates/` | Postings, applications, LaTeX sources |
| `packages/tools/` | Bun/TS tooling (rank-state, job-key, verify-pdf/layout, salary, guards) |

State moves through tools, never through the conversation: the extension tools
and `bun run packages/tools/src/cli.ts <subcommand>` are the only sanctioned way
to touch `state/`.

## Launch

```fish
scripts/job.fish            # or: alias job /path/to/scripts/job.fish
```

Equivalent explicit form:

```fish
env PI_CODING_AGENT_DIR=(pwd)/.pi-agent pi --no-skills \
  (for s in .pi-agent/skills/*/; echo --skill $s; end)
```

## Development

```bash
cd packages/tools && bun install && bun test   # 396 tests
```

CI (`.github/workflows/ci.yml`) runs the same bun suite plus security guards.

## Upstream

This fork tracks upstream for portal-skill improvements; `framework-version`
and `upstream-updates` subcommands in packages/tools manage that. Portal
skills borrowed from other forks go in `.pi-agent/skills/` — read their code
first (they run pre-approved on your machine).
