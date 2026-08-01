# weworkremotely-cli

CLI for searching **We Work Remotely**'s public RSS job feeds, across any
sector, worldwide.

**Data source**: We Work Remotely public RSS feeds (`weworkremotely.com/*.rss`).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

`robots.txt` is fully open for these feeds. Individual HTML job pages are
behind an active Cloudflare bot-challenge and are never fetched by this CLI —
the RSS `description` is already the complete posting (verified on a live
item), so both `search` and `detail` work off the feed alone.

## Installation

```bash
cd .agents/skills/weworkremotely-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search a category feed (or all jobs) with client-side filters |
| `detail` | Fetch full detail for a single job listing (must still be in the current feed) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Back-end roles, last 14 days
bun run src/cli.ts search -q "backend" --category back-end-programming --jobage 14 --format table

# Node roles open to "Anywhere"
bun run src/cli.ts search -q "node" -l "Anywhere" --format table

# Full detail for one job (id is the URL's trailing slug)
bun run src/cli.ts detail cloudflare-principal-partner-solutions-engineer-saarc-based-in-bangalore --format plain
```

See `../SKILL.md` for the full flag reference and known category slugs.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / company / category), client-side. |
| `--category` | | Category feed slug (see `../url-reference.md` for the known list). Default: all jobs. |
| `--location` | `-l` | Region substring match (e.g. `"US"`, `"Europe"`, `"Anywhere"`). |
| `--jobage` | | Posted within N days. |
| `--page` | | 1-indexed page (20 results/page, client-side pagination over the feed). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |
