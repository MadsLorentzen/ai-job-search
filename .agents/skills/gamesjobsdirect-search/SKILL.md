---
name: gamesjobsdirect-search
version: 1.0.0
description: >
  Use this skill to search live games-industry job listings on GamesJobsDirect
  (gamesjobsdirect.com), a UK-headquartered board with international postings
  (UK, US, EU, and beyond), or to look up a specific posting. Covers art,
  design, engineering, and production roles in games. Trigger phrases: find a
  games industry job, search GamesJobsDirect, games jobs direct, game studio
  jobs, "are there any <role> jobs in games", look up this GamesJobsDirect
  posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/gamesjobsdirect-search/cli/src/cli.ts *)
---

# GamesJobsDirect Search Skill

Search live job listings from **[GamesJobsDirect](https://www.gamesjobsdirect.com)** — a
UK-headquartered job board dedicated to the games industry, with international postings
across art, design, engineering, and production disciplines. No authentication, and
**zero runtime dependencies** — it runs with just `bun`.

> This is a worked example of the repo's job-portal-skill pattern, like `hitmarker-search`
> and `artstation-search`. GamesJobsDirect's site is plain server-rendered HTML (no JSON
> API) — the search URL was found by reading the `/bundles/search` JS bundle, and job
> detail pages embed a `schema.org/JobPosting` block that is *not* valid JSON (see
> `url-reference.md`).

## When to use this skill

- Search for games-industry job openings by keyword, across any discipline
- Filter by recency (posted within 1/7/14/30 days)
- Look up a specific GamesJobsDirect posting by its numeric job id
- Good complement to `hitmarker-search` and `artstation-search`: another
  international, English-language games-industry board with its own posting inventory

## Commands

### Search job listings

```bash
bun run .agents/skills/gamesjobsdirect-search/cli/src/cli.ts search [-q "<keywords>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (job title, studio, or skill). Optional; omit for all jobs.
- `--location <text>` / `-l <text>` — **best-effort only.** The site's own location field
  resolves free text to an internal location id via autocomplete before filtering; passing
  raw text through this flag alone did not reliably narrow results during scaffolding (see
  `url-reference.md`). Prefer folding the place name into `--query` instead, the same way
  `jobindex-search` documents for its own board.
- `--jobage <days>` — posted within N days. Snaps to the site's fixed buckets: `1`, `7`, `14`, `30`. Omit for all postings.
- `--page <n>` — page number (1-indexed, ~10 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/gamesjobsdirect-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job's numeric id from a `search` result's `id` field (e.g. `349054`). You may
also pass a full `https://www.gamesjobsdirect.com/job/<slug>/<slug>/<id>` URL. Returns the
full description, employment type, work hours, industry, deadline (`validThrough`), and the
portal's own apply link (an interstitial redirect page, not the employer's final application
URL — GamesJobsDirect is not an ATS, postings link out).

## Usage examples

```bash
# Environment artist roles, table view
bun run .agents/skills/gamesjobsdirect-search/cli/src/cli.ts search -q "environment artist" --format table

# 3D artist roles posted in the last 30 days
bun run .agents/skills/gamesjobsdirect-search/cli/src/cli.ts search -q "3d artist" --jobage 30 --format table

# Props artist roles, plain view
bun run .agents/skills/gamesjobsdirect-search/cli/src/cli.ts search -q "props artist" --format plain

# Full detail for a specific job
bun run .agents/skills/gamesjobsdirect-search/cli/src/cli.ts detail 349054 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page" }, "results": [...] }`; each result carries
`id`, `title`, `company`, `location` (`null` if unset), `date` (ISO `YYYY-MM-DD`, `null` if
unparsed), `url`, `category` (the portal's sector tag, e.g. "Art"). All errors are written
to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from GamesJobsDirect's public, server-rendered search and detail pages — no
  separate JSON API exists.
- `robots.txt` allows generic crawlers (`Allow: /`) with a 5-second crawl delay; the CLI
  enforces that delay itself between every request it makes, on top of retrying 429/5xx
  with exponential backoff.
- Job detail pages embed a `schema.org/JobPosting` block that is **not valid JSON** (stray
  semicolons in the nested address object) — the CLI extracts fields with targeted regexes
  rather than `JSON.parse`. See `url-reference.md` for the exact quirk.
- Invalid or expired job ids return HTTP 200 with an "this job has expired" page, not a 404
  — `detail` treats a missing `JobPosting` block as not-found regardless of HTTP status.
- The two slug segments in a detail URL (`/job/<company-slug>/<job-slug>/<id>`) are
  cosmetic — only the trailing numeric id matters, confirmed by diffing a real posting's
  URL against a placeholder-slug URL for the same id.
