---
name: hitmarker-search
version: 1.0.0
description: >
  Use this skill to search live gaming / esports / content-industry job listings
  on Hitmarker (hitmarker.net/jobs), or to look up a specific posting. Covers all
  disciplines across games and esports companies (art, engineering, production,
  community, marketing, esports operations), not just art roles. Trigger phrases:
  find a games industry job, esports job search, game studio jobs, community
  manager games jobs, esports operations jobs, "are there any <role> jobs in
  games/esports", look up this Hitmarker job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/hitmarker-search/cli/src/cli.ts *)
---

# Hitmarker Search Skill

Search live job listings from **[Hitmarker](https://hitmarker.net/jobs)** — a
job board covering the gaming, esports, and games-adjacent content industries
across **all disciplines**, not just art. No authentication beyond the site's
own public search key, and **zero runtime dependencies** — it runs with just
`bun`.

> This is a worked example of the repo's job-portal-skill pattern, like
> `artstation-search`. Hitmarker's site is a Vue SPA backed by a
> [Typesense](https://typesense.org/) search cluster (`search.hitmarker.com`,
> collection `hitmarker_jobs`), found via live browser network capture — static
> grep of the minified JS bundles revealed the Typesense client wiring but not
> the collection name or the request payload shape.

## When to use this skill

- Search for gaming/esports/content-industry job openings by keyword, across any
  discipline (not just art — engineering, production, community, marketing,
  esports ops all appear on this board)
- Look up a specific Hitmarker posting by its job id
- Good complement to `artstation-search`: Hitmarker skews toward esports/publishing/
  community roles in addition to art, where ArtStation is art-only

## Commands

### Search job listings

```bash
bun run .agents/skills/hitmarker-search/cli/src/cli.ts search [-q "<keywords>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, description, company, or tag). Optional; omit for all jobs.
- `--jobage <days>` — posted within N days. **Server-side** filter (`postDate:>` in Typesense's `filter_by`).
- `--page <n>` — 1-indexed page. Default 1.
- `--limit <n>` / `-n <n>` — results per page (server-side). Default 20.
- `--format json|table|plain` — default `json`.

**No location filter yet.** Hitmarker's web UI supports location filtering, but
its query-param wiring wasn't identified during scaffolding. Search by keyword
and read each result's `location`/`remote` fields; `/scrape` should treat this
portal as keyword-only for geographic relevance, same as `artstation-search`.

### Fetch full job detail

```bash
bun run .agents/skills/hitmarker-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job's numeric id from a `search` result's `id` field (e.g.
`3598322`). You may also pass a full `https://hitmarker.net/jobs/<slug>-<id>`
URL. Returns the full plain-text description, contract type, level, tags, and
the employer's own `applyUrl` or application email (Hitmarker is not an ATS —
postings link out).

## Usage examples

```bash
# Environment artist roles, table view
bun run .agents/skills/hitmarker-search/cli/src/cli.ts search -q "Environment Artist" --format table

# Props artist roles posted in the last 14 days
bun run .agents/skills/hitmarker-search/cli/src/cli.ts search -q "3D Props Artist" --jobage 14 --format table

# Full detail for a specific job
bun run .agents/skills/hitmarker-search/cli/src/cli.ts detail 3598322 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total" }, "results": [...] }`;
each result carries `id`, `title`, `company`, `location` (`null` if unset),
`remote` (boolean), `date`, `url`, `level`, `contract`. All errors are written
to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with
code `1`.

## Notes

- Data is from Hitmarker's public Typesense search backend. The
  `X-TYPESENSE-API-KEY` the CLI sends is not a secret — it is the same
  scoped, search-only key ("secured search key" in Typesense/Algolia
  terminology) that Hitmarker's own site sends from every visitor's browser.
  The CLI fetches it fresh from `hitmarker.net/jobs` on each run rather than
  hardcoding it, in case Hitmarker rotates it.
- A direct document-retrieve call with this key returns `401 Forbidden` (the
  scoped key is search-only) — `detail` works around this by reusing
  `multi_search` with `filter_by: id:=<id>`, which the scoped key does permit.
- `robots.txt` (`https://hitmarker.net/robots.txt`) disallows `/actions/`,
  `/cache/`, `/cpresources/`, `/dist/` — none of which this skill touches
  (`search.hitmarker.com` is a different host entirely, not covered by
  `hitmarker.net`'s robots.txt).
- `date` is the posting's `postDate`; results are sorted `postDate:desc` by
  default (newest first).
- `jobSalary` was `null` on every sample seen during scaffolding — the CLI
  formats it defensively if a poster does set one, without assuming a fixed shape.
- Retries 429/5xx with exponential backoff; an unreachable API exits non-zero
  with a clear message rather than hanging.
