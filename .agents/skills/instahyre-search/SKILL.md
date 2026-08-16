---
name: instahyre-search
version: 1.0.0
description: >
  Use this skill to search for jobs on Instahyre — a curated tech/startup job
  board in India — or to look up a specific Instahyre posting. Invoke for
  software, backend, frontend, full-stack, data science / ML, DevOps, product,
  design, and sales roles at Indian startups and product companies, in cities
  like Bangalore, Mumbai, Delhi NCR, Pune, Hyderabad, Chennai, or remote.
  Trigger phrases: Instahyre jobs, find a job on Instahyre, tech jobs in India,
  startup jobs India, "backend developer jobs in Bangalore", "data scientist
  jobs Mumbai", naukri Instahyre, search Instahyre, look up this Instahyre job.
context: fork
allowed-tools: Bash(bun run skills/instahyre-search/cli/src/cli.ts *)
---

# Instahyre Search Skill

Search live job listings from [Instahyre](https://www.instahyre.com), a curated
AI-driven tech/startup hiring platform in **India**. Uses Instahyre's public
`job_search` JSON API — no authentication, no API key, and **zero runtime
dependencies** (runs with just `bun`).

## ⚠️ Personal use only

This reads Instahyre's public API and posting pages. Applying to a job requires an
account, but reading listings does not. **Keep volume low and don't use it
commercially or for bulk data collection.** Run it on your own responsibility.

## When to use this skill

- Find tech/startup job openings in India by keyword/skill and city
- Browse roles at Indian product companies and startups
- Get the full description of a specific Instahyre posting

## Commands

### Search job listings

```bash
bun run skills/instahyre-search/cli/src/cli.ts search --query "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords / skill / role. Mapped to Instahyre's
  **skill filter** (e.g. `"backend developer"`, `"React"`, `"data science"`).
- `--location <city>` / `-l <city>` — city filter, e.g. `"Bangalore"`, `"Mumbai"`,
  `"Delhi NCR"`, `"Pune"`, `"Hyderabad"`, `"Remote"`.
- `--jobage <days>` — **unsupported** by Instahyre (its public API has no
  posting-age filter or date field). Accepted for interface parity but ignored.
- `--page <n>` — page number (1-indexed, **35 results per page**).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

At least one of `--query` or `--location` must be supplied.

### Fetch full job detail

```bash
bun run skills/instahyre-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `432044`). You may also pass
a full posting URL (`https://www.instahyre.com/job-432044-...`). Returns the full
description, employment type, posted date, location, and skills.

## Usage examples

```bash
# Backend developer roles (all India)
bun run skills/instahyre-search/cli/src/cli.ts search -q "backend developer" --format table

# Data scientist roles in Bangalore
bun run skills/instahyre-search/cli/src/cli.ts search -q "data scientist" -l "Bangalore" --format table

# React roles in Mumbai, first 10 only
bun run skills/instahyre-search/cli/src/cli.ts search -q "React" -l "Mumbai" --limit 10 --format plain

# DevOps roles in Pune, page 2
bun run skills/instahyre-search/cli/src/cli.ts search -q "devops" -l "Pune" --page 2 --format table

# Full details for a specific job
bun run skills/instahyre-search/cli/src/cli.ts detail 432044 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- Data is from Instahyre's public `job_search` JSON API — no credentials required.
- **`date` is always `null` in search results** — the search API carries no posting
  date. Use `detail` to get a posting's `datePosted`.
- The API's free-text `q=` param is ignored by the server (it returns the full feed),
  so `--query` is mapped to the `skills=` filter, which is the actual keyword filter.
- Page size is fixed at 35; `--limit` trims results client-side.
- Instahyre may rate-limit; the CLI retries 429/5xx with exponential backoff. Keep
  volume low (see personal-use note above).
- See `url-reference.md` for full endpoint documentation and parsing anchors.
