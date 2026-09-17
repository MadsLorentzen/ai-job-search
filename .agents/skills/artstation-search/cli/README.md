# artstation-cli

CLI for searching [ArtStation Jobs](https://www.artstation.com/jobs) — a
job board focused on **game, 3D, VFX, and concept art** roles — via its
public JSON API.

**Data source**: ArtStation jobs API (`/api/v2/jobs/public/jobs.json`, `/api/v2/jobs/public/jobs/<id>.json`).
**Authentication**: None required — reads are public.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

## Installation

```bash
cd .agents/skills/artstation-search/cli
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
bun run src/cli.ts detail aNba --format plain
```

See `../SKILL.md` for the full flag reference and known quirks.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). Optional — omit for all jobs. |
| `--jobage` | | Posted within N days. **Client-side filter** — the API has no server-side date param. |
| `--page` | | 1-indexed page. Default 1. |
| `--limit` | `-n` | Results per page / cap (client-side). Default 20. |
| `--format` | | `json` \| `table` \| `plain`. |

**No location filter yet.** ArtStation's web UI has a Location dropdown, but its
query-param wiring wasn't identified during scaffolding (out of scope for the
zero-dependency JSON-passthrough approach here). Search by keyword and read each
result's `location`/`remote` fields, or extend `search.ts` if you find the param.

## Output shape

Search JSON is `{ "meta": { "count", "page", "total" }, "results": [...] }`; each
result carries `id` (the ArtStation `hash_id` — pass this to `detail`), `title`,
`company`, `location` (joined from `recruitment_localities`, `null` if unset),
`date` (posting `created_at`), `url`, `remote`, `level`, `job_type`.

`detail` adds the full HTML-stripped `description`, `applyUrl` (the employer's own
application page — ArtStation itself is not an ATS), `salary` (formatted from the
posting's salary range when present), `skills`, and `offerRelocation`.
