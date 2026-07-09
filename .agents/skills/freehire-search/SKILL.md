---
name: freehire-search
version: 1.0.0
description: >
  Use this skill to search live software / tech / data / engineering job listings
  across many countries and markets (and remote) via the freehire.dev aggregator's
  public API, or to look up a specific posting. It aggregates roles from ~50 ATS
  platforms into one schema, so a single skill covers many markets — but its faceted
  filtering (skills, category, seniority) is tuned tech-first, so scope triggers to
  technical roles. Trigger phrases: find a tech job, software job search, developer
  jobs, engineering vacancies, data/ML jobs, DevOps roles, remote developer jobs,
  "are there any <tech role> jobs in <place>", look up this freehire job posting.
context: fork
allowed-tools: Bash(bun run .agents/skills/freehire-search/cli/src/cli.ts *)
---

# freehire Search Skill

Search live job listings from the **[freehire.dev](https://freehire.dev)** job
aggregator — an open-source IT job board that normalizes postings from ~50 ATS
platforms across many countries into one schema. No authentication, no API key,
and **zero runtime dependencies** — it runs with just `bun`. The market is chosen
per query via facet flags (`--region`, `--country`), so the same skill works for a
forker in any market out of the box.

> This is a country-agnostic worked example of the repo's job-portal-skill pattern,
> like `linkedin-search`. Unlike the HTML-scraping portals, it queries freehire's
> public JSON API, so results are structured (skills, seniority, region facets)
> rather than parsed from markup.

## ⚠️ Scope: tech-focused

freehire's corpus already includes some non-tech postings (it crawls whole company
career pages), **but its faceted filtering — skills, categories, and seniority
dictionaries — is tuned tech-first today**, so this skill scopes its triggers to
software / data / engineering / tech roles, where the filtering is strong. Non-tech
coverage exists but is still maturing; don't rely on this skill for general
(non-technical) job coverage yet.

## ℹ️ Hosted-service dependency (best-effort, no SLA)

This skill depends on a third-party hosted service, freehire.dev. Reads are
**public and unauthenticated** — the same zero-signup bar as `linkedin-search`.

**freehire.dev is a personal project but actively maintained; it runs on a
best-effort basis (no formal SLA).** If the API is unreachable, the CLI fails
gracefully — a non-zero exit with a clear error message — so an outage degrades
this source rather than breaking the surrounding workflow.

