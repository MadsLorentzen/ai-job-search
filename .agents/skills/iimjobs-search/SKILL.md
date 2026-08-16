---
name: iimjobs-search
version: 1.0.0
description: >
  Use this skill to search job listings on iimjobs.com — India's premier board for
  MBA/PGDM, management, consulting, analytics, business-intelligence and data roles
  aimed at experienced professionals. Invoke for open positions, vacancies and hiring
  across India (Bangalore, Mumbai, Pune, Delhi NCR, Hyderabad, remote, etc.) in
  consulting, strategy, analytics, BI, finance, product and general management. Trigger
  phrases: iimjobs, MBA jobs India, consulting jobs India, BI jobs India, analytics
  jobs India, management jobs, "find <role> jobs in <Indian city>", look up an iimjobs
  posting.
context: fork
allowed-tools: Bash(bun run skills/iimjobs-search/cli/src/cli.ts *)
---

# iimjobs Search Skill

Search live job listings from **iimjobs.com**, India's leading board for MBA/PGDM,
consulting, analytics, BI, finance and senior management roles. It calls iimjobs's
public JSON API (`gladiator.iimjobs.com`) directly — no authentication, no API key,
and **zero runtime dependencies**; it runs with just `bun`.

## ⚠️ Personal use only

This uses iimjobs.com's public endpoints. **Keep volume low** (the site declares a
10-second crawl-delay in robots.txt) and **do not use it commercially or for bulk data
collection.** Run it on your own responsibility.

## When to use this skill

- Search for job openings on iimjobs by keyword (role, skill, company)
- Filter by Indian city / region (or Remote), recency, and experience band
- Get the full description of a specific iimjobs posting

## Commands

### `search`
```
bun run skills/iimjobs-search/cli/src/cli.ts search -q "<keywords>" [flags]
```
Provide at least `--query` or `--location`.

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (job title, skill, or role). Recommended. |
| `--location` | `-l` | City/region name (e.g. `Bangalore`, `Mumbai`, `Pune`, `Remote`) or a numeric loc id. |
| `--jobage <days>` | | Posted within N days (maps to the site's `posting` filter). Default: all. |
| `--minexp <years>` | | Minimum experience in years. |
| `--maxexp <years>` | | Maximum experience in years. |
| `--page <n>` | | 1-indexed page (50 results/page). Default 1. |
| `--limit <n>` | `-n` | Cap the number of results emitted (client-side). |
| `--format <fmt>` | | `json` (default) \| `table` \| `plain`. |

### `detail`
```
bun run skills/iimjobs-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```
Accepts a numeric job id or a full `https://www.iimjobs.com/j/<slug>-<id>` URL.

## Usage examples

```bash
# Business-intelligence roles, table view
bun run skills/iimjobs-search/cli/src/cli.ts search -q "business intelligence" --limit 10 --format table

# Data-analyst roles in Bangalore, posted in the last 7 days
bun run skills/iimjobs-search/cli/src/cli.ts search -q "data analyst" -l "Bangalore" --jobage 7 --format table

# Power BI roles in Pune, 3–8 years experience
bun run skills/iimjobs-search/cli/src/cli.ts search -q "power bi" -l "Pune" --minexp 3 --maxexp 8 --format plain

# Strategy-consulting roles in Mumbai, page 2
bun run skills/iimjobs-search/cli/src/cli.ts search -q "strategy consulting" -l "Mumbai" --page 2 --format table

# Remote analytics roles
bun run skills/iimjobs-search/cli/src/cli.ts search -q "analytics" -l "Remote" --format table

# Full description of a specific posting
bun run skills/iimjobs-search/cli/src/cli.ts detail 1712209 --format plain
```

## Output format

`search` (json) returns `{ meta: { count, page }, results: [...] }`; each result:

| Field | Description |
|-------|-------------|
| `id` | iimjobs job id (string) |
| `title` | Job title |
| `company` | Company name (`"Confidential"` for confidential postings, else `null`) |
| `location` | Comma-joined city/region names, or `null` |
| `date` | Posting date `YYYY-MM-DD`, or `null` |
| `url` | Full `iimjobs.com/j/...` detail URL |
| `minExp` / `maxExp` | Experience band in years, or `null` |
| `tags` | Skill/function tags (array of strings) |
| `applyUrl` | External apply URL, or `null` |

`detail` adds `description` (plain-text JD), `designation`, `industry`, `functionalArea`.

Errors are emitted to **stderr** as `{"error","code"}` with exit code 1.

## Notes / quirks

- **Two location-id spaces exist.** The API's `loc` filter uses ids that differ from the
  list embedded in the site's JS bundle. This skill uses the API's own ids
  (Delhi NCR=1, Mumbai=2, Bangalore=3, Hyderabad=4, Kolkata=5, Chennai=6, Pune=7,
  Remote=132). See `url-reference.md` for the full map.
- **`loc` is multi-city inclusive.** Many postings list several cities; a `-l "Bangalore"`
  result may show `Hyderabad, Bangalore` — Bangalore is one of its locations.
- **Pagination is 50 results/page.** `--page` is 1-indexed here and translated to the API's
  0-indexed `page`.
- **Salary is usually hidden** (`hideSal=1` on most postings), so salary is not surfaced;
  experience band (`minExp`/`maxExp`) is the reliable seniority signal.
- **`detail` needs a Referer header** (handled internally); the description lives in the
  API's `introText` HTML field and is converted to plain text.
