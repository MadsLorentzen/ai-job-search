# arbetsformedlingen-cli

CLI for searching Swedish job listings via Sweden's official **JobSearch API**
(jobtechdev.se), the open-data platform that backs the Platsbanken board at
arbetsformedlingen.se.

**Data source**: `jobsearch.api.jobtechdev.se` — a public, unauthenticated, no-API-key JSON API.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> This is a public open-data API intended for reuse. No login, no rate-limit headers
> observed in testing, but keep volume reasonable and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/arbetsformedlingen-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Research engineer roles, last 14 days
bun run src/cli.ts search -q "forskningsingenjör" --jobage 14 --format table

# Location is a free-text concept the API extracts itself — include the city in --query
bun run src/cli.ts search -q "robotikingenjör Göteborg" --sort date --format table

# Full detail for one job
bun run src/cli.ts detail 31322464 --format plain
```

See `../SKILL.md` for the full flag reference and notes on portal quirks.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Free-text keywords (title, skill, role). Include a city to narrow by location, e.g. `-q "ingenjör Jönköping"` — see Notes in `SKILL.md`. |
| `--jobage` | | Posted within N days (maps to `published-after`). |
| `--sort` | | `relevance` (default) \| `date` (newest first). |
| `--page` | | 1-indexed page. |
| `--limit` | `-n` | Results per page / cap. Default 20, API max 100. |
| `--format` | | `json` \| `table` \| `plain`. |
