# stepstone-cli

CLI for searching German job listings on **stepstone.de**, one of Germany's largest
general job boards.

**Data source**: stepstone.de's public search-results and job-detail pages (server-rendered
HTML; no JSON API exposed to unauthenticated clients).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

## Installation

```bash
cd .agents/skills/stepstone-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings (`--query` required) |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Machine Learning roles in Stuttgart
bun run src/cli.ts search -q "Machine Learning Engineer" -l "Stuttgart" --format table

# Data Scientist roles in Berlin, last 14 days
bun run src/cli.ts search -q "Data Scientist" -l "Berlin" --jobage 14 --format table

# Full detail for one job
bun run src/cli.ts detail 14338328 --format plain
```

See `../SKILL.md` for the full flag reference and the robots.txt constraints.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | **Required.** Keywords (title / skill / role). |
| `--location` | `-l` | City/region, e.g. `"Stuttgart"`, `"Berlin"`. Folded into the URL path. |
| `--jobage` | | Keep only postings within N days (client-side filter). |
| `--page` | | Must be `1` — pagination isn't reachable within robots.txt. |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Why no `&page=` or `&age=`

stepstone.de's `robots.txt` allows `GET /jobs/*?q=*` but explicitly disallows any
additional query parameter on that path (`Disallow: /jobs/*?q*&*`). This CLI honors
that: `--jobage` is applied client-side against the relative "vor N Tagen" timestamp
on each result, and `--page` only accepts `1`. See `../url-reference.md` for the
full parameter table and the exact robots.txt excerpt.
