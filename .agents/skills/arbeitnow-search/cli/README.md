# arbeitnow-cli

CLI for searching jobs on **Arbeitnow** (Germany-focused, incl. English-speaking/remote-friendly listings), across any sector.

**Data source**: Arbeitnow's public job-board API (`https://www.arbeitnow.com/api/job-board-api`) for search; the job's own page (embedded JSON-LD) for detail.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use, low volume.** The API's own response embeds a "please do not abuse" notice.
> Keep volume low and run it on your own responsibility. See `../url-reference.md`.

## Installation

```bash
cd .agents/skills/arbeitnow-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings (client-side filtered — see below) |
| `detail` | Fetch full detail for a single job listing (needs the full URL from `search`) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Product Owner roles
bun run src/cli.ts search -q "Product Owner" --format table

# Product Manager roles in Berlin, posted in the last 14 days
bun run src/cli.ts search -q "Product Manager" -l Berlin --jobage 14 --format table

# Full detail for one job (URL from a search result)
bun run src/cli.ts detail "https://www.arbeitnow.com/jobs/companies/awin/machine-learning-engineer-berlin-berlin-munchen-bavaria-180645" --format plain
```

See `../SKILL.md` for the full flag reference and the personal-use note.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords, matched against title/company/tags. |
| `--location` | `-l` | Substring match against location. |
| `--jobage` | | Only postings within N days. |
| `--page` | | 1-indexed server page (~176 jobs/page). Default 1. |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Why search filters client-side

Arbeitnow's job-board API looks like it might support `?search=`/`?location=`/`?remote=` etc,
but it doesn't — verified by comparing responses across several unrecognized parameter names
and values (including a gibberish value), all of which returned identical results. Only
`?page=` genuinely changes the response. Full write-up in `../url-reference.md`.

## Named HTML entities

Real Arbeitnow descriptions (many originally German) use named entities like `&uuml;`, not just
numeric ones — `decodeHtmlEntities()` in `helpers.ts` has an explicit table for these. If you
see literal `&xxxx;` sequences leaking into output, that table is the first place to check.
