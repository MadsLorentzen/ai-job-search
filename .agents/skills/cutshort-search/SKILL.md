---
name: cutshort-search
version: 1.0.0
description: >
  Search public job postings on CutShort (cutshort.io), an India-focused tech and
  startup hiring platform, when the user wants to find jobs, openings, or vacancies
  in the Indian market — especially engineering, data, product, and design roles in
  Bangalore, Pune, Mumbai, Hyderabad, Delhi/NCR, or remote-India. Trigger phrases:
  find a job on CutShort, search CutShort, CutShort jobs, India tech jobs, startup
  jobs India, "any data analyst jobs in Bangalore", look up this CutShort posting.
context: fork
allowed-tools: Bash(bun run skills/cutshort-search/cli/src/cli.ts *)
---

# CutShort Search Skill

Search public job postings from **CutShort** (cutshort.io), an India tech/startup hiring
platform, with **zero runtime dependencies** — it runs with just `bun`.

## What this searches

CutShort's live job feed is a login-gated, AI **profile-matching** experience (you create a
candidate profile and get "matched" to roles); that matching feed is **not** publicly
scrapable and its query API is disallowed by `robots.txt`. This skill therefore uses
CutShort's two **robots-allowed, unauthenticated** public surfaces:

- **Search** filters the public **jobs sitemap** (`sitemap_jobs.xml`, explicitly listed in
  `robots.txt`) by keyword/location against each posting's slug, then enriches the matches.
- **Detail** reads the public `/job/<id>` page, whose embedded `JobPosting` JSON-LD carries
  title, company, location, salary, skills, dates, and description.

Because search matches against the sitemap **slug** (which embeds the title, city, and
company), keyword matching is text-based rather than CutShort's own skill-matching algorithm.

## ⚠️ Personal use only

This reads CutShort's public sitemap and job pages. **Keep volume low, and do not use it
commercially or for bulk data collection.** Run it on your own responsibility.

## When to use this skill

- Find tech/startup job openings in an Indian city (Bangalore, Pune, Mumbai, …) or remote
- Filter by keyword (title/skill/role) and recency
- Get the full description, salary, and required skills of a specific CutShort posting

## Commands

### Search job listings

```bash
bun run skills/cutshort-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords (title, skill, role), matched against the sitemap slug. Recommended.
- `--location <text>` / `-l <text>` — city filter (e.g. `"Bangalore"`, `"Pune"`, `"Mumbai"`), matched against the slug.
- `--jobage <days>` — keep postings whose sitemap `lastmod` is within N days (approximate recency; see Notes).
- `--page <n>` — 1-indexed page (20 results/page). Default 1.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run skills/cutshort-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the short job id from `search` results (e.g. `arcRXEzK`). You may also pass a full
`cutshort.io/job/...` URL or the full slug. Returns title, company, location, employment
type, salary, required skills, dates, and the full description.

## Usage examples

```bash
# Data analyst roles in Bangalore
bun run skills/cutshort-search/cli/src/cli.ts search -q "data analyst" -l "Bangalore" --format table

# Business intelligence roles in Pune, first 10
bun run skills/cutshort-search/cli/src/cli.ts search -q "business intelligence" -l "Pune" --limit 10 --format table

# Data engineer roles in Mumbai posted in the last 14 days
bun run skills/cutshort-search/cli/src/cli.ts search -q "data engineer" -l "Mumbai" --jobage 14 --format table

# Power BI roles anywhere in India
bun run skills/cutshort-search/cli/src/cli.ts search -q "power bi" --limit 15 --format table

# Remote analytics roles
bun run skills/cutshort-search/cli/src/cli.ts search -q "analytics" -l "Remote" --format table

# Full details for a specific job
bun run skills/cutshort-search/cli/src/cli.ts detail arcRXEzK --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON shape is `{ "meta": { "count", "page" }, "results": [ { id, title, company, location, date, url } ] }`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Matching-model caveat:** CutShort is primarily a *matching* platform, not a keyword job
  board. This skill searches its public sitemap, so results reflect every publicly listed
  posting — not the personalized shortlist CutShort would generate for a logged-in candidate.
- **Location filtering** matches the city name embedded in the slug. Some postings omit the
  city from the slug, so a city filter can miss otherwise-relevant roles; run without
  `-l` and scan if you suspect misses.
- **`--jobage`** filters on the sitemap `lastmod` timestamp (last content refresh), which
  approximates but is not identical to the exact `datePosted` shown on the detail page.
- Search fetches the full jobs sitemap (~8 MB) once per run and enriches only the results on
  the requested page, so keep `--limit`/`--page` modest to stay polite.
- Job ids are short alphanumeric strings (e.g. `arcRXEzK`) — pass them as-is to `detail`.
