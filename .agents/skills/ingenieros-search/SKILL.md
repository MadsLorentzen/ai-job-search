---
name: ingenieros-search
version: 1.0.0
description: >
  Use this skill whenever the user wants engineering job offers in Spain from the
  Ingenieros.es bolsa de trabajo: ofertas de empleo para ingenieros, ingeniero industrial,
  ingeniero técnico, proyectos industriales, oficina técnica, mantenimiento, calidad,
  producción, PRL. A small niche board, so use it alongside the general Spanish boards.
  Look up a specific Ingenieros.es offer by ID or URL. Trigger phrases: bolsa de trabajo
  ingenieros, empleo para ingenieros, ofertas de ingeniería, ingenieros.es, engineering
  jobs Spain, look up this Ingenieros.es posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/ingenieros-search/cli/src/cli.ts *)
---

# Ingenieros.es Search Skill

Reads the public offers of the Ingenieros.es engineering job board (Spain). No authentication,
no API key, and **zero runtime dependencies** — it runs with just `bun`.

## ⚠️ Personal use only

This reads the board's public pages. **Keep volume low and don't use it commercially or for
bulk data collection.** Run it on your own responsibility.

## Read this first: it is a small board

The board lists only its **latest offers on one page, usually fewer than ten** (the highest
offer ID is in the low thousands in total). `search` therefore downloads that single listing and
filters it on your machine; there is no server-side search (the site's own search is a
CSRF-protected form that returns nothing useful to a plain client). Expect few results per run, and
read an empty result as "nothing new on a small board", not as a fault. It complements
`infoempleo-search` and `linkedin-search`; it does not replace them.

## Commands

### Search the latest offers

```bash
bun run .agents/skills/ingenieros-search/cli/src/cli.ts search [--query "<text>"] [--location "<place>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — every word must appear (accent- and case-insensitive substring) in the title, company or place.
- `--location <text>` / `-l <text>` — text that must appear in the offer's **place** (`Lugar`), e.g. `Valencia`. The listing shows only the place, not the province; `detail` returns both.
- `--jobage <days>` — keep offers dated within the last N days (client-side). Offers with no date are kept.
- `--page <n>` — only `1` exists; anything else exits 1 with `BAD_ARG` so a paging loop stops loudly.
- `--limit <n>` / `-n <n>` — cap results emitted.
- `--format json|table|plain` — default `json`.

With no `--query` / `--location` it returns every offer on the front page. The JSON `meta` carries
`listed`, the number of offers the board showed before filtering, so a filtered-to-zero run can be told
apart from an empty board.

### Fetch full offer detail

```bash
bun run .agents/skills/ingenieros-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the number from `search` (e.g. `3509`) or a full `ingenieros.es/bolsa_de_trabajo/detalles_oferta/<id>` URL.
Returns description, minimum and desired requirements, contract, hours, salary, level, sector, minimum
studies and experience. The board states **no application deadline**, so `deadline` is always `null`.

## Usage examples

```bash
# Everything currently on the board
bun run .agents/skills/ingenieros-search/cli/src/cli.ts search --format table

# Industrial-project roles
bun run .agents/skills/ingenieros-search/cli/src/cli.ts search -q "proyectos industriales" --format table

# Anything in Valencia from the last month
bun run .agents/skills/ingenieros-search/cli/src/cli.ts search -l Valencia --jobage 30 --format table

# Full details for one offer
bun run .agents/skills/ingenieros-search/cli/src/cli.ts detail 3509 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading results or a single offer's full detail |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Some offers are posted by staffing firms with generic titles (e.g. "CSS ZARAGOZA"), or are abroad
  (a Spanish recruiter placing a role in France). Check the `location` before investing time.
- A front page with no offer section at all exits 1 with `PARSE_FAILED`, never an empty success.
- A `403` is `BLOCKED` and is not retried; a `404` on `detail` means the offer was removed.
- Parsing anchors are documented in `url-reference.md`.
