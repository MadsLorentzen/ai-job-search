# AI Job Search

A role-bound Pi agent workspace for job search and applications. The agent's
identity lives in `.pi-agent/` — policy, skills, and extensions are all
project-local and versioned.

## Layout

| Path | Purpose |
| --- | --- |
| `.pi-agent/` | The agent: `SYSTEM.md` (policy), `settings.json`, `skills/`, `extensions/` |
| `profile/` | Candidate profile + workflow specifications (`workflows/*.md`) — read on demand |
| `state/` | Dedup backlog (`seen_jobs.json`) and application tracker (`job_search_tracker.csv`) |
| `documents/` | Postings, applications, CVs, references (candidate's real files) |
| `cv/`, `cover_letters/`, `templates/` | LaTeX sources and templates |
| `packages/` | Bun/TS workspace: tools and tests (tracker, rank, verification) |

## Launch the agent

```fish
env PI_CODING_AGENT_DIR=(pwd)/.pi-agent pi --no-skills \
  (for s in .pi-agent/skills/*/; echo --skill $s; end)
```

(Or via the `job` fish wrapper — see dotfiles.)

Visiting coding agents: do not edit `.pi-agent/` or `profile/` methodology files;
follow `AGENTS.md` routing instead.

## Development

```bash
bun install
bun test          # workspace tests (tools + portal CLIs)
```
