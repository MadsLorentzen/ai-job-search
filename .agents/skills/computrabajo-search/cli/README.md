# computrabajo-cli

CLI for searching jobs on Computrabajo Colombia (co.computrabajo.com).

**Data source**: Public HTML pages.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** This uses Computrabajo's public pages; automated access may be against their Terms of Service. Keep volume low, don't use it commercially or for bulk data collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/computrabajo-search/cli
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
# Software engineer jobs in Bogota
bun run src/cli.ts search -q "ingeniero software" --location "Bogotá" --format table

# Data analyst, last 7 days
bun run src/cli.ts search -q "analista datos" --jobage 7 --format table

# Full detail for one job (pass the URL from search results)
bun run src/cli.ts detail https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-ingeniero-de-desarrollo-de-software-junior-en-bogota-dc-F74E146623AC0A6E61373E686DCF3405 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | **Required.** Keywords (job title, skill, role). |
| `--location` | `-l` | City or department (e.g. `"Bogotá"`, `"Medellín"`). |
| `--jobage` | | Posted within N days: `1`, `7`, `14`, `30`. |
| `--page` | | 1-indexed page (20 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |
