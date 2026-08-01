# remoteok-cli

CLI for searching **RemoteOK**'s public remote-job listings, across any
sector, worldwide.

**Data source**: RemoteOK public JSON feed (`remoteok.com/api`).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

RemoteOK's `robots.txt` carries an explicit AI/LLM-crawler section allowing
`ClaudeBot`/`anthropic-ai`/`Claude-Web` to crawl public job listings. Keep
volume reasonable and credit RemoteOK as the source (its API response embeds
its own attribution terms) if you use this data beyond personal job search.

## Installation

```bash
cd .agents/skills/remoteok-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search the recent job feed (all filters are optional) |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Backend roles, posted in the last 14 days
bun run src/cli.ts search -q "backend" --jobage 14 --format table

# Node.js roles, remote/worldwide only
bun run src/cli.ts search -q "nodejs" -l remote --format table

# Full detail for one job
bun run src/cli.ts detail 1135691 --format plain
```

See `../SKILL.md` for the full flag reference.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). First word also narrows the RemoteOK API's own `tags` filter; the full phrase is matched client-side against title/company/tags. |
| `--location` | `-l` | Client-side substring match; `remote`/`worldwide` matches unspecified-location roles too. |
| `--jobage` | | Posted within N days. |
| `--page` | | 1-indexed page (20 results/page, client-side pagination over the feed). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- The feed is a snapshot of recent postings (no true server-side pagination or historical archive).
- `detail` on an ID outside the recent feed falls back to fetching the job's own page directly.
