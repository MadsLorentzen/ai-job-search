---
name: themuse-search
version: 1.0.0
description: >
  Use this skill to search US job listings across many companies at once via The
  Muse's public jobs API. This is the primary cross-company US job board in this
  fork — reach for it first for open-ended US job discovery, remote or in a named
  city. Covers software, data, product, design, marketing, finance, healthcare,
  operations and more. Trigger phrases: find a job, job search, search for jobs,
  US jobs, jobs in the US, remote jobs, job openings, vacancies, hiring, positions
  open, "are there any X jobs in <US city>", "what remote X jobs are out there",
  look up this job posting, themuse, the muse.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/themuse-search/cli/src/cli.ts *)
---

# The Muse Search Skill

Search live US job listings from [The Muse](https://www.themuse.com) via its
**public API** — no authentication, no API key, and **zero runtime dependencies**.
The Muse publishes this API for public use, so unlike most large US boards it does
not block automated access.

> **This is the primary cross-company US portal in this fork.** Indeed, ZipRecruiter
> and SimplyHired all block automated requests (HTTP 401/403), and Dice's `robots.txt`
> disallows the job paths — so they are deliberately not implemented. The Muse is the
> viable open-ended US search. The ATS skills (`greenhouse-search`, `lever-search`)
> complement it by searching a *named company* directly.

## ⚠️ The one thing to know before using this skill

**The Muse's API has no free-text search parameter.** `q`, `query`, `keyword` and
`search` are all silently ignored — the reported total is identical with or without
them. Server-side filtering is limited to `category`, `level`, `location` and `company`.

Consequently `--query` in this CLI is a **client-side** filter applied over a bounded
sweep of pages. The practical pattern is:

1. Narrow **server-side** with `--category` and `--location` (this is the real filter).
2. Refine **client-side** with `--query` and raise `--pages` so the sweep has enough
   to bite on.

Searching with `--query` alone across all 400k+ postings will be slow and will miss
most matches, because it can only filter the pages it actually fetched.

## When to use this skill

- Open-ended US job discovery — remote or in a specific city
- Filtering by job family (`--category`) and seniority (`--level`)
- Getting the full description of a specific Muse posting

## Commands

### Search job listings

```bash
bun run .agents/skills/themuse-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--category <text>` — **the most useful filter (server-side).** e.g. `"Software Engineering"`, `"Data Science"`, `"Product Management"`, `"Design and UX"`.
- `--location <text>` / `-l <text>` — server-side. e.g. `"Austin, TX"`, `"New York, NY"`. `"Remote"` is mapped automatically to The Muse's own `"Flexible / Remote"` bucket.
- `--level <text>` — server-side. e.g. `"Entry Level"`, `"Mid Level"`, `"Senior Level"`, `"Management"`.
- `--company <slug>` — server-side, by company short name (e.g. `avalabs`).
- `--query <text>` / `-q <text>` — **client-side** keyword filter over title and company (see the warning above).
- `--jobage <days>` — posted within N days (client-side, on `publication_date`).
- `--page <n>` — 1-indexed page, 20 results per page.
- `--pages <n>` — pages to sweep when `-q` is used (default 3, max 10).
- `--limit <n>` / `-n <n>` — cap results emitted.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/themuse-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `21675716`). A full
`themuse.com/jobs/...` URL containing the id also works. Returns the full decoded
description, level, category, and apply link.

## Usage examples

```bash
# Remote software engineering roles, most recent first
bun run .agents/skills/themuse-search/cli/src/cli.ts search --category "Software Engineering" -l "Remote" -n 20 --format table

# Remote senior data science roles
bun run .agents/skills/themuse-search/cli/src/cli.ts search --category "Data Science" --level "Senior Level" -l "Remote" --format table

# Narrow server-side, then refine client-side for "platform"
bun run .agents/skills/themuse-search/cli/src/cli.ts search --category "Software Engineering" -l "Remote" -q "platform" --pages 6 --format table

# Product roles in a named city, posted in the last 14 days
bun run .agents/skills/themuse-search/cli/src/cli.ts search --category "Product Management" -l "Austin, TX" --jobage 14 --format table

# Full details for a specific job
bun run .agents/skills/themuse-search/cli/src/cli.ts detail 21675716 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **The Muse's own categorization is noisy.** A `--category "Software Engineering"` search legitimately returns records like "Director, HRBP" and "Medical Science Liaison" — those postings really are tagged `Software Engineering` in The Muse's data. This is upstream data quality, not a parsing fault. Use `-q` to cut through it.
- Pages are 0-indexed in the API; this CLI exposes the contract's 1-indexed `--page` and converts.
- Page size is fixed at 20 results per page.
- `location` accepts multiple values in the API; this CLI passes one. Postings often list several locations, joined with `; ` in the `location` field.
- `search` JSON includes a `meta.queryFilteredClientSide` flag so a caller can tell a genuine "no matches" from a sweep that simply ran out of pages.
- The CLI retries 429/5xx with exponential backoff and jitter, and returns `null` (not a crash) on 404.
