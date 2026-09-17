# gamesjobsdirect-cli

CLI for searching **[GamesJobsDirect](https://www.gamesjobsdirect.com)**, a
UK-headquartered games-industry job board with international listings (English language).

**Data source**: public `/results` search page and `/job/<slug>/<slug>/<id>` detail pages (plain server-rendered HTML — no separate JSON API).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

## Installation

```bash
cd .agents/skills/gamesjobsdirect-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Environment artist roles
bun run src/cli.ts search -q "environment artist" --format table

# 3D artist roles posted in the last 30 days
bun run src/cli.ts search -q "3d artist" --jobage 30 --limit 10 --format table

# Full detail for one job
bun run src/cli.ts detail 349054 --format plain
```

See `../SKILL.md` for the full flag reference and portal-specific notes.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / studio / skill). Optional. |
| `--location` | `-l` | Best-effort location filter — see the note in `SKILL.md`; prefer folding the place into `--query`. |
| `--jobage` | | Posted within N days — snaps to the site's fixed buckets (`1`, `7`, `14`, `30`). |
| `--page` | | 1-indexed page (~10 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |
