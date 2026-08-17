# computrabajo-cli

CLI for searching jobs on **Computrabajo Colombia** (`co.computrabajo.com`, the canonical
host; `www.computrabajo.com.co` 301-redirects there).

**Data source**: Computrabajo's public HTML search (`/trabajo-de-<query>`) and offer detail pages.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** This reads Computrabajo's public pages; automated access is against
> the portal's terms. Keep volume low and run it on your own responsibility. The CLI stays
> within the portal's `robots.txt`: only the page-1 document fetch is used — `/Ajax/*` (its
> real paginator) is disallowed, so `--page 2+` is rejected.

## Installation

```bash
cd .agents/skills/computrabajo-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings (`--query` required) |
| `detail` | Fetch full detail for a single offer (pass the full URL from search results) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Backend roles anywhere in Colombia
bun run src/cli.ts search -q "desarrollador backend" --format table

# Data analyst roles, cap results
bun run src/cli.ts search -q "analista de datos" -n 5

# Full detail for one offer (URL from the search output)
bun run src/cli.ts detail "https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-backend-E92595FF9C5126D461373E686DCF3405" --format plain
```

See `../SKILL.md` for the full flag reference and portal notes.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | **Required.** Keywords (title / skill / role), e.g. `"desarrollador backend"`, `"analista de datos"`, `"frontend react"`. |
| `--page` | | Page number. **Only `1` is supported** — exits with `UNSUPPORTED_PAGINATION` otherwise (Ajax paginator is robots-disallowed). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- Computrabajo publishes dates as relative text ("Hace 12 horas", "Ayer", "Hoy"); the CLI
  converts them to `YYYY-MM-DD` at search time. Sub-day units resolve to the current day.
- The portal publishes no application deadlines on offer pages — `deadline` is always `null`.
- There is no recency filter flag: filter client-side on the `date` field if needed.