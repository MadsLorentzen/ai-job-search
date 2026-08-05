---
name: greenhouse-search
version: 1.0.0
description: >
  Use this skill to search a SPECIFIC company's open roles when that company
  hosts its careers page on Greenhouse — the most common ATS among US tech
  companies. Best when the user names an employer or works from a target-company
  list ("what's open at Stripe", "any data roles at Databricks", "check these
  five companies"). Not for open-ended discovery — Greenhouse has no
  cross-company search; use themuse-search for that. Trigger phrases: jobs at
  <company>, openings at <company>, <company> careers, <company> is hiring,
  check <company> for roles, greenhouse, greenhouse board, ATS search.
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

## ⚠️ Scope: this is a target-company tool, not a search engine

**Greenhouse has no cross-company search.** The API is addressed per company by
its *board token* — the slug in `boards.greenhouse.io/<token>`. `--company` is
therefore **required**, and `--query` is a **client-side** filter over job titles.

Pair it with `themuse-search` (open-ended discovery) and `lever-search` (the
other common ATS). The workflow that pays off: build a list of employers you care
about, then sweep them all in one call with a comma-separated `--company`.

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
- `--company <list>` / `-c <list>` — **required.** One board token or a comma-separated list, e.g. `stripe` or `stripe,databricks,figma`. A token that doesn't resolve is reported in `meta.boardErrors` and the run continues with the rest.
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

## Usage examples

```bash
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
