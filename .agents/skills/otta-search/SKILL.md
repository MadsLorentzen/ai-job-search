---
name: otta-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search jobs on Otta / Welcome to the
  Jungle (otta.com now redirects to welcometothejungle.com) — a global,
  remote-friendly, English-language job board strong on tech, product, data,
  design, and startup roles across Europe, the UK, India, and worldwide. Invoke
  for open positions, vacancies, and hiring, or to look up a specific Welcome to
  the Jungle / Otta job posting. Trigger phrases: search Otta, Welcome to the
  Jungle jobs, WTTJ jobs, startup jobs, remote data/tech jobs, "find X jobs on
  Otta", look up this welcometothejungle.com posting.
context: fork
allowed-tools: Bash(bun run skills/otta-search/cli/src/cli.ts *)
---

# Otta / Welcome to the Jungle Search Skill

Search live job listings from **Welcome to the Jungle** (formerly **Otta** — `otta.com`
now 301-redirects to the Welcome to the Jungle platform). It queries the site's public
Algolia job index and its unauthenticated REST API for full detail. No login, no API key
of your own, and **zero runtime dependencies** — it runs with just `bun`.

The board is global and English-first, with heavy coverage of tech, product, data, design,
and startup roles across Europe, the UK, and increasingly India and the US.

## ⚠️ Personal use only

This reads Welcome to the Jungle's public job data through the same Algolia index its own
website uses. Automated access is against the site's Terms of Service, so **keep volume low
and don't use it commercially or for bulk data collection.** Run it on your own
responsibility. The public HTML job pages sit behind an anti-bot challenge; this skill
deliberately uses only the lightweight public JSON endpoints and makes a handful of requests
at a time, not a crawl.

## When to use this skill

- Search Otta / Welcome to the Jungle openings by keyword, country, and remote policy
- Filter by recency (posted within N days) or workplace type (remote / hybrid)
- Get the full description of a specific Welcome to the Jungle job listing

## Commands

### Search job listings

```bash
bun run skills/otta-search/cli/src/cli.ts search --query "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Recommended.
- `--location <text>` / `-l <text>` — country filter: a country **name** (`"India"`,
  `"United Kingdom"`) or **ISO code** (`IN`, `GB`, `FR`). Filters on the job's office country.
- `--remote <mode>` — `remote` (fully remote), `hybrid` (partial remote), `occasional`, or `onsite`.
- `--jobage <days>` — posted within N days (e.g. `1`, `7`, `14`, `30`). Applied **client-side**
  (the index has no server-side recency filter), so combine with a specific `--query`.
- `--page <n>` — page number (1-indexed, 30 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run skills/otta-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job ID from `search` results (e.g. `4051077`). You may also pass a full
`welcometothejungle.com/en/companies/<org>/jobs/<slug>` URL, or an `<org>/<slug>` pair.
Returns the full description, preferred-experience section, contract type, remote policy,
experience level, salary (when present), and the apply link.

## Usage examples

```bash
# Data analyst roles in India
bun run skills/otta-search/cli/src/cli.ts search -q "data analyst" -l India --format table

# Fully-remote data engineer roles posted in the last 14 days
bun run skills/otta-search/cli/src/cli.ts search -q "data engineer" --remote remote --jobage 14 --format table

# Power BI roles in the UK, capped at 10
bun run skills/otta-search/cli/src/cli.ts search -q "power bi" -l GB --limit 10 --format table

# Bengaluru / hybrid analytics roles (country India, hybrid remote)
bun run skills/otta-search/cli/src/cli.ts search -q "analytics" -l IN --remote hybrid --format table

# Full details for a specific job (id from search results)
bun run skills/otta-search/cli/src/cli.ts detail 4051077 --format plain

# Full details from a job URL
bun run skills/otta-search/cli/src/cli.ts detail "https://www.welcometothejungle.com/en/companies/wise-1/jobs/lead-product-analyst-operations_hyderabad"
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Each JSON result has: `id`, `title`, `company`, `companySlug`, `location`, `remote`,
`contractType`, `date`, `slug`, `url`. Missing values are `null`, never omitted. The
envelope is `{ "meta": { "count", "page" }, "results": [...] }`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1`.

## Notes

- **Otta is now Welcome to the Jungle.** `otta.com` 301-redirects to the WTTJ platform. The
  original Otta "matching" product (`app.welcometothejungle.com`) is login-gated and is **not**
  used here; this skill uses the *public* WTTJ job board, which needs no account.
- Data comes from the public Algolia index `wk_cms_jobs_production` (app `CSEKHVMS53`) — the
  same one the WTTJ website queries. If the site rotates its public search key, update
  `ALGOLIA_API_KEY` in `cli/src/helpers.ts` (see `url-reference.md`).
- **Location filtering is by country**, not city — pass a country name or ISO code. There is
  no city-level flag (city appears in each result's `location`).
- `--jobage` is a **client-side** filter over the current page's results; the index exposes no
  server-side recency parameter.
- Page size is fixed at 30 results per page. Algolia caps total reachable results at ~1000 per
  query — narrow with `--query`/`--location` to page deeper.
- Full job pages on the website are behind an anti-bot challenge, so `detail` fetches from the
  site's public REST API instead; the `url` field is still the human-openable canonical link.
- Listings skew European/UK but include a growing number of India and remote roles. Many roles
  at French companies are still described in English; some are French — check the result.
