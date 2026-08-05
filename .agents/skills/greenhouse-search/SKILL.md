---
name: greenhouse-search
version: 1.0.0
description: >
  Use this skill to search Greenhouse job boards — the most common ATS among US
  tech companies — either BY ROLE across ~79 known company boards at once
  (--registry, ~10,800 live postings, ~5s), or BY COMPANY when the user names an
  employer. Reach for it for "senior backend roles at good companies", for a
  target-company list, and as the highest-signal source for fintech since it hits
  employers directly rather than via an aggregator. Trigger phrases: jobs at
  <company>, openings at <company>, <company> careers, <company> is hiring,
  senior engineer roles, backend roles, staff engineer, greenhouse, ATS search,
  search company job boards.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/greenhouse-search/cli/src/cli.ts *)
---

# Greenhouse Search Skill

Search a company's live openings straight from the
[Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html) —
the same public API that company careers pages are built on. No authentication,
no API key, and **zero runtime dependencies**.

Greenhouse is the dominant ATS among US tech employers, so this covers a large
share of the market — but **one company at a time**.

## Two ways to search: by role, or by company

**Greenhouse has no cross-company search API.** The API is addressed per company
by its *board token* — the slug in `boards.greenhouse.io/<token>`.

Role-first search is built on top of that limitation: `--registry` sweeps every
board in `.agents/ats-registry/companies.json` **concurrently** and filters titles
locally. At time of writing the registry holds **79 Greenhouse boards carrying
~10,800 live postings**, and a full sweep takes about **5 seconds**.

```bash
# role-first — every known board
search --registry -q "senior software engineer" -l "Remote"
# company-first — a named target list
search --company stripe,gusto,brex -q "engineer"
```

The two combine: passing both unions the registry with your explicit list.

### ⚠️ Search role nouns, not language names

`--query` matches the **job title only**, and titles almost never name a language.
Measured against the registry, remote-filtered:

| Query | Matches |
|-------|---------|
| `"senior software engineer"` | 179 |
| `"staff engineer"` | 175 |
| `"backend"` | 91 |
| `"platform engineer"` | 84 |
| `"payments"` | 16 |
| `"golang"` | **1** |

"Golang" returns almost nothing because companies title the role *Backend
Engineer* and mention Go in the description — which the list endpoint does not
return. Search the role, then read descriptions with `detail`.

### Finding a company's board token

Open the employer's careers page and look for `boards.greenhouse.io/<token>` or
`job-boards.greenhouse.io/<token>` in the URL, an embedded iframe, or a
`gh_jid` query parameter on a posting link. The token is usually the company name
lowercased (`stripe`, `databricks`).

## Commands

### Search job listings

```bash
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search --company <token>[,<token>...] [flags]
```

Key flags:
- `--registry` — sweep **every** board in the shared registry. This is what makes role-first search work. Use instead of (or alongside) `--company`.
- `--company <list>` / `-c <list>` — one board token or a comma-separated list, e.g. `stripe` or `stripe,databricks,figma`. A token that doesn't resolve is reported in `meta.boardErrors` and the run continues with the rest. **One of `--registry` or `--company` is required.**
- `--concurrency <n>` — parallel board fetches, default 8, capped at 16.
- `--query <text>` / `-q <text>` — client-side keyword filter over the **job title**.
- `--location <text>` / `-l <text>` — client-side location filter. `"Remote"` also matches `"US - Remote"`, `"US Remote"`, `"Anywhere"`, `"Distributed"`.
- `--jobage <days>` — posted within N days (client-side, on `first_published`).
- `--page <n>` — 1-indexed page, 25 results per page (Greenhouse returns a whole board at once, so this paginates client-side).
- `--limit <n>` / `-n <n>` — cap results emitted.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/greenhouse-search/cli/src/cli.ts detail <id|url> [--company <token>] [--format json|plain]
```

Greenhouse job IDs are **board-scoped**, so `detail` needs both. Either pass a full
job URL that carries both (`https://boards.greenhouse.io/stripe/jobs/8023928`, or a
careers URL with `?gh_jid=`), or pass the bare id together with `--company`.
Returns the full decoded description, department, office, and apply link.

### Grow the registry

```bash
bun run .agents/skills/greenhouse-search/cli/src/cli.ts discover "Modern Treasury" Wise Ramp [--dry-run]
```

Converts each company name to a candidate slug (lowercase, punctuation stripped —
roughly a 10-in-16 hit rate on well-known companies), probes it, and records the
ones that resolve. A board that resolves but is **currently empty still counts**,
so a company doesn't drop out during a hiring freeze. `--dry-run` reports without
writing. Slugs already in the registry are skipped rather than re-probed.

If a company resolves on neither Greenhouse nor Lever, it is likely on a third ATS
— Ashby is the common one (Ramp, Deel and Rippling are all Ashby).

## Usage examples

```bash
# ROLE-FIRST: senior backend roles across all 79 known boards, remote
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search --registry -q "senior software engineer" -l "Remote" --format table

# Role-first, recent only
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search --registry -q "staff engineer" --jobage 14 --format table

# Engineering roles at Stripe
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search -c stripe -q "engineer" --format table

# Remote engineering roles at Stripe
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search -c stripe -q "engineer" -l "Remote" --format table

# Sweep a target-company list for data roles posted in the last 30 days
bun run .agents/skills/greenhouse-search/cli/src/cli.ts search -c "stripe,databricks,figma" -q "data" --jobage 30 --format table

# Full details for one posting
bun run .agents/skills/greenhouse-search/cli/src/cli.ts detail 8089353 --company stripe --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Boards are global, not US-only.** A big employer's board carries every office worldwide (Stripe's returns London, Dublin, Singapore roles). Use `-l` to scope to US or Remote.
- `absolute_url` often points at the company's *own* careers domain with a `?gh_jid=` parameter rather than at greenhouse.io. That URL is the correct, resolvable posting link and is what gets stored.
- Greenhouse **double-escapes** `content`: it is an HTML-escaped HTML string (`&lt;p&gt;`). The parser decodes entities *before* stripping tags — reversing that order leaves visible `<p>` litter.
- `date` uses `first_published` (when the posting went live), falling back to `updated_at`. `updated_at` moves on any edit, so it overstates freshness.
- Search returns the entire board in one response; there is no server-side paging to exhaust.
- A partially failing multi-board run still exits `0` and reports the failures in `meta.boardErrors`. Only an all-boards-failed run exits `1`.
