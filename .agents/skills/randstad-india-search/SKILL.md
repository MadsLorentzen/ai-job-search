---
name: randstad-india-search
version: 1.0.0
description: >
  Use this skill to search for jobs in India on Randstad India's public job
  board (randstad.in) — job listings, open positions, and vacancies across any
  city (Pune, Mumbai, Bengaluru, Delhi NCR, Hyderabad, Chennai, Kolkata, etc.)
  and any sector (IT, engineering, finance, accounting, HR, sales, operations,
  manufacturing). Also fetches the full description of a specific Randstad job
  posting. Trigger phrases: find a job in India, Randstad jobs, job search
  India, naukri, job openings, vacancies, hiring in <Indian city>, "are there
  any X jobs in <city>", look up this Randstad job posting.
context: fork
allowed-tools: Bash(bun run skills/randstad-india-search/cli/src/cli.ts *)
---

# Randstad India Search Skill

Search live job listings from **Randstad India's** public job board
(https://www.randstad.in/jobs/) for any city and sector in India. No
authentication, no API key, and **zero runtime dependencies** — it runs with
just `bun`.

## When to use this skill

- Search for job openings in an Indian city (Pune, Mumbai, Bengaluru, Delhi,
  Hyderabad, Chennai, etc.) by keyword and/or location.
- Filter results by recency (posted within N days).
- Get the full description of a specific Randstad job listing.

## Commands

### Search job listings

```bash
bun run skills/randstad-india-search/cli/src/cli.ts search --query "<text>" --location "<city>" [flags]
```

Provide at least `--query` or `--location`.

Flags:
- `--query <text>` / `-q <text>` — keywords (job title, skill, role). Recommended.
- `--location <text>` / `-l <text>` — Indian city, e.g. `"Pune"`, `"Bengaluru"`, `"Mumbai"`.
- `--jobage <days>` — keep only jobs posted within N days (**client-side** filter on the page-1 results).
- `--page <n>` — 1-indexed page. See Notes: only page 1 is retrieved server-side.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run skills/randstad-india-search/cli/src/cli.ts detail "<job-url>" [--format json|plain]
```

Randstad detail URLs are `/jobs/<slug>_<city>_<uuid>/` and the slug cannot be
reconstructed from a bare UUID, so `detail` takes the **full job URL** emitted in
a search result's `url` field (a `/jobs/...` path or absolute URL is accepted).
Returns the full description, employment type, reference id, and posting date.

## Usage examples

```bash
# Project manager roles in Pune
bun run skills/randstad-india-search/cli/src/cli.ts search -q "project manager" -l "Pune" --format table

# Data engineer roles in Bengaluru, posted in the last 30 days
bun run skills/randstad-india-search/cli/src/cli.ts search -q "data engineer" -l "Bengaluru" --jobage 30 --format table

# Accountant roles in Mumbai, first 10
bun run skills/randstad-india-search/cli/src/cli.ts search -q "accountant" -l "Mumbai" --limit 10 --format table

# All roles in Hyderabad
bun run skills/randstad-india-search/cli/src/cli.ts search -l "Hyderabad" --format table

# Full details for a specific job
bun run skills/randstad-india-search/cli/src/cli.ts detail "https://www.randstad.in/jobs/project-manager-structural_pune_8b8726ea-cf54-4912-9f6d-d11e25f6fbee/" --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, grabbing the `url` to pass to `detail` |
| `table` | Quick human-readable scanning of search results |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON search output is `{ "meta": { "count": N, "page": P }, "results": [...] }`
where each result has `id`, `title`, `company`, `location`, `date`,
`employmentType`, and `url` (missing values are `null`).

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and
the process exits with code `1`.

## Notes

- **Data source:** Randstad India server-renders its job list inside a Next.js
  RSC (React Server Components) stream on the search-results page. The CLI locates
  the embedded `"results":[…]` payload and parses each job independently — no
  official API and no credentials required. See `url-reference.md`.
- **Location:** passed as a `ci-<city-slug>` path segment; the keyword becomes a
  `q-<query>` segment (`/jobs/q-project%20manager/ci-pune/`).
- **`--jobage` is client-side.** Randstad's date filters are `robots.txt`-blocked
  (`/jobs/?d=`), so the CLI fetches unfiltered results and filters by
  `postingTime` locally. Jobs without a parseable date are kept.
- **Pagination is limited.** Only page-1 results (~30 jobs) are retrieved
  server-side; `--page` is accepted for the JSON `meta` but does not fetch
  further pages. Narrow with `--query`/`--location` instead of paging.
- **Company** is often `"A client of Randstad India"` (Randstad is a staffing
  agency and masks the end client), not a specific employer name.
- Randstad may rate-limit; the CLI retries 429/5xx with exponential backoff and
  jitter (max ~6 retries). Keep volume low during iteration.
- `robots.txt` allows the `q-`/`ci-` search paths and `/jobs/<slug>_<uuid>/`
  detail pages used here (only specific filter prefixes and `/job-redirect/` are
  disallowed).
