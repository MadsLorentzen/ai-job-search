---
name: jobsdb-hk-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Hong Kong, find
  Hong Kong job listings, look up a specific job posting on Jobsdb, or asks
  anything about the Hong Kong job market — even if they don't mention jobsdb
  explicitly. Invoke for open positions, vacancies, and hiring in Hong Kong
  across any sector or role (software, data, design, marketing, finance,
  operations, etc.). Trigger phrases: jobsdb hong kong, hong kong jobs,
  香港工作, 香港搵工, jobs in hong kong, job search hong kong, find jobs hong
  kong, 搵工, 招聘, 職位空缺, jobsdb hk.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jobsdb-hk-search/cli/src/cli.ts *)
---

# Jobsdb Hong Kong Search Skill

Search live job listings from [Jobsdb Hong Kong](https://hk.jobsdb.com). No
authentication needed. Covers job postings in English and Traditional Chinese,
updated in real time.

## ⚠️ Personal use only

Jobsdb's `robots.txt` disallows automated crawling of `*/job/`, `/api/jobsearch/`,
`/graphql`, and most query-string paths. Automated access is against the site's
stated rules, so **keep volume low and don't use this commercially or for bulk
data collection.** Run it on your own responsibility.

## When to use this skill

Invoke this skill when the user wants to:

- Search for job openings in Hong Kong by keyword, job title, or technology
- Filter jobs by recency (posted today / last 3 / 7 / 14 / 30 days)
- Find jobs in a specific Hong Kong district or area (use `--location`)
- Get the full description of a specific Jobsdb posting
- Explore the Hong Kong job market for a given profession or skill set

## Commands

### Search job listings

```bash
bun run .agents/skills/jobsdb-hk-search/cli/src/cli.ts search -q "<keywords>" [flags]
```

Key flags:

- `--query <text>` / `-q <text>` — **required.** Keyword search (job title, skill, role).
- `--location <text>` / `-l <text>` — Optional location, e.g. `"Hong Kong"`, `"Kowloon Bay, Kwun Tong District"`, `"Central, Hong Kong Island"`.
- `--jobage <days>` — Max posting age. Maps to `daterange`: `1`, `3`, `7`, `14`, or `31` days.
- `--page <n>` — Page number (1-indexed, 30 results per page).
- `--limit <n>` / `-n <n>` — Cap total results emitted (client-side).
- `--format json|table|plain` — Default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/jobsdb-hk-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `93714207`). You may also
pass a full Jobsdb `/job/...` URL. Returns the full description, company,
location, employment type, salary (when shown), and apply link.

## Usage examples

```bash
# AI engineer roles anywhere in Hong Kong
bun run .agents/skills/jobsdb-hk-search/cli/src/cli.ts search -q "AI engineer" --limit 5 --format table

# Software engineer roles in Hong Kong, posted in the last 7 days
bun run .agents/skills/jobsdb-hk-search/cli/src/cli.ts search -q "software engineer" -l "Hong Kong" --jobage 7 --format table

# Data analyst roles in Central
bun run .agents/skills/jobsdb-hk-search/cli/src/cli.ts search -q "data analyst" -l "Central, Hong Kong Island" --format json

# Page 2 of marketing jobs
bun run .agents/skills/jobsdb-hk-search/cli/src/cli.ts search -q "marketing" --page 2 --format json

# Full details for a specific job
bun run .agents/skills/jobsdb-hk-search/cli/src/cli.ts detail 93714207 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from Jobsdb Hong Kong's public pages — no credentials required.
- Page size is fixed at 30 results per page.
- Location filtering uses a path slug; pass the location roughly as it appears in Jobsdb URLs.
- Jobsdb may rate-limit; the CLI retries 429/5xx with exponential backoff. Keep volume low (see ToS note above).
- Job IDs are numeric (e.g. `93714207`) — pass them as-is to `detail`.
- `date` is `YYYY-MM-DD` (from Jobsdb's embedded JSON); if that blob disappears it degrades to the site's relative text (e.g. "Listed one hour ago"). `detail` results have no date.
- If Jobsdb changes its markup, the parsing anchors are recorded in `url-reference.md`.
