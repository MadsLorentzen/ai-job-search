# firecrawl-cli

CLI for finding job postings on **any** job board, in any market and language, via
the [Firecrawl](https://docs.firecrawl.dev) v2 REST API — and for reading a single
posting in full. There is no per-portal HTML parser: Firecrawl extracts the job
fields from each posting page, so nothing here breaks when a board changes its markup.

**Data source**: the Firecrawl v2 REST API (`POST /v2/search`, `POST /v2/scrape`).
**Authentication**: `FIRECRAWL_API_KEY` ([get one](https://firecrawl.dev)) for the
hosted API; not required against a self-hosted `FIRECRAWL_API_URL`.
**Dependencies**: zero runtime dependencies (plain `fetch`, no SDK); dev types only.

> **Credentialed and metered.** Unlike the other portal CLIs in this repo, this one
> needs an API key and spends credits per result. Measured live: a plain search
> (`--no-enrich`) costs **2 × ceil(limit / 10)**, and enrichment adds **~5 per
> successfully enriched result** — so `--limit 20` costs ~104 when every result
> is enriched.
> `meta.credits_used` reports the real figure on every run.
>
> The skill therefore ships `enabled: false` **as its steady state**, not as a
> pending opt-in: `/scrape` has no metered-source tier, and would run this as a
> co-equal primary at ~20 results across several queries. Invoke it directly with a
> `--limit` you have chosen. See `../SKILL.md` for the full rationale.
>
> Without a key (and without a self-hosted URL) every command exits `1` with
> `NO_API_KEY` on stderr, so nothing bills by accident.

## Installation

```bash
cd .agents/skills/firecrawl-search/cli && bun install
```

The install is optional — the CLI has no runtime dependencies and runs with plain
`bun`; `bun install` only pulls TypeScript dev types for `bun run typecheck`.

## Self-hosting / base URL

Firecrawl is [open source](https://github.com/firecrawl/firecrawl). Point the CLI at
your own instance with `FIRECRAWL_API_URL` (default `https://api.firecrawl.dev`). A
self-hosted instance runs unauthenticated by default, so **no key is needed** — and
no credits are spent:

```bash
FIRECRAWL_API_URL=http://localhost:3002 bun run src/cli.ts search -q "data engineer job"
```

If your instance does require a key, set `FIRECRAWL_API_KEY` too and it is sent
there. Whenever a key is set it goes to whatever `FIRECRAWL_API_URL` names, so don't
point it at a host you don't trust with your cloud key.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search the web for job postings, optionally scoped to given job-board domains |
| `detail <url>` | Scrape one posting: full text as markdown plus the extracted fields |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. A search result's `id` is its URL, so it can be passed
straight to `detail`.

All errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Data engineering roles across the big ATS boards, last 30 days
bun run src/cli.ts search -q "data engineer job opening" --site job-boards.greenhouse.io,jobs.lever.co --jobage 30 --limit 5 --format table

# A market with no portal skill yet: Germany, in German
bun run src/cli.ts search -q "Stellenangebot Datenanalyst bewerben" --country DE --limit 5 --format table

# Cheap, wide sweep for URLs only (4 credits at --limit 20; no company/location/date)
bun run src/cli.ts search -q '"machine learning engineer" remote apply' --no-enrich --limit 20

# Read one posting in full
bun run src/cli.ts detail https://job-boards.greenhouse.io/acme/jobs/123 --format plain
```

See `../SKILL.md` for the full flag reference, the credit-cost breakdown, and query
advice; `../url-reference.md` documents the API shapes this CLI depends on.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query <text>` | `-q` | **Required.** Keywords; supports `""`, `-`, `inurl:`, `intitle:` operators |
| `--site <domains>` | | Restrict to these boards (comma-separated, repeatable) |
| `--exclude-site <domains>` | | Drop these domains; mutually exclusive with `--site` |
| `--country <code>` | | ISO-3166 alpha-2 search locale (default `US`) |
| `--location <place>` | `-l` | Geo-target the results, e.g. `"Berlin,Germany"` |
| `--jobage <days>` | | Search-freshness hint, bucketed to day/week/month/year — **not** a filter on the posting date |
| `--page <n>` | | 1-indexed page, default 1 (re-fetches; search has no offset param) |
| `--limit <n>` | `-n` | Results per page, default 10; `page × limit` must be ≤ 100 |
| `--no-enrich` | | Skip per-result extraction: cheap and fast, but no company/location/date |
| `--format <fmt>` | | `json` (default), `table`, or `plain` |

Because this searches the whole web, an unqualified role name finds reference pages
rather than vacancies. State the intent in the query ("... job opening apply", or the
market's own phrasing) and scope `--site` to boards you want; the CLI never rewrites
your query for you. See the query section in `../SKILL.md`.

## Tests

```bash
bun test        # network-free: unit tests plus mocked-fetch command tests
```
