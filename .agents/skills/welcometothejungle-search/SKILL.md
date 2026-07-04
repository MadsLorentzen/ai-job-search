---
name: welcometothejungle-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs on Welcome to the
  Jungle (WTTJ) in any location or market, find WTTJ job listings, or look up a
  specific WTTJ job posting — in any country, city, or remotely. Invoke for open
  positions, vacancies, and hiring across any sector or role (software, data,
  design, marketing, finance, legal, operations, etc.). Filters are supplied
  explicitly by the user. Trigger phrases: welcome to the jungle, wttj, find a
  job on welcome to the jungle, search wttj, look up this welcome to the jungle
  posting.
context: fork
allowed-tools: Bash(bun run skills/welcometothejungle-search/cli/src/cli.ts *)
---

# Welcome to the Jungle Search Skill

Search live job listings from Welcome to the Jungle for **any country/city** (and remote).
No authentication, no API key of your own, and **zero runtime dependencies** — it runs with
just `bun`. Filters are passed explicitly, so the same skill works in any market.

> This is a country-agnostic sibling of `linkedin-search`. WTTJ's search is powered by a
> public Algolia index and its job detail comes from a public read-only API; both are global,
> so only the `--country`/`--location`/`--remote` filters you pass change per market.

> **Heads-up on coverage:** WTTJ is heavily France/Europe-weighted (~93% of listings are in
> France). US and fully-remote listings exist but are comparatively few. For a broad US or
> remote search, pair this with `linkedin-search`.

## ⚠️ Personal use only

This uses Welcome to the Jungle's public data (the same Algolia credentials its website ships
to every browser, plus its public jobs API). **Keep volume low and don't use it commercially
or for bulk data collection.** Run it on your own responsibility.

## When to use this skill

- Search WTTJ job openings, optionally filtered by city, country, remote policy, or contract type
- Filter by recency (posted within N days)
- Get the full description of a specific WTTJ listing

## Commands

### Search job listings

```bash
bun run skills/welcometothejungle-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Recommended.
- `--location <city>` / `-l <city>` — office city, an **exact** WTTJ facet value, e.g. `"Paris"`, `"London"`, `"Los Angeles"`.
- `--country <ISO>` / `-c <ISO>` — office country code, e.g. `US`, `FR`, `GB`, `DE`.
- `--remote <mode>` — `full` (fully remote) · `hybrid` · `occasional` · `none`.
- `--contract <type>` — `full_time` · `part_time` · `internship` · `apprenticeship` · `freelance` · `temporary` · `vie` · `other`.
- `--since <days>` — only jobs published within N days (client-side filter).
- `--page <n>` — page number (1-indexed, 20 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run skills/welcometothejungle-search/cli/src/cli.ts detail <reference|org/slug|url> [--format json|plain]
```

`reference` is the `reference` field from `search` results (e.g. `JOKO_K6yZbxR`). You may also
pass an `org/slug` pair or a full WTTJ `.../companies/{org}/jobs/{slug}` URL. Returns the full
description, candidate profile/requirements, salary, remote policy, contract type, skills, and
apply link.

## Usage examples

```bash
# DevOps roles in the US
bun run skills/welcometothejungle-search/cli/src/cli.ts search -q "devops engineer" -c US --format table

# Data engineer roles in Paris, hybrid
bun run skills/welcometothejungle-search/cli/src/cli.ts search -q "data engineer" -l "Paris" --remote hybrid --format table

# Platform roles, fully remote, permanent
bun run skills/welcometothejungle-search/cli/src/cli.ts search -q "platform engineer" --remote full --contract full_time --format table

# Full details for a specific job
bun run skills/welcometothejungle-search/cli/src/cli.ts detail JOKO_K6yZbxR --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing references to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from WTTJ's public Algolia index (`wk_cms_jobs_production`) and its public jobs API — no credentials of your own required.
- Page size is fixed at 20 results per page.
- Location filters are **exact** Algolia facet values: cities are proper-cased names (`Paris`, `London`), countries are ISO codes (`US`, `FR`).
- The CLI retries 429/5xx with exponential backoff. Keep volume low (see ToS note above).
- Pass the `reference` from search results straight to `detail`.
