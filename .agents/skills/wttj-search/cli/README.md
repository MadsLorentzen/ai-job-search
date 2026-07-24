# wttj-cli

CLI for searching [Welcome to the Jungle](https://www.welcometothejungle.com) —
the largest job board in the French market (~95,000 live postings).

**Data source**: the site's own public Algolia index (`wk_cms_jobs_production`, plus its
`_published_at_desc` replica) for search; the job page's schema.org `JobPosting`
ld+json for detail, with an index-lookup fallback.
**Authentication**: None. The Algolia application id and *search-only* key are published by
`https://www.welcometothejungle.com/api/env` for the site's own JavaScript; the CLI re-reads
them at call time.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

## ⚠️ Personal use only

`robots.txt` disallows query-string URLs, so the site's search page is off-limits
to automated clients — this CLI does not fetch it, it calls the Algolia host the
site's front-end calls. Job detail pages carry no query string and are allowed.

Keep volume low (a handful of queries per session, never a crawl), no commercial
or bulk use, at your own responsibility. See `../SKILL.md` and `../url-reference.md`
for the full reasoning.

The site is behind AWS WAF: detail fetches get anti-bot challenges when you push
too hard. The CLI surfaces that as a `WAF_CHALLENGE` error and falls back to the
search index instead of retrying blindly. If you see it, wait — do not loop.

## Installation

```bash
cd .agents/skills/wttj-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings by keyword and facet filters |
| `detail <org/slug>` | Fetch one posting's full description and requirements |

```bash
bun run src/cli.ts search -q "data engineer" -l Paris --contract cdi --format table
bun run src/cli.ts search --department Tech --region Ile-de-France --jobage 7 --format table
bun run src/cli.ts detail gitguardian/senior-data-engineer_paris_GITGU_1O04qgL --format plain
```

Run `bun run src/cli.ts --help` for the full flag list.

## Output

Search JSON: `{ "meta": { "count", "page", "total", "window", "truncated" }, "results": [...] }`.
Each result carries `id`, `title`, `company`, `location`, `date`, `url`, plus
`contract`, `contract_type`, `remote`, `salary`, `department`, `experience_years`,
`reference`. Missing values are `null`, never omitted.

`meta.total` is the raw Algolia hit count, which **overstates distinct jobs**: WTTJ
stores one record per job per syndicated website (up to 16), and the CLI dedupes
by `reference`.

`detail` output includes `"source"`: `"page"` (full description from the job page)
or `"index"` (WAF fallback — structured fields plus the requirements text,
`description: null`).

Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.
Codes: `BAD_ARG`, `BAD_CMD`, `NO_ID`, `BAD_ID`, `NOT_FOUND`, `PARSE_FAILED`,
`WAF_CHALLENGE`, `SEARCH_FAILED`, `DETAIL_FAILED`, `INTERNAL_ERROR`.

## Environment overrides

Only needed if the site stops publishing its credentials (see `../url-reference.md`):

| Variable | Default |
|---|---|
| `WTTJ_ALGOLIA_API_KEY` | read from `https://www.welcometothejungle.com/api/env` |
| `WTTJ_ALGOLIA_APP_ID` | `CSEKHVMS53` |
| `WTTJ_ALGOLIA_INDEX` | `wk_cms_jobs_production` |

## Tests

```bash
bun run test        # unit tests + a small live smoke suite
bun run typecheck
```

`parsing.test.ts` and `cli-flag-validation.test.ts` are offline. `commands.test.ts`
hits the live site (a few searches, one detail) — the tripwire for a key rotation
or a record-shape change. A `WAF_CHALLENGE` during the detail test means throttling,
not breakage: wait and re-run.

Live tests are **opt-in** so CI and offline runs stay green:

```bash
PORTAL_LIVE_TESTS=1 bun test    # includes the live smoke suite
```
