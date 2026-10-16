---
name: jsearch-search
version: 1.0.0
description: >
  Use this skill to search live job listings through the JSearch API (Google for
  Jobs data, sold on RapidAPI), which aggregates postings from job boards and
  employers' own career sites in one call (in Ireland: LinkedIn, Jobrapido,
  Jooble; not Indeed, as of 2026-10). Works for any country; this
  fork uses it for Dublin, Ireland. Trigger phrases:
  Google for Jobs, JSearch, find jobs in Dublin, job search Ireland, jobs posted
  this week, "are there any <role> jobs in <place>".
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jsearch-search/cli/src/cli.ts *)
---

# JSearch Search Skill

Searches Google for Jobs through the JSearch API
(OpenWeb Ninja, on RapidAPI - search "JSearch" in the RapidAPI hub). Google for Jobs collects postings from Indeed, LinkedIn,
Glassdoor, smaller boards and employers' own career pages, so this one skill is how
`/scrape` reaches Indeed without scraping it. Zero runtime dependencies - it runs with
just `bun`.

> **Observed 2026-10-15 (Ireland):** two live searches, 13 results: LinkedIn, Jobrapido and Jooble, **no Indeed**. Google for Jobs in this market does not appear to carry Indeed listings, so do not count on this skill for Indeed. Most results duplicate `linkedin-search`. Free plan: 200 requests per month.

## Setup (required - every call is billed)

1. Subscribe to **JSearch** on RapidAPI (the free Basic plan is enough to start).
2. Export your RapidAPI key, outside the repo:

   ```bash
   echo 'export JSEARCH_API_TOKEN="<your X-RapidAPI-Key>"' >> ~/.zshenv
   ```

The CLI reads the key **only** from `JSEARCH_API_TOKEN` - never a flag, never a file in
the repo. Without it every command exits 1 with `MISSING_CREDENTIALS`.

**Cost:** each `search` or `detail` call is **one billed request** against the plan's
monthly quota (a `search` fetches one page, about 10 jobs). When the quota runs out the
CLI stops with `QUOTA_EXCEEDED` instead of retrying. Budget `/scrape` accordingly: one
search per target title, `detail` only for jobs worth a closer look.

## Commands

### Search

```bash
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "<keywords>" [flags]
```

- `--query`, `-q <text>` - **required.** Job title or skill.
- `--location`, `-l <text>` - place, appended to the query as "in <place>" (JSearch takes location inside the query text).
- `--country <code>` - ISO 3166 two-letter code that scopes results, e.g. `ie`.
- `--jobage <days>` - posted within N days. JSearch only has buckets (today / 3 days / week / month), so the CLI requests the smallest bucket that covers N and trims to the exact N days client-side. Undated results are kept.
- `--remote` - remote jobs only.
- `--exclude-publishers <list>` - comma-separated sources to leave out, e.g. `LinkedIn`. `/scrape` passes `LinkedIn`, because `linkedin-search` already covers it and each result page costs a request.
- `--cursor <token>` - next page: pass `meta.nextCursor` from the previous search. Each page is a billed request.
- `--limit`, `-n <n>` - cap results emitted (client-side).
- `--format json|table|plain` - default `json`.

### Detail

```bash
bun run .agents/skills/jsearch-search/cli/src/cli.ts detail "<id>" [--country ie] [--format json|plain]
```

Returns the full description, the qualification and responsibility highlights, and every
apply option. Quote the id: JSearch ids are base64 and can end in `=`.

## Usage examples (Dublin)

```bash
# Data engineering roles in Dublin posted in the last 7 days
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "data engineer" -l "Dublin, Ireland" --country ie --jobage 7 --format table

# QA / test automation, last 7 days
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "test automation engineer" -l "Dublin, Ireland" --country ie --jobage 7

# Data quality and ETL testing
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "data quality analyst" -l "Dublin, Ireland" --country ie --jobage 7

# Remote-in-Ireland data analyst roles
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "data analyst" --country ie --remote --jobage 7

# Full posting
bun run .agents/skills/jsearch-search/cli/src/cli.ts detail "<id from search>" --country ie --format plain
```

## Output

`search --format json` prints `{ "meta": { "count", "page" }, "results": [...] }`. Each result:

| Field | Meaning |
|---|---|
| `id` | JSearch job id (pass to `detail`) |
| `title`, `company`, `location` | as published; `null` when missing |
| `date` | posting date `YYYY-MM-DD` (UTC), `null` when JSearch has none |
| `url` | the primary apply link - often a job board, not the employer |
| `publisher` | where Google found it: `Indeed`, `LinkedIn`, `Glassdoor`, or the employer |
| `applyOptions` | every place the job is listed: `{ publisher, url, isDirect }`; `isDirect: true` usually means the employer's own careers site |
| `employerWebsite`, `employmentType`, `isRemote`, `postedAt` | extras; `postedAt` is unix seconds |

Errors go to stderr as `{ "error", "code" }` with exit 1. Codes: `MISSING_CREDENTIALS`,
`BAD_CREDENTIALS`, `NOT_SUBSCRIBED`, `QUOTA_EXCEEDED`, `REQUEST_FAILED`, `NOT_FOUND`,
`UNKNOWN_FLAG`, `NO_QUERY`, `BAD_ARG`.

## Notes for /scrape

- **Verification is easier here than anywhere else.** Before falling back to a careers-site search, check `applyOptions` for an `isDirect` link or one on the employer's domain - that is the employer's own posting. Fetch it to confirm the role is live and store **that** URL in `seen_jobs.json`.
- **Overlap with `linkedin-search`.** Google for Jobs also carries LinkedIn postings, so the same job can arrive from both portals. `/scrape` Step 2's dedup (URL, then company+title) handles it; a LinkedIn-published JSearch result adds nothing new.
- **Indeed links** (`ie.indeed.com/viewjob?...`) are for the user to open in a browser. Never fetch them from the CLI or WebFetch - Indeed's bot protection is never worked around.
- `date` comes from Google's crawl and can lag the employer's own date by a day or two; the employer page is authoritative.
