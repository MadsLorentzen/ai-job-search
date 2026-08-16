# randstad-india-cli

CLI for searching jobs on **Randstad India's** public job board
(https://www.randstad.in/jobs/), across any Indian city and sector.

**Data source**: Randstad India search-results pages — the job list is parsed
from the Next.js RSC (React Server Components) payload embedded in the HTML
(no official API). See `../url-reference.md`.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is
optional and only pulls dev type defs.

## Installation

```bash
cd .agents/skills/randstad-india-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings (`--query` and/or `--location`) |
| `detail` | Fetch full detail for a single job (takes the full job URL) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Project manager roles in Pune
bun run src/cli.ts search -q "project manager" -l "Pune" --format table

# Data engineer roles in Bengaluru, last 30 days
bun run src/cli.ts search -q "data engineer" -l "Bengaluru" --jobage 30 --format table

# Accountant roles in Mumbai, first 10
bun run src/cli.ts search -q "accountant" -l "Mumbai" --limit 10 --format table

# Full detail for one job (pass the url from a search result)
bun run src/cli.ts detail "https://www.randstad.in/jobs/project-manager-structural_pune_8b8726ea-cf54-4912-9f6d-d11e25f6fbee/" --format plain
```

See `../SKILL.md` for the full flag reference and portal quirks.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). Recommended. |
| `--location` | `-l` | Indian city, e.g. `"Pune"`, `"Bengaluru"`, `"Mumbai"`. |
| `--jobage` | | Keep only jobs posted within N days (client-side filter). |
| `--page` | | 1-indexed page (only page 1 is fetched server-side). |
| `--limit` | `-n` | Cap results emitted (client-side). |
| `--format` | | `json` \| `table` \| `plain` (default `json`). |

Provide at least `--query` or `--location`.

## Testing

```bash
bun run typecheck   # tsc --noEmit
bun test            # flag-validation + a live search smoke test
```

The live smoke test hits randstad.in and expects ≥1 real result — keep volume low.
