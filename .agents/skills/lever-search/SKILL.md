---
name: lever-search
version: 1.0.0
description: >
  Use this skill to search Lever job boards — the second most common ATS among US
  tech companies — either BY ROLE across every known Lever site at once
  (--registry) or BY COMPANY when the user names an employer. Complements
  greenhouse-search, which covers far more companies; run that one first and use
  this for the rest. If a company is on neither, it is likely on Ashby. Trigger
  phrases: jobs at <company>, openings at <company>, <company> careers, <company>
  is hiring, senior engineer roles, backend roles, lever, jobs.lever.co, ATS search.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/lever-search/cli/src/cli.ts *)
---

# Lever Search Skill

Search a company's live openings straight from the
[Lever postings API](https://github.com/lever/postings-api) — the public API that
`jobs.lever.co` careers pages are built on. No authentication, no API key, and
**zero runtime dependencies**.

## Two ways to search: by role, or by company

**Lever has no cross-company search API.** The API is addressed per company by its
*site slug* — the segment in `jobs.lever.co/<slug>`.

Role-first search works around that: `--registry` sweeps every site in the shared
`.agents/ats-registry/companies.json` **concurrently** and filters titles locally.
The registry currently holds **15 Lever sites**, swept in about **3 seconds**.

```bash
search --registry -q "senior software engineer" -l "Remote"   # role-first
search --company palantir,plaid -q "engineer"                 # company-first
```

Passing both unions the registry with your explicit list.

Lever's share is much smaller than Greenhouse's (15 sites vs 91), so run
`greenhouse-search --registry` first and treat this as the complement. A company
is on one or the other, rarely both.

### ⚠️ Search role nouns, not language names

`--query` matches the **job title only**. Titles say "Backend Engineer" and
mention Go in the description, so `-q "golang"` finds almost nothing while
`-q "backend"` or `-q "senior software engineer"` finds plenty. Search the role,
then read descriptions with `detail`.

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
- `--registry` — sweep **every** site in the shared registry (role-first search). Use instead of, or alongside, `--company`.
- `--company <list>` / `-c <list>` — one site slug or a comma-separated list. A slug that doesn't resolve is reported in `meta.siteErrors` and the run continues. **One of `--registry` or `--company` is required.**
- `--concurrency <n>` — parallel site fetches, default 8, capped at 16.
- `--us-remote` — only US-eligible remote roles. Reads Lever's structured `workplaceType` and ISO-2 `country` fields rather than regex over free text, so it does not suffer the US-place-name collisions a location blocklist would.
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

### Grow the registry

```bash
bun run .agents/skills/lever-search/cli/src/cli.ts discover "Modern Treasury" Ramp [--dry-run]
```

Probes each name as a candidate slug and records the ones that resolve. An empty
but valid site still counts, so a company doesn't drop out during a hiring freeze.
A company resolving on neither ATS is likely on Ashby (Ramp, Deel, Rippling).

## Usage examples

```bash
# ROLE-FIRST across every known Lever site
bun run .agents/skills/lever-search/cli/src/cli.ts search --registry -q "senior software engineer" -l "Remote" --format table

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
