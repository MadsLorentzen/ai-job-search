# elempleo-cli

CLI for searching jobs on Elempleo Colombia (elempleo.com/co).

**Data source**: Public HTML pages.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** This uses Elempleo's public pages; automated access is against their Terms of Service. Keep volume low, don't use it commercially or for bulk data collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/elempleo-search/cli
bun install
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings (`--query` required) |
| `detail` | Fetch full detail for a single job listing |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Software engineer jobs
bun run src/cli.ts search -q "ingeniero software" --format table

# Data analyst in Bogota
bun run src/cli.ts search -q "analista datos" --location "Bogotá" --format table

# Full detail for one job (pass the URL from search results)
bun run src/cli.ts detail https://www.elempleo.com/co/ofertas-trabajo/tecnico-electricista-ami-perdidas-1886736527 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | **Required.** Keywords (job title, skill, role). |
| `--location` | `-l` | City (e.g. `"Bogotá"`, `"Medellín"`, `"Cali"`). |
| `--jobage` | | Posted within N days: `1`, `7`, `14`, `30`. |
| `--page` | | 1-indexed page. |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |
