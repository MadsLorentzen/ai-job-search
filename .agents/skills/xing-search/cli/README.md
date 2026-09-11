# xing-cli

CLI for finding jobs on **Xing** (xing.com), the DACH-market (Germany, Austria,
Switzerland) professional network.

**Data source**: Xing's job-URL sitemap (`xing.com/jobs/sitemap.xml.gz`, 13 shards,
~650k URLs) cached locally and keyword-matched, then verified against each
candidate's server-rendered detail page (`schema.org` `JobPosting` JSON-LD).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + `node:zlib`/`node:fs`). `bun install`
is optional and only pulls dev type defs.

> **Personal use only.** Xing's own `/jobs/search/` page and its GraphQL API are
> robots.txt-disallowed for every crawler, so this CLI never touches them — it only
> reads the sitemap and detail pages, which robots.txt leaves open to any crawler.
> Even so, keep volume low and run it on your own responsibility; see `../SKILL.md`
> and `../url-reference.md` for the full access-rules writeup.

## Why this CLI works differently from the other portal skills

Xing's job search is a client-rendered SPA with no server-side job data, backed by a
GraphQL API robots.txt disallows outright. There is no lightweight "search by
keyword" endpoint to call. Instead, `search` here:

1. Downloads (and caches for 24h) Xing's full job-posting sitemap — a flat list of
   job URLs with no keyword filter of its own.
2. Keyword-matches the query (and optional `--location`) as substrings against each
   URL's slug.
3. Fetches a bounded number of the most-likely-newest matches (highest numeric job
   ID first — IDs are issued roughly sequentially) and parses each one's real
   `JobPosting` JSON-LD to get the title/company/location/date and confirm it's
   still live (`validThrough` hasn't passed).

The sitemap keeps years-old expired postings mixed in with current ones, so a
`search` call can return fewer than `--limit` results if the probe budget (15–30
detail fetches, scaled off `--limit`) runs out before enough live matches turn up.
That's expected — see `../../job-scraper/SKILL.md`'s ghost-job handling for how a
run downstream should treat a thin or empty result set.

## Installation

```bash
cd .agents/skills/xing-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies. The first
`search` call downloads and caches the full sitemap (~14MB compressed); subsequent
calls within 24h reuse the cache.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Keyword-match + verify jobs from the cached sitemap (`--query` required) |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Embedded software roles, table view
bun run src/cli.ts search -q "Embedded Software Engineer" --format table

# Project-lead roles in Frankfurt, last 14 days
bun run src/cli.ts search -q "Projektleiter" -l "Frankfurt" --jobage 14 --format table

# Full detail for one job (id is the full slug, not just the trailing number)
bun run src/cli.ts detail koeln-ot-cyber-security-senior-consultant-122981029 --format plain
```

See `../SKILL.md` for the full flag reference and access-rules note.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | **Required.** Keywords (title / skill / role). |
| `--location` | `-l` | City/region additionally required in the slug match, e.g. `"Frankfurt"`, `"Köln"`. |
| `--jobage` | | Posted within N days, checked against each fetched candidate's real `datePosted`. |
| `--page` | | 1-indexed page over the matched candidate list. |
| `--limit` | `-n` | Max results to return. Default `20`. |
| `--format` | | `json` \| `table` \| `plain`. |
