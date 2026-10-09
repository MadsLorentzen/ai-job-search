---
name: liepin-search
version: 1.0.0
description: >
  Search public/read-only Liepin (猎聘) job listings in China using the
  official liepin-cli. Use for Chinese job discovery, 猎聘职位搜索, or
  machine-readable Liepin search results. This adapter never applies to jobs,
  edits resumes, sends messages, or bypasses CAPTCHA.
context: fork
enabled: false
allowed-tools: Bash(bun run .agents/skills/liepin-search/cli/src/cli.ts *)
---

# Liepin Search

This skill is a thin, read-only adapter around the official
`liepin-tech-2026/liepin-cil` CLI. The upstream CLI requires a user token and
also exposes mutating commands; this adapter deliberately allowlists only
`job search` and never forwards a token or arbitrary arguments from the job
search request. It remains disabled until a local authenticated smoke test has
confirmed the upstream response fields; `/scrape health liepin-search` may be
used explicitly while it is disabled.

## Setup

Install the upstream CLI from its official repository and configure it through
the documented interactive setup. The adapter expects the executable
`liepin-cli` on `PATH`. The upstream token is resolved by that CLI from its
local configuration or `LIEPIN_USER_TOKEN`; never put a token in this
repository, a command argument, a fixture, or a log.

```text
https://github.com/liepin-tech-2026/liepin-cil
https://www.liepin.com/mcp/auth
```

The authorization page states a 90-day token lifetime and a shared limit of 60
requests per minute. Keep calls low-frequency and read-only.

## Commands

```bash
bun run .agents/skills/liepin-search/cli/src/cli.ts search --query "Python开发" --city 北京 --limit 10 --format json
bun run .agents/skills/liepin-search/cli/src/cli.ts detail <id-or-url>
```

`search` maps to `liepin-cli job search` and supports `--query`, `--city`,
`--page`, `--limit`, and `--format json|table|plain`. The upstream page index
is zero-based, so this adapter translates its one-based `--page` to the
upstream value. `detail` is intentionally unavailable because the official
CLI currently documents no read-only job-detail command; it returns
`DETAIL_UNAVAILABLE` without making a request. `/rank` must use the stored URL
with its documented WebFetch fallback for detail text.

## Safety boundary

- Do not call `job apply`, any `resume` command, `setup`, or `auth` from this
  adapter.
- Do not bypass login, CAPTCHA, rate limits, or access controls.
- A missing token is reported as `AUTH_REQUIRED`, while an expired/unauthorized
  token is `AUTH_EXPIRED`; neither is retried through interactive login.
- Upstream output is treated as untrusted JSON and normalized before it enters
  `seen_jobs.json`.

## Examples

```bash
bun run .agents/skills/liepin-search/cli/src/cli.ts search -q "后端工程师" -c 上海 --limit 5 --format table
bun run .agents/skills/liepin-search/cli/src/cli.ts search -q "数据分析" --city 杭州 --page 2 --format json
bun run .agents/skills/liepin-search/cli/src/cli.ts search -q "Java" --limit 3 --format plain
```

See [url-reference.md](url-reference.md) for the upstream repository, API
path, parameter mapping, output assumptions, and known limitations.
