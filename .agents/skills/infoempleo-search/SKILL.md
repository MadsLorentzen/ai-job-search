---
name: infoempleo-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Spain on Infoempleo.com,
  one of Spain's largest general job boards: ofertas de empleo, vacantes, ofertas de
  trabajo en España, por provincia o ciudad (Toledo, Madrid, Barcelona...). Strong coverage
  of industry, engineering and production roles (ingeniería y producción, mantenimiento,
  calidad). Look up a specific Infoempleo posting by ID or URL. Trigger phrases: buscar
  empleo, ofertas de trabajo, ofertas de empleo, vacantes, busco trabajo de, infoempleo,
  find a job in Spain, Spanish job search, look up this Infoempleo posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/infoempleo-search/cli/src/cli.ts *)
---

# Infoempleo Search Skill

Search live job listings from Infoempleo.com, a Spanish general job board. No
authentication, no API key, and **zero runtime dependencies** — it runs with just `bun`.

## ⚠️ Personal use only

This reads Infoempleo's public pages. **Keep volume low and don't use it commercially or for
bulk data collection.** Run it on your own responsibility.

## When to use this skill

- Search for job openings in Spain by keyword and province or city
- Filter by recency (last 1 / 7 / 15 days)
- Get the full description, salary range and application deadline of one posting

## Commands

### Search job listings

```bash
bun run .agents/skills/infoempleo-search/cli/src/cli.ts search [--query "<text>"] [--location "<place>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords (job title, skill). At least one of `--query` / `--location` is required.
- `--location <text>` / `-l <text>` — province or city, e.g. `Toledo`, `Madrid`, `Illescas`. Plain Spanish names, no country suffix.
- `--jobage <days>` — posted within N days. The site only offers **1, 7 and 15**; other values are rounded up to the next bucket, and anything over 15 applies no filter (so also filter client-side on the `date` field).
- `--page <n>` — page number (1-indexed, 20 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

There is no `--remote` flag: the CLI rejects it rather than silently ignoring it.

Results are sorted newest first. The JSON output carries, besides the standard fields,
`summary` (experience | contract | salary line from the card) and `snippet` (the card's
requirements excerpt), enough for a quick fit assessment before a `detail` call.

### Fetch full job detail

```bash
bun run .agents/skills/infoempleo-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric ID from `search` results (e.g. `3204839`), or a full
`infoempleo.com/ofertasdetrabajo/<slug>/<city>/<id>/` URL. Returns the description,
`deadline` (the posting's `validThrough`), salary range when published, experience,
hours and industry.

## Usage examples

```bash
# Industrial engineering roles around Toledo, last 15 days
bun run .agents/skills/infoempleo-search/cli/src/cli.ts search -q "ingeniero industrial" -l Toledo --jobage 15 --format table

# Production management in Madrid
bun run .agents/skills/infoempleo-search/cli/src/cli.ts search -q "jefe de producción" -l Madrid --format table

# Draughtsman roles anywhere in Spain, last week
bun run .agents/skills/infoempleo-search/cli/src/cli.ts search -q "delineante" --jobage 7 --format table

# Everything posted in a town
bun run .agents/skills/infoempleo-search/cli/src/cli.ts search -l Illescas --limit 20 --format table

# Full details for one posting
bun run .agents/skills/infoempleo-search/cli/src/cli.ts detail 3204839 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading results or a single job's full detail |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- The site's keyword matching is **loose**: a query for "técnico de mantenimiento" also returns
  warehouse and machine-operator roles. Pre-filter by title before spending `detail` calls.
- The card date is derived from "Hace 18 horas / Hace 3 días" and is accurate to the day at best.
  `detail` returns the exact `datePosted`. Cards older than a month have no usable date (`null`).
- Large staffing agencies (ETT) post one identical offer across dozens of cities; those cards show
  a location like "A Coruña y 32 más". Treat them as a distribution pattern (see `/scrape` Step 2.5).
- A `403` is reported as `BLOCKED` and never retried; back off rather than hammering the site.
- A `404` on `detail` means the offer expired or was removed.
- Parsing anchors and endpoints are documented in `url-reference.md`.
