---
name: indeed-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Spain on Indeed (es.indeed.com),
  the highest-volume general job board in the country: ofertas de empleo, trabajo de, vacantes,
  empleo en Toledo / Madrid / Barcelona, por ciudad o provincia, across every sector (industria,
  mantenimiento, producción, ingeniería, calidad, oficina técnica, instalaciones). Search only:
  Indeed does not allow automated access to posting pages. Trigger phrases: buscar empleo,
  ofertas de trabajo, busco trabajo de, ofertas en Indeed, find a job in Spain on Indeed.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/indeed-search/cli/src/cli.ts *)
---

# Indeed Spain Search Skill

Search live job listings from Indeed Spain (`es.indeed.com`). No authentication, no API key, and
**zero runtime dependencies** — it runs with just `bun`.

## ⚠️ Personal use only

This reads Indeed's public search pages; automated access is against Indeed's Terms of Service, so
**keep volume low and don't use it commercially or for bulk data collection.** Run it on your own
responsibility.

## Read this first: search only, and easily rate-limited

- **There is no usable `detail`.** Indeed's `robots.txt` disallows `/viewjob` (and the page answers
  `401 Authenticating...` to a plain client), so this skill never fetches a posting page. The
  `detail` command exists only to say so: it exits 1 with `DETAIL_UNAVAILABLE`. What you get per
  result is the search card: title, company, place, date, `snippet` (a few requirement lines),
  `salary` when published. For a full evaluation the user opens the `url` in a browser and pastes the
  text into `/apply`.
- **It uses `curl` as a fallback transport.** Indeed's bot protection answers Bun's own HTTP client
  with `403` (checked 2026-10-18: `curl` got `200` for the identical URL and User-Agent). On a `403` the
  CLI therefore repeats the request **once** through the system `curl`, with the same headers and the
  same honest `indeed-search-cli` User-Agent; nothing is disguised as a browser. `curl` ships with
  Windows 10/11, macOS and most Linux distributions. Without it, every search ends in `BLOCKED`.
- **Space requests out.** If `curl` is refused too (a burst of searches does that), the result is
  `BLOCKED`, not retried again. Treat it as "wait a few minutes, then run fewer queries", never as a
  parser fault.
- **Ten pages at most.** `robots.txt` allows `start=` only up to 90, so `--page` is limited to 1–10.
- **No radius filter.** `radius=` is also disallowed, so the CLI has no such flag. Name the city in
  `--location` and rely on Indeed's own default area around it.

## Commands

### Search job listings

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts search [--query "<text>"] [--location "<place>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords (job title, skill). At least one of `--query` / `--location` is required.
- `--location <text>` / `-l <text>` — city or province in plain Spanish: `Toledo`, `Madrid`, `Illescas`.
- `--jobage <days>` — posted within N days. Indeed offers **1, 3, 7 and 14**; other values round up to the next bucket, and anything over 14 applies no filter (so also filter client-side on `date`).
- `--page <n>` — page number, 1–10 (10 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

Results are sorted newest first. Each result carries the standard fields plus `salary`, `snippet`,
`sponsored` (a paid placement, flagged `(ad)` in `table`) and `remote`. The JSON `meta.total` is
Indeed's own count for the query.

### `detail` (unavailable by design)

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts detail <jobkey|url>
```

Validates the 16-character job key and exits 1 with `DETAIL_UNAVAILABLE` and the reason above.

## Usage examples

```bash
# Industrial engineering around Toledo, last two weeks
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "ingeniero industrial" -l Toledo --jobage 14 --format table

# Production management in Madrid
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "jefe de producción" -l Madrid --format table

# Maintenance technicians, last week, JSON for scripting
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "técnico de mantenimiento" -l Illescas --jobage 7

# Second page of results
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "delineante" -l Toledo --page 2 --format table
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use |
| `table` | Quick human-readable scanning |
| `plain` | Reading results with their snippet and salary |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Error codes worth knowing: `BLOCKED` (403 from both Bun and curl, back off), `PARSE_FAILED` (the page had neither job cards
  nor Indeed's "no results" block, so a layout change or bot challenge is reported instead of a false
  "zero jobs"), `DETAIL_UNAVAILABLE`.
- `date` is Indeed's publication timestamp reduced to a UTC calendar day, so it can be a day off
  from Spanish local time. Reposted listings carry the repost date.
- Sponsored placements are included and marked `sponsored: true`; skip them when counting organic results.
- The location text on a card is Indeed's, often a postcode plus town (`45007 Toledo, Toledo provincia`).
- The data is read from the JSON Indeed embeds in the page, not from the rendered markup; see `url-reference.md`.
