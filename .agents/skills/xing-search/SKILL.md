---
name: xing-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs on Xing, the
  DACH-market (Germany, Austria, Switzerland) professional network, find job
  listings there, or look up a specific Xing job posting. Trigger phrases:
  Xing jobs, search Xing, Xing Stellenanzeigen, Jobsuche Xing, Stellenangebote
  Xing, look up this Xing job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/xing-search/cli/src/cli.ts *)
---

# Xing Search Skill

Find job listings on **Xing** (xing.com), the DACH-market professional network,
without authentication and with **zero runtime dependencies** — it runs with just
`bun`.

## ⚠️ Access-rules note (read before use)

Xing's `/jobs/search/` page and its GraphQL API are disallowed by `robots.txt` for
every crawler — including the `ClaudeBot`/`GPTBot`/`PerplexityBot` group that
`robots.txt` otherwise explicitly permits on `/jobs/search/` (that carve-out doesn't
actually help: the page it names is a client-rendered shell with no server-side job
data, all of which lives behind the disallowed GraphQL calls). This skill **never
touches either of those** — it works entirely from Xing's public job-URL sitemap
(`xing.com/jobs/sitemap.xml.gz`) and individual job detail pages, both of which
`robots.txt`'s generic `User-agent: *` block leaves open to any crawler. See
`url-reference.md` for the full breakdown.

Even though this path is robots.txt-compliant, **keep volume low** and run it on
your own responsibility — the sitemap sync alone is a larger one-time download
(~14MB compressed, cached 24h) than any other portal skill in this repo makes in
a single call.

## How search actually works here

Xing has no lightweight keyword-search endpoint. `search` instead:
1. Downloads and locally caches (24h TTL) Xing's full job-posting sitemap — a flat
   list of job URLs, no keyword filter of its own.
2. Keyword-matches the query (and optional `--location`) against each URL's slug.
3. Fetches a bounded number of the most-likely-newest matches (highest job ID
   first) and verifies each one's real detail page — confirming it's still live
   and pulling the actual title/company/location/date.

The sitemap keeps years-old expired postings mixed in with current ones, so a
search can legitimately return fewer results than `--limit` if the probe budget
runs out before enough live matches turn up. Treat a thin/empty result the way
`../job-scraper/SKILL.md` treats any other stale-listing signal — not as a bug.

## Commands

### Search job listings

```bash
bun run .agents/skills/xing-search/cli/src/cli.ts search --query "<text>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — **required.** Keywords (title, skill, role).
- `--location <text>` / `-l <text>` — city/region additionally required in the slug match, e.g. `"Frankfurt"`, `"Köln"`.
- `--jobage <days>` — posted within N days, checked against each fetched candidate's real posting date.
- `--page <n>` — 1-indexed page over the matched candidate list.
- `--limit <n>` / `-n <n>` — max results to return. Default `20`.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/xing-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the full slug from `search` results (e.g.
`koeln-ot-cyber-security-senior-consultant-122981029`), or a full `xing.com/jobs/...`
URL. Xing's trailing numeric ID **alone** does not reliably resolve to the same
posting — pass the id/url exactly as `search` returned it.

## Usage examples

```bash
# Embedded software roles
bun run .agents/skills/xing-search/cli/src/cli.ts search -q "Embedded Software Engineer" --format table

# Project-lead roles in Frankfurt, last 14 days
bun run .agents/skills/xing-search/cli/src/cli.ts search -q "Projektleiter" -l "Frankfurt" --jobage 14 --format table

# Full detail for one job
bun run .agents/skills/xing-search/cli/src/cli.ts detail koeln-ot-cyber-security-senior-consultant-122981029 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data source: Xing's public job sitemap + server-rendered `JobPosting` JSON-LD detail pages. No credentials required.
- First `search` call syncs the full sitemap (~14MB compressed, cached 24h under `cli/.cache/`); later calls within the TTL reuse the cache.
- `date` in `search`/`detail` output is the posting's real `datePosted` from its detail page — never the sitemap's `<lastmod>`, which was verified live to reflect Xing's last sitemap-regeneration touch, not the posting date.
- `detail`'s `isActive` is `true`/`false` from comparing `validThrough` to now, or `null` when Xing gave no `validThrough` — never inferred.
