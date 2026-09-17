# hitmarker-cli

CLI for searching [Hitmarker](https://hitmarker.net/jobs) — a job board
covering **gaming, esports, and content** roles across all disciplines (not
just art) — via its Typesense search backend.

**Data source**: `search.hitmarker.com` Typesense `multi_search` endpoint, collection `hitmarker_jobs`.
**Authentication**: A public, search-only scoped API key (`TSSK`) that Hitmarker embeds in every visitor's page HTML — the CLI fetches it fresh from `hitmarker.net/jobs` on each run rather than hardcoding it, in case it rotates.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

## Installation

```bash
cd .agents/skills/hitmarker-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search jobs by keyword |
| `detail` | Fetch full detail for a single job by its id |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Environment artist roles, table view
bun run src/cli.ts search -q "Environment Artist" --format table

# Props artist roles posted in the last 14 days
bun run src/cli.ts search -q "3D Props Artist" --jobage 14 --format table

# Full detail for one job (id from a search result's id)
bun run src/cli.ts detail 3598322 --format plain
```

See `../SKILL.md` for the full flag reference and known quirks.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title, description, company, or tag). Optional — omit for all jobs. |
| `--jobage` | | Posted within N days. **Server-side** filter on `postDate`. |
| `--page` | | 1-indexed page. Default 1. |
| `--limit` | `-n` | Results per page (server-side). Default 20. |
| `--format` | | `json` \| `table` \| `plain`. |

**No location filter yet.** Hitmarker's UI supports location filtering, but the
param wiring wasn't identified during scaffolding. Search by keyword and read
each result's `location`/`remote` fields.

## Output shape

Search JSON is `{ "meta": { "count", "page", "total" }, "results": [...] }`; each
result carries `id`, `title`, `company`, `location` (joined from the posting's
location entries, `null` if unset), `remote` (boolean, inferred from a location
entry titled/typed "remote"), `date` (posting date, ISO), `url`, `level`,
`contract` (e.g. "Full Time").

`detail` adds `description` (plain text — Hitmarker's API returns it
unescaped, no HTML stripping needed), `applyUrl` (the employer's own
application page or a `mailto:` link — Hitmarker itself is not an ATS), `tags`,
and `salary` (formatted when a poster set one; `null` on every sample seen
during scaffolding).

## A note on the search key

The `X-TYPESENSE-API-KEY` this CLI sends is not a secret credential — it is the
same scoped, search-only key Hitmarker's own website sends from every visitor's
browser (the pattern Typesense and Algolia both call a "secured search key": it
can only read, and its allowed fields/query patterns are constrained
server-side). The CLI fetches it fresh from the jobs page on each run instead of
hardcoding it so a future key rotation doesn't silently break the skill.
