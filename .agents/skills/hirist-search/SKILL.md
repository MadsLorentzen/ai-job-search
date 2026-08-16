---
name: hirist-search
version: 1.0.0
description: >
  Search live job listings on Hirist (hirist.tech / hirist.com), a curated
  India tech job board strong on data, analytics, BI, product, and software
  engineering roles. Use when the user wants Indian tech jobs, or to look up a
  specific Hirist posting. Locations are Indian cities (Bangalore, Pune, Mumbai,
  Delhi NCR, Hyderabad, …) or Remote. Trigger phrases: hirist jobs, India tech
  jobs, data analyst jobs in <city>, business intelligence jobs, "find me
  <role> jobs in <Indian city>", look up this hirist posting.
context: fork
allowed-tools: Bash(bun run skills/hirist-search/cli/src/cli.ts *)
---

# Hirist Search Skill

Search live job listings from **Hirist** (hirist.tech, formerly hirist.com), a
curated Indian tech job board. It leans heavily toward data/analytics/BI,
product, and software-engineering roles — a good fit for a Bangalore-based BI or
data analyst. Runs against Hirist's public JSON API with **no authentication, no
API key, and zero runtime dependencies** — just `bun`.

## ⚠️ Personal use only

This uses Hirist's public job API (the same endpoints its website calls). Automated
access at scale is not what it's intended for, so **keep volume low and don't use
it commercially or for bulk data collection.** Run it on your own responsibility.

## When to use this skill

- Search Indian tech job openings by keyword and (optionally) city
- Filter by recency (posted within N days)
- Get the full description, required skills, and experience band of a specific listing

## Commands

### Search job listings

```bash
bun run skills/hirist-search/cli/src/cli.ts search --query "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — **required.** Keywords: job title, skill, or role (e.g. `"data analyst"`, `"power bi"`, `"business intelligence"`).
- `--location <city>` / `-l <city>` — Indian city to filter by: `"Bangalore"`, `"Pune"`, `"Mumbai"`, `"Delhi NCR"`, `"Hyderabad"`, `"Chennai"`, `"Remote"`, etc. Common aliases work (`Bengaluru`, `Gurugram`, `Bombay`).
- `--jobage <days>` — posted within N days (e.g. `3`, `7`, `15`, `30`). Omit for all postings.
- `--page <n>` — page number (1-indexed, 50 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run skills/hirist-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job id from `search` results (e.g. `1654660`). You may also pass a
full Hirist `hirist.tech/j/...` URL. Returns the full description, required
skills, experience band, work-from-home flag, and posting date.

## Usage examples

```bash
# Data analyst roles in Bangalore
bun run skills/hirist-search/cli/src/cli.ts search -q "data analyst" -l "Bangalore" --format table

# Business intelligence roles in Pune, posted in the last 30 days
bun run skills/hirist-search/cli/src/cli.ts search -q "business intelligence" -l "Pune" --jobage 30 --format table

# Power BI roles in Mumbai, top 10
bun run skills/hirist-search/cli/src/cli.ts search -q "power bi" -l "Mumbai" --limit 10 --format table

# Data engineer roles anywhere in India (no location filter)
bun run skills/hirist-search/cli/src/cli.ts search -q "data engineer" --jobage 15 --format table

# Remote analytics roles
bun run skills/hirist-search/cli/src/cli.ts search -q "analytics" -l "Remote" --format table

# Full details for a specific job
bun run skills/hirist-search/cli/src/cli.ts detail 1654660 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON search output is `{ "meta": { "count", "page" }, "results": [...] }`, and
each result carries `id`, `title`, `company`, `location`, `date`, `url`, and
`experience` (nulls are never omitted). All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from Hirist's public JSON API (`gladiator.hirist.tech/job`) — no credentials required. `hirist.com` 301-redirects to `hirist.tech`.
- `--query` is **required** — Hirist search is keyword-driven.
- `--location` maps a city name to Hirist's internal location id (a built-in table of major Indian cities plus Remote/Singapore/Dubai). An unknown city exits `1` with `BAD_LOCATION`; check the spelling or drop the flag to search all-India.
- Page size is fixed at 50 results per page; `--limit` trims client-side.
- `company` is `null` for confidential postings (Hirist hides the employer).
- `date` is the posting date (ISO `YYYY-MM-DD`), derived from the API's epoch timestamp.
- Hirist may rate-limit; the CLI retries 429/5xx with exponential backoff. Keep volume low (see personal-use note above).
