# hirist-cli

Self-contained CLI for searching jobs on **Hirist** (hirist.tech), a curated
India tech job board. Talks to Hirist's public JSON API — no authentication, no
API key, **zero runtime dependencies** beyond `bun`.

> **Personal use only.** Reads Hirist's public job API; keep volume low and do
> not use it commercially or for bulk data collection.

## Setup

```bash
bun install
```

## Usage

```bash
# Search (query is required)
bun run src/cli.ts search -q "data analyst" -l "Bangalore" --format table
bun run src/cli.ts search -q "business intelligence" -l "Pune" --jobage 30
bun run src/cli.ts search -q "power bi" -l "Mumbai" --limit 10

# Detail (by id or hirist.tech/j/... URL)
bun run src/cli.ts detail 1654660 --format plain
```

### Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title/skill/role). **Required.** |
| `--location` | `-l` | Indian city (Bangalore, Pune, Mumbai, Delhi NCR, …) or Remote. |
| `--jobage <days>` | | Posted within N days. |
| `--page <n>` | | 1-indexed page (50/page). |
| `--limit <n>` | `-n` | Cap results (client-side). |
| `--format` | | `json` (default) \| `table` \| `plain`. |

Errors go to **stderr** as `{ "error", "code" }` with exit code `1`.

## Scripts

```bash
bun run typecheck   # tsc --noEmit
bun run test        # live API tests (bun test)
```

See `../url-reference.md` for the API endpoints and response shapes.