**Self-hosting / swappable base URL.** The freehire backend is a separate
MIT-licensed repo — [`strelov1/freehire`](https://github.com/strelov1/freehire)
(Go + PostgreSQL + Meilisearch) — that stands up with one command via Docker
Compose (`make up` → API on `:8080`, same `/api/v1/...` paths). The skill honors a
base-URL env var, `FREEHIRE_API_URL` (default `https://freehire.dev`), so pointing
it at a local instance is a one-line change:

```bash
FREEHIRE_API_URL=http://localhost:8080 bun run .agents/skills/freehire-search/cli/src/cli.ts search -q "go"
```

Caveat: standing up the *API* is light, but keeping a *full, continuously-fresh*
mirror (millions of postings across ~50 platforms) is resource-heavy — a
self-hoster would either crawl a scoped subset of sources or point the env var back
at the hosted API.

## When to use this skill

- Search for tech job openings by keyword, in a given region/country or remotely
- Filter by seniority, category, skills, or recency (posted within N days)
- Get the full description of a specific freehire posting by its slug

## Commands

### Search job listings

```bash
bun run .agents/skills/freehire-search/cli/src/cli.ts search [-q "<keywords>"] [facet flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Full-text; optional.
- `--jobage <days>` — posted within N days (maps to `posted_within_days`).
- `--page <n>` — 1-indexed page. Default 1.
- `--limit <n>` / `-n <n>` — results per page (API limit). Default 25.
- `--format json|table|plain` — default `json`.

Facet filters (values come from freehire's controlled vocabularies; comma-separate for OR within a facet):
- `--region <codes>` — macro-region, e.g. `global`, `eu`, `us`, `apac`, `latam`, `cis`. `--region eu,us`. Use `none` to match jobs whose region could **not** be resolved (see "Partial data" below).
- `--country <codes>` — ISO-3166 alpha-2, e.g. `--country DE,GB`
- `--city <names>` — city name(s), e.g. `--city Berlin`
- `--seniority <levels>` — `junior`, `middle`, `senior`, `staff`, `principal`, `lead`, …
- `--category <cats>` — `backend`, `frontend`, `fullstack`, `devops`, `ml_ai`, `qa`, …
- `--skill <names>` — canonical skill(s), e.g. `--skill go,kubernetes`
- `--company <slug>` — company slug (from a result's `company_slug`)
- `--remote <mode>` — `remote` | `hybrid` | `onsite` (`work_mode` facet)
- `--facet <key=value>` — any other facet param (repeatable), e.g. `--facet salary_min=100000`

> **Location is a facet, not free text.** Unlike `linkedin-search`'s `--location`,
> freehire filters geography through the structured `--region`/`--country`/`--city`
> facets. Discover the live values for a market at
> [`/api/v1/jobs/facets`](https://freehire.dev/api/v1/jobs/facets) (append `?q=<role>`
> to scope it) — never invent facet values.

### Fetch full job detail

```bash
bun run .agents/skills/freehire-search/cli/src/cli.ts detail <slug|url> [--format json|plain]
```

`slug` is the `id` from a `search` result (e.g. `golang-zensar-2bxu6dxm`). You may
also pass a full `https://freehire.dev/jobs/<slug>` URL. Returns the full (HTML-stripped)
description, skills, region/country, and — when the posting is enriched — seniority,
category, employment type, and salary.

## Usage examples

```bash
# Senior backend roles, table view
bun run .agents/skills/freehire-search/cli/src/cli.ts search -q "backend engineer" --seniority senior --limit 10 --format table

# Remote React roles in the EU
bun run .agents/skills/freehire-search/cli/src/cli.ts search -q "react" --remote remote --region eu --format table

# DevOps roles in Germany posted in the last 14 days
bun run .agents/skills/freehire-search/cli/src/cli.ts search --category devops --country DE --jobage 14 --format table

# ML/AI roles anywhere, fully remote
bun run .agents/skills/freehire-search/cli/src/cli.ts search -q "machine learning" --category ml_ai --remote remote --format table

# Full details for a specific job
bun run .agents/skills/freehire-search/cli/src/cli.ts detail golang-zensar-2bxu6dxm --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing a result's `id` (slug) to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total" }, "results": [...] }`; each
result carries at least `id` (the freehire slug), `title`, `company`, `location`,
`date`, and `url` (missing values are `null`). All errors are written to **stderr**
as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Partial data

Facets are derived per-posting and can be **incomplete** — geography especially.
A job may resolve its `work_mode` (e.g. `remote`) but leave its **region or
country undetermined** when the source's location text is ambiguous (freehire's
dictionaries never guess). So:

- A missing region/country means "not resolved", **not** "not applicable" —
  filtering on `--region eu` silently drops jobs whose region wasn't resolved,
  even if they are in fact EU. Widen or drop the facet if you need those back.
- There is a dedicated facet value for the unresolved bucket: `--region none`
  matches jobs with **no** resolved region — useful to sweep up remote roles that
  never pinned a geography. It ORs with real regions, e.g. `--region eu,none`.
- `result.regions` / `countries` / `cities` may be empty arrays for the same
  reason; treat empty as unknown, not as "none of the above".

## Notes

- Data is from freehire.dev's public API — no credentials required. Only per-user
  tracking (apply/save) needs a key, and this skill deliberately does not touch it:
  it is **search + detail only**.
- `id` in search results is the freehire `public_slug` — pass it as-is to `detail`.
- `date` is the posting date (`posted_at`); it may be `null` for undated postings.
- Facet values are controlled vocabularies. Use `/api/v1/jobs/facets` to see the
  live values (with counts) for a query before filtering.
- The API retries 429/5xx with exponential backoff; an unreachable API exits
  non-zero with a clear message (best-effort service, see the dependency note above).
