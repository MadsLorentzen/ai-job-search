---
name: arbeitnow-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Germany, find English-speaking
  or remote-friendly German-market job listings, look up a specific Arbeitnow job posting, or
  asks about the German job market via Arbeitnow — even if they don't say "arbeitnow"
  explicitly. Invoke for open positions, job vacancies, hiring in Germany, or German-market
  roles in any sector, especially English-speaking-friendly roles. Trigger phrases include:
  arbeitnow, jobsuche, stellenangebote, jobs in deutschland, jobs in germany, english speaking
  jobs germany, remote jobs germany, jobs in berlin, jobs in munich, jobs in muenchen, jobs in
  hamburg, jobs in frankfurt, jobs in cologne, product owner jobs germany, product manager
  jobs germany, tech jobs germany, arbeit finden, offene stellen deutschland.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/arbeitnow-search/cli/src/cli.ts *)
---

# Arbeitnow Search Skill

Search live German job listings via Arbeitnow's free public job-board API. No authentication
needed, **zero runtime dependencies** — it runs with just `bun`. Complements `stepstone-search`
with an aggregator that leans toward English-speaking-friendly and remote-friendly German-market
roles.

## Personal use, low volume

Arbeitnow's public API response embeds its own terms: *"This is a free public API for jobs,
please do not abuse... By using the API, you agree to the terms of service present on
Arbeitnow.com."* Nothing this skill touches is disallowed by robots.txt, but **keep volume low,
don't use it for bulk data collection, and run it on your own responsibility.**

## When to use this skill

- Search for job openings in Germany by job title/keyword, company, or tag
- Filter to roles posted within the last N days
- Get the full description, employment type, and posting/expiry dates of a specific posting
- Look specifically for English-speaking-friendly German-market roles (Arbeitnow's listings
  skew toward tech/startup companies that post in English)

## Commands

### Search job listings

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords, matched against title, company name, and tags.
- `--location <text>` / `-l <text>` — substring match against location, e.g. `"Berlin"`.
- `--jobage <days>` — only postings within the last N days.
- `--page <n>` — 1-indexed server page (~176 jobs/page, reverse-chronological). Default 1.
- `--limit <n>` / `-n <n>` — cap results emitted (client-side, after filtering).
- `--format json|table|plain` — default `json`.

> **Important: this API has no server-side search** (verified — see `url-reference.md`). Every
> flag above except `--page` filters the ONE page fetched, client-side. To search more broadly
> or further back in time, call `search` again with a higher `--page`.

### Fetch full job detail

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts detail <url> [--format json|plain]
```

Pass the full `url` from a `search` result — a bare slug alone cannot be turned into a working
URL (it's missing the company slug). Returns richer structured detail than `search` gives you:
ISO `datePosted`/`validThrough`, `employmentType`, and `jobBenefits`, sourced from the job
page's embedded JobPosting schema.org data.

## Usage examples

```bash
# Product Owner roles, most recent page
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q "Product Owner" --format table

# Product Manager roles in Berlin
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q "Product Manager" -l Berlin --format table

# Roles posted in the last 14 days
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q "Product" --jobage 14 --format table

# Older postings (page 2, further back in time)
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q "Product" --page 2 --format table

# Full detail for a specific posting (URL from a search result)
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts detail "https://www.arbeitnow.com/jobs/companies/awin/machine-learning-engineer-berlin-berlin-munchen-bavaria-180645" --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing URLs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- `search`'s `description` field already comes back full (via `detail`) — `search` results
  themselves don't include description text (kept out to keep table/json output scannable);
  call `detail` on a specific `url` when you need the full text.
- `date` in `search` output is a real ISO timestamp; `datePosted`/`validThrough` in `detail`
  output are also ISO — no relative-time-string parsing needed (unlike `stepstone-search`).
- `location` can be `null` for fully-remote or unlocated postings.
- Query keywords work in **English or German** — many Arbeitnow listings are themselves posted
  in English, which fits the candidate's "English-speaking roles only" constraint for Germany.
- See `url-reference.md` for the full API response shape, the verification that no server-side
  search exists, and the JSON-LD detail-page structure.
