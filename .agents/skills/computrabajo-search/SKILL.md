---
name: computrabajo-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search job listings on Computrabajo
  Colombia (computrabajo.com.co — canonical host co.computrabajo.com), the
  largest job board in Latin America, or look up a specific Computrabajo
  posting. Invoke for vacancies, open positions, and hiring in Colombia: Bogotá,
  Medellín, Cali, Barranquilla, remote, and any city or sector (software,
  engineering, finance, healthcare, operations). Trigger phrases: computrabajo,
  trabajo en colombia, empleos colombia, ofertas de trabajo colombia, buscar
  trabajo, vacantes colombia, find a job in colombia, "are there any X jobs in
  colombia", look up this computrabajo posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/computrabajo-search/cli/src/cli.ts *)
---

# Computrabajo Search Skill

Search live job listings from **Computrabajo Colombia** (`co.computrabajo.com`, the
canonical host — `www.computrabajo.com.co` 301-redirects there). No authentication,
no API key, and **zero runtime dependencies** — it runs with just `bun`.

> Colombia-market example of the repo's job-portal-skill pattern. Computrabajo runs
> in many countries (co., com.mx, com.ar, ...) under the same markup; this skill is
> pinned to the Colombian deployment the fork targets.

## ⚠️ Personal use only

This uses Computrabajo's public pages; automated access is against the portal's terms,
so **keep volume low and don't use it commercially or for bulk data collection.** Run it
on your own responsibility. The CLI stays inside `robots.txt`: it fetches only the
page-1 document (search and detail); `/Ajax/*` — the portal's real paginator — is
disallowed, so there is no pagination beyond page 1.

## When to use this skill

- Search for job openings in Colombia (any city, remote, any sector)
- Get the full description, requirements, salary tag, and apply link of a specific offer

## Commands

### Search job listings

```bash
bun run .agents/skills/computrabajo-search/cli/src/cli.ts search --query "<text>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — **required.** Keywords, e.g. `"desarrollador backend"`, `"analista de datos"`, `"frontend react"`.
- `--page <n>` — page number. **Only `1` is supported**; `2+` exits with `UNSUPPORTED_PAGINATION` (Computrabajo's real paginator is Ajax-based and disallowed by its robots.txt).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

There is **no recency filter flag** — Computrabajo cards carry relative dates ("Hace 12
horas", "Ayer", "Hoy") that the CLI converts to `YYYY-MM-DD` in the `date` field; filter
client-side on `date` when a window is needed.

### Fetch full offer detail

```bash
bun run .agents/skills/computrabajo-search/cli/src/cli.ts detail <url> [--format json|plain]
```

`<url>` is the posting URL from `search` results (its address includes the job slug, so a
bare id cannot address the page). Returns the full description, requirements list, salary
tag, relative date, and the apply (match) link. Computrabajo publishes **no application
deadlines** — `deadline` is always `null`.

## Usage examples

```bash
# Backend roles anywhere in Colombia
bun run .agents/skills/computrabajo-search/cli/src/cli.ts search -q "desarrollador backend" --format table

# Data analyst roles, capped
bun run .agents/skills/computrabajo-search/cli/src/cli.ts search -q "analista de datos" -n 5

# Full details for a specific offer
bun run .agents/skills/computrabajo-search/cli/src/cli.ts detail "https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-backend-E92595FF9C5126D461373E686DCF3405" --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing URLs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single offer's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data comes from Computrabajo's public HTML pages — no credentials required.
- Job ids are 32-hex strings (e.g. `E92595FF9C5126D461373E686DCF3405`) used in the posting URL.
- Search returns offers on page 1 only (see the robots note above); `meta.count` reflects that page.
- Computrabajo may rate-limit; the CLI retries 429/5xx with exponential backoff. Keep volume low (see ToS note above).