# stationf-cli

CLI for searching the [STATION F job board](https://jobs.stationf.co) — job
openings at the ~1,000 startups on the STATION F campus in Paris.

**Data source**: the board's own public Algolia index (`wk_cms_jobs_production_careers`)
for search; the job page's schema.org `JobPosting` ld+json for detail.
**Authentication**: None. The Algolia application id and *search-only* key are published
by the board's `/search` page for its own JavaScript; the CLI re-reads them at call time.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

`robots.txt` on jobs.stationf.co is `Allow: /` — nothing here is behind a login or
a disallowed path. Keep query volume modest anyway: this is a job search, not a crawl.

## Installation

```bash
cd .agents/skills/stationf-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings by keyword and facet filters |
| `detail <org/slug>` | Fetch one posting's full description and requirements |

```bash
bun run src/cli.ts search -q "data engineer" -l Paris --contract cdi --format table
bun run src/cli.ts search --department Tech --jobage 14 --sort date --format table
bun run src/cli.ts detail allphins/data-engineer-h-f_paris --format plain
```

Run `bun run src/cli.ts --help` for the full flag list.

## Output

Search JSON: `{ "meta": { "count", "page", "total", "window", "truncated" }, "results": [...] }`.
Each result carries `id`, `title`, `company`, `location`, `date`, `url`, plus
`contract`, `contract_type`, `remote`, `salary`, `department`, `experience_years`,
`reference`. Missing values are `null`, never omitted.

Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.
Codes: `BAD_ARG`, `BAD_CMD`, `NO_ID`, `BAD_ID`, `NOT_FOUND`, `PARSE_FAILED`,
`SEARCH_FAILED`, `DETAIL_FAILED`, `INTERNAL_ERROR`.

The `id` is `<org-slug>/<job-slug>` — the pair that addresses the public job page,
which is what `detail` consumes.

## Environment overrides

Only needed if the board stops publishing its credentials inline (see
`../url-reference.md`):

| Variable | Default |
|---|---|
| `STATIONF_ALGOLIA_API_KEY` | read from `https://jobs.stationf.co/search` |
| `STATIONF_ALGOLIA_APP_ID` | `CSEKHVMS53` |
| `STATIONF_ALGOLIA_INDEX_SUFFIX` | `production_careers` |

## Tests

```bash
bun run test        # unit tests + a small live smoke suite
bun run typecheck
```

`parsing.test.ts` and `cli-flag-validation.test.ts` are offline. `commands.test.ts`
hits the live board (one search, one detail) — it is the tripwire for the board
changing its markup or Algolia setup.

Live tests are **opt-in** so CI and offline runs stay green:

```bash
PORTAL_LIVE_TESTS=1 bun test    # includes the live smoke suite
```
