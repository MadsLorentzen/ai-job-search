---
name: remotive-search
version: 1.0.0
description: >
  Use this skill to check Remotive's curated remote-jobs feed — a small,
  hand-curated source of fully-remote roles across software, data, design,
  marketing, support and writing. Useful as a supplementary sweep when the user
  wants remote-only work, NOT as a primary source: the free feed holds only a few
  dozen live postings. Prefer themuse-search for volume. Trigger phrases: remote
  jobs, work from home jobs, fully remote roles, remote-only, distributed team
  jobs, remotive, remote job board.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/remotive-search/cli/src/cli.ts *)
---

# Remotive Search Skill

Search [Remotive](https://remotive.com)'s curated remote-jobs feed via its public
API. No authentication, no API key, and **zero runtime dependencies**.

## ⚠️ Personal use only — Remotive's terms

The API response carries an explicit legal notice. Verified 2026-08-04, it states:

- Access is granted so developers can **share Remotive's jobs onward** — with attribution.
- **Do not submit Remotive jobs to third-party job sites** (Jooble, Neuvoo, Google Jobs and LinkedIn Jobs are named explicitly).
- **Link back to the Remotive URL and credit Remotive as the source.**
- Listings on the free API are **deliberately delayed by 24 hours**.
- Using the feed to collect signups or email addresses breaches their ToS.
- A private paid API exists for commercial use (their stated starting budget is $5k/mo).

Reading these listings for **your own job search** is squarely within that. Do not
republish them. The CLI emits a `Source: Remotive` attribution line in `table` and
`plain` output and an `attribution` field in JSON, so the credit travels with the data.

## ⚠️ The other thing to know: the feed is small

Verified 2026-08-04: the free feed returned **32 jobs total** (`total-job-count: 32`),
spanning about a month, across 11 categories — and it **ignores every documented
filter parameter**. The count drifts as jobs roll through (a probe the next day
returned 31); the order of magnitude is the point, and the code reads the size from
the response rather than assuming it. `search`, `category`, `company_name` and `limit` all return the
same full record set.

So: all filtering in this CLI is **client-side**, and this portal is a supplementary
sweep, not a primary source. Use `themuse-search` for volume and
`greenhouse-search` / `lever-search` for target companies.

## Commands

### Search job listings

```bash
bun run .agents/skills/remotive-search/cli/src/cli.ts search [flags]
```

Key flags (all client-side):
- `--query <text>` / `-q <text>` — keyword filter over title, company and tags.
- `--category <text>` — e.g. `"Software Development"`, `"Data and Analytics"`, `"Devops"`, `"Design"`. A slug like `software-development` also works.
- `--location <text>` / `-l <text>` — eligibility region. `"USA"` also matches `Worldwide`, `North America` and `Americas` listings, since those include US candidates.
- `--jobage <days>` — posted within N days.
- `--page <n>` — 1-indexed page, 25 results per page.
- `--limit <n>` / `-n <n>` — cap results emitted.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/remotive-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` (e.g. `1749306`); a Remotive job URL works too.

**Remotive has no per-job endpoint.** The feed already carries every posting's full
description, so `detail` re-fetches the feed and selects locally. A job that has aged
out of the small feed returns `NOT_FOUND` with an explanation — that is expected
behaviour, not a breakage.

## Usage examples

```bash
# The whole current feed
bun run .agents/skills/remotive-search/cli/src/cli.ts search --format table

# Software roles only
bun run .agents/skills/remotive-search/cli/src/cli.ts search --category "Software Development" --format table

# Engineering roles open to US candidates
bun run .agents/skills/remotive-search/cli/src/cli.ts search -q "engineer" -l "USA" --format table

# Posted in the last week
bun run .agents/skills/remotive-search/cli/src/cli.ts search --jobage 7 --format table

# Full details for one posting
bun run .agents/skills/remotive-search/cli/src/cli.ts detail 1749306 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, includes `meta.feedTotal` and `attribution` |
| `table` | Quick human-readable scanning (prints the Remotive attribution line) |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **`candidate_required_location` is an eligibility region, not a city.** Values look like `Worldwide`, `USA`, `USA, Canada`, `Americas, Europe, Asia`. There are no city-level listings, so `-l "Austin"` will match nothing — filter by region.
- **`publication_date` has no timezone suffix** (`2026-08-02T20:00:46`). The parser appends `Z` and treats it as UTC; parsing it raw would silently shift by the local offset.
- `company_name` routinely carries a trailing space in the feed — trimmed by the parser.
- `meta.feedTotal` in JSON output reports the whole feed size, so a caller can distinguish "my filter was too narrow" from "the source is just this small".
- The 24-hour delay is intentional on Remotive's side. A role you see elsewhere first will show up here a day later.
