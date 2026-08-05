---
name: lever-search
version: 1.0.0
description: >
  Use this skill to search a SPECIFIC company's open roles when that company
  hosts its careers page on Lever — the second most common ATS among US tech
  companies after Greenhouse. Best when the user names an employer or works from
  a target-company list ("what's open at Palantir", "any engineering roles at
  Plaid"). Not for open-ended discovery — Lever has no cross-company search; use
  themuse-search for that. If a company is not on Lever, try greenhouse-search.
  Trigger phrases: jobs at <company>, openings at <company>, <company> careers,
  <company> is hiring, check <company> for roles, lever, jobs.lever.co, ATS search.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/lever-search/cli/src/cli.ts *)
---

# Lever Search Skill

Search a company's live openings straight from the
[Lever postings API](https://github.com/lever/postings-api) — the public API that
`jobs.lever.co` careers pages are built on. No authentication, no API key, and
**zero runtime dependencies**.

## ⚠️ Scope: this is a target-company tool, not a search engine

**Lever has no cross-company search.** The API is addressed per company by its
*site slug* — the segment in `jobs.lever.co/<slug>`. `--company` is therefore
**required**, and `--query` is a **client-side** filter over job titles.

Pair it with `themuse-search` (open-ended discovery) and `greenhouse-search` (the
other common ATS). A company is on one or the other, rarely both — if a slug
returns nothing on Lever, try the same company on Greenhouse.

### Finding a company's site slug

Open the employer's careers page and look for `jobs.lever.co/<slug>` in the URL or
the embedded iframe `src`. The slug is usually the company name lowercased
(`palantir`, `plaid`).

## Commands

### Search job listings

```bash
bun run .agents/skills/lever-search/cli/src/cli.ts search --company <slug>[,<slug>...] [flags]
```

Key flags:
- `--company <list>` / `-c <list>` — **required.** One site slug or a comma-separated list. A slug that doesn't resolve is reported in `meta.siteErrors` and the run continues.
- `--query <text>` / `-q <text>` — client-side keyword filter over the **job title**.
- `--location <text>` / `-l <text>` — client-side location filter. `"Remote"` also matches on Lever's `workplaceType` field, so a role tagged remote but located "New York, NY" is still found.
- `--team <text>` — **server-side** filter, e.g. `"Engineering"`. Exact match.
- `--commitment <text>` — **server-side** filter, e.g. `"Full-time"`. Exact match.
- `--remote <mode>` — filter on `workplaceType`: `remote`, `hybrid`, or `onsite`.
- `--jobage <days>` — posted within N days (client-side, on `createdAt`).
- `--page <n>` — 1-indexed page, 25 results per page (client-side pagination).
- `--limit <n>` / `-n <n>` — cap results emitted.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/lever-search/cli/src/cli.ts detail <uuid|url> [--company <slug>] [--format json|plain]
```

Lever posting IDs are **UUIDs and site-scoped**, so `detail` needs both. Either pass
a full `jobs.lever.co/<slug>/<uuid>` URL, or the bare UUID together with `--company`.
Returns the full description (intro + requirements + closing), team, commitment,
workplace type, and apply link.

## Usage examples

```bash
# Engineering roles at Palantir
bun run .agents/skills/lever-search/cli/src/cli.ts search -c palantir -q "engineer" --format table

# Remote-tagged roles only
bun run .agents/skills/lever-search/cli/src/cli.ts search -c palantir --remote remote --format table

# Server-side team filter, full-time only
bun run .agents/skills/lever-search/cli/src/cli.ts search -c palantir --team "Engineering" --commitment "Full-time" --format table

# Sweep a target-company list, last 30 days
bun run .agents/skills/lever-search/cli/src/cli.ts search -c "palantir,plaid" -q "data" --jobage 30 --format table

# Full details for one posting
bun run .agents/skills/lever-search/cli/src/cli.ts detail https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **`company` is the site slug, not a display name.** Lever's API returns no company display name, so results carry `palantir` rather than "Palantir Technologies". This is honest reporting of what the API provides, not a parsing gap.
- **`createdAt` is epoch milliseconds**, not an ISO string. The parser converts it so `date` is comparable across portal skills.
- **`--location` is client-side on purpose.** Lever *does* accept a server-side `location`, but it demands an exact string: `location=New York, NY` works while `location=New York` returns zero. Too brittle to expose, so filtering happens locally against the full posting list.
- A posting's description is split across `descriptionPlain`, `lists[]` (requirements/responsibilities) and `additionalPlain`. The parser concatenates all three — reading only `descriptionPlain` silently drops the requirements.
- Sites are global; use `-l` or `--remote` to scope to US or remote roles.
- A valid slug with zero postings returns an empty array, which is **not** an error. Only an unresolvable slug is reported in `meta.siteErrors`.
- A partially failing multi-site run still exits `0`. Only an all-sites-failed run exits `1`.
