# stepstone-cli

CLI for searching jobs on **StepStone.de** (Germany), across any sector.

**Data source**: StepStone.de public search and job-detail pages (`/jobs/<title>[/in-<city>]` and `/stellenangebote--...-inline.html`).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use, low volume.** StepStone's robots.txt disallows most search endpoints and its
> JSON API entirely; this CLI only uses the paths it explicitly permits. The site also runs
> active bot detection. Keep volume low, don't use it for bulk data collection, and run it on
> your own responsibility. See `../url-reference.md` for the full robots.txt analysis.

## Installation

```bash
cd .agents/skills/stepstone-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings (`--query` recommended, `--location` optional) |
| `detail` | Fetch full detail for a single job listing (needs the full URL from `search`) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Product Owner roles in Berlin
bun run src/cli.ts search -q "Product Owner" -l "Berlin" --format table

# Product Manager roles anywhere in Germany
bun run src/cli.ts search -q "Product Manager" --format table

# Full detail for one job (URL from a search result)
bun run src/cli.ts detail "https://www.stepstone.de/stellenangebote--...--14255090-inline.html" --format plain
```

See `../SKILL.md` for the full flag reference and the personal-use note.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Job title / keywords, e.g. `"Product Owner"`. Recommended. |
| `--location` | `-l` | German city, e.g. `"Berlin"`. Optional. |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

No `--jobage` or `--page` — see `../url-reference.md` for why (robots.txt only permits a
single, query-string-free search URL per query on this portal).

## Why this CLI's search URL has no query string

StepStone's robots.txt disallows almost every query-string variant on `/jobs/*` and disallows
the JSON API that backs its own search UI (`/public-api/resultlist/`) outright. The one
compliant, static pattern — `/jobs/<title-slug>/in-<city-slug>` — is what this CLI builds. Full
analysis in `../url-reference.md`.

## Detail pages require a Referer header

Fetching a `/stellenangebote--...-inline.html` page without a `Referer` header reliably hangs
(observed 15-30s timeouts, zero bytes). `helpers.ts` always sends one. If you're modifying this
code, don't drop it.
