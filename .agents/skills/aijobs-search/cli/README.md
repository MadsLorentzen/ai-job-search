# aijobs-cli

CLI for searching **aijobs.net** — a curated global board for **AI, data science,
machine learning, data engineering, and analytics** roles (with salary bands).

**Data source**: aijobs.net public, server-rendered job pages (`/` search, `/job/<slug>/` detail).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** This reads aijobs.net's public job pages. `robots.txt` permits
> crawling (only `/account/` disallowed), but keep volume low, don't use it commercially or
> for bulk data collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/aijobs-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job (by slug id or URL) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Business intelligence roles, quick scan
bun run src/cli.ts search -q "business intelligence" --limit 5 --format table

# Data analyst roles biased toward India
bun run src/cli.ts search -q "data analyst" -l "India" --format table

# Power BI roles, remote only
bun run src/cli.ts search -q "power bi" --remote remote --format table

# Full detail for one job (slug id from search results)
bun run src/cli.ts detail competitive-coder-remote-200475 --format plain
```

See `../SKILL.md` for the full flag reference and the personal-use note, and
`../url-reference.md` for the endpoint/response details.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). Recommended. |
| `--location` | `-l` | Location text; folded into the keyword (aijobs has no location param). |
| `--remote` | | `remote` (client-side filter). `hybrid`/`onsite` unsupported. |
| `--jobage` | | Keep postings from the last N days (client-side). |
| `--page` | | 1-indexed page (~50 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun run typecheck
bun run test
```
