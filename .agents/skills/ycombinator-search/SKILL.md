---
name: ycombinator-search
version: 1.0.0
description: >
  Search live startup job listings from Y Combinator's "Work at a Startup"
  (workatastartup.com) — the YC startup job board. Use when the user wants YC
  jobs, Y Combinator startup jobs, "Work at a Startup" listings, jobs at YC-backed
  startups, or startup/remote roles in engineering, data, product, design, ops,
  sales, marketing, science, legal, or finance. Global market, English-language,
  startup-focused; many roles are remote or remote-friendly. Trigger phrases:
  "YC jobs", "Y Combinator jobs", "Work at a Startup", "startup jobs", "jobs at
  YC startups", "workatastartup", look up a YC job posting.
context: fork
allowed-tools: Bash(bun run skills/ycombinator-search/cli/src/cli.ts *)
---

# Y Combinator "Work at a Startup" Search Skill

Search live job listings from **Y Combinator's startup job board**, branded
**"Work at a Startup"** and hosted at **workatastartup.com**. No authentication, no
API key, and **zero runtime dependencies** — it runs with just `bun`.

> The skill folder is named `ycombinator-search`, but the actual site is
> **workatastartup.com** (a.k.a. WaaS). They are the same thing — YC's job board.

The board lists roles at YC-backed startups worldwide. Most postings are US-centric
but many are **remote / remote-friendly**, and some are India/EU/global.

## ⚠️ Personal use only

This reads Work at a Startup's **public** job pages (no login). Automated access to a
private company's job board should stay **low-volume and personal** — don't use it
commercially or for bulk data collection, and run it on your own responsibility.
`robots.txt` does not disallow these paths, but a keyword search fans out to ~10
page requests, so keep usage light.

## Important portal limitations

Work at a Startup has **no public free-text search API and no pagination**. Public
browsing is by **role category** only, and each category returns a fixed set
(~25–30 jobs). This skill works within those limits:

- **Keyword search (`--query`) is client-side.** With `--query` or `--location` the
  CLI fetches all role categories, dedupes, and filters the union locally.
- **`--jobage` is not supported** — the portal exposes **no posting date** on public
  listings, so every result's `date` is `null` (a relative `companyLastActiveAt`
  string is included instead). The flag is accepted for contract compatibility but
  ignored.
- **`--page` is client-side** over the filtered union (20 results/page).
- Full-time vs. contract, salary, and location come straight from the listing.

## When to use this skill

- Browse startup jobs by role category (engineering, product, design, science, …)
- Keyword-filter YC startup jobs by title / role / company (`--query`)
- Filter by a location substring such as `Remote`, `India`, or `San Francisco`
- Read the full description of a specific Work at a Startup posting (`detail`)

## Commands

### Search job listings

```bash
bun run skills/ycombinator-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword filter (title, role type, company, tagline). Client-side.
- `--location <text>` / `-l <text>` — location substring filter, e.g. `"Remote"`, `"India"`, `"San Francisco"`. Client-side.
- `--role <slug>` / `-r <slug>` — restrict to one role category. Valid slugs:
  `software-engineer`, `designer`, `product-manager`, `operations`, `sales-manager`,
  `marketing`, `recruiting`, `science`, `legal`, `finance`.
- `--jobage <days>` — **accepted but ignored** (no posting dates on public pages).
- `--page <n>` — 1-indexed page, 20 results/page (client-side).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

With `--query`/`--location` the CLI aggregates all role categories; with `--role`
it fetches only that category; with none it returns the default listing.

### Fetch full job detail

```bash
bun run skills/ycombinator-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `95705`). You may also pass a
full `workatastartup.com/jobs/<id>` URL. Returns the full description, interview
process, salary/equity range, job type, required skills, visa note, company info, and
apply link.

## Usage examples

```bash
# Data-analyst-ish roles across all YC startups (client-side keyword filter)
bun run skills/ycombinator-search/cli/src/cli.ts search -q "data analyst" --format table

# Broader "data" roles that are remote, capped at 10
bun run skills/ycombinator-search/cli/src/cli.ts search -q "data" -l "Remote" --limit 10 --format table

# Everything in the Science category
bun run skills/ycombinator-search/cli/src/cli.ts search -r science --format table

# Engineering roles mentioning India in the location
bun run skills/ycombinator-search/cli/src/cli.ts search -q "engineer" -l "India" --format json

# Product roles, page 2
bun run skills/ycombinator-search/cli/src/cli.ts search -r product-manager --page 2 --format table

# Full details for a specific job
bun run skills/ycombinator-search/cli/src/cli.ts detail 95705 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON search shape:

```json
{ "meta": { "count": 1, "page": 1, "total": 18 }, "results": [ { "id": "...", "title": "...", "company": "...", "location": "...", "date": null, "url": "...", "roleType": "...", "jobType": "...", "salary": "...", "companyBatch": "...", "companyOneLiner": "...", "companyLastActiveAt": "...", "applyUrl": "..." } ] }
```

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- Data source: workatastartup.com is a server-rendered **Inertia.js** app. The CLI
  parses the JSON embedded in each page's `data-page` attribute — robust against
  cosmetic markup changes (see `url-reference.md`).
- `date` is always `null` — the public board has no posting-date field. Use
  `companyLastActiveAt` (relative string) as a freshness proxy.
- `applyUrl` routes through `account.ycombinator.com` — **applying requires a YC
  account/login**, even though browsing and reading do not.
- Each role category returns a capped set (~25–30). There is no way to page deeper
  into a category unauthenticated; `--page` only pages the client-side union.
- The board may rate-limit; the CLI backs off on 429/5xx. Keep volume low (see note above).
