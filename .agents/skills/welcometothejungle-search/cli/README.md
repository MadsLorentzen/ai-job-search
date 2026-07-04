# wttj-cli

CLI for searching jobs on Welcome to the Jungle, for **any country/city** (and remote),
across any sector.

**Data source**: WTTJ public Algolia index (`wk_cms_jobs_production`) for search, and the
public read-only jobs API (`api.welcometothejungle.com/api/v1`) for detail.
**Authentication**: None required (uses the public search-only Algolia key WTTJ ships to browsers).
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** This uses WTTJ's public data; keep volume low, don't use it
> commercially or for bulk data collection, and run it on your own responsibility.

> **Coverage note.** WTTJ is heavily France/Europe-weighted; US and fully-remote listings are
> comparatively few. Pair it with `linkedin-search` for a broad US/remote search.

## Installation

```bash
cd .agents/skills/welcometothejungle-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings (all filters optional) |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# DevOps roles in the US
bun run src/cli.ts search -q "devops engineer" -c US --format table

# Data roles in Paris, hybrid
bun run src/cli.ts search -q "data engineer" -l "Paris" --remote hybrid --format table

# Fully remote, permanent
bun run src/cli.ts search -q "platform engineer" --remote full --contract full_time --format table

# Full detail for one job (reference from search results)
bun run src/cli.ts detail JOKO_K6yZbxR --format plain
```

See `../SKILL.md` for the full flag reference and the Terms-of-Service note, and
`../url-reference.md` for the underlying endpoints.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). Recommended. |
| `--location` | `-l` | Office city, exact WTTJ facet, e.g. `"Paris"`, `"London"`. |
| `--country` | `-c` | Office country ISO code, e.g. `US`, `FR`, `GB`. |
| `--remote` | | `full` \| `hybrid` \| `occasional` \| `none`. |
| `--contract` | | `full_time` \| `part_time` \| `internship` \| `apprenticeship` \| `freelance` \| `temporary` \| `vie` \| `other`. |
| `--since` | | Only jobs published within N days (client-side). |
| `--page` | | 1-indexed page (20 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |
