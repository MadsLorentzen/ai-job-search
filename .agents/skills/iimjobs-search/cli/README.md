# iimjobs-cli

Zero-dependency CLI for searching jobs on **iimjobs.com** (India: MBA / consulting /
analytics / BI / management roles) via its public `gladiator.iimjobs.com` JSON API.
Runs on [Bun](https://bun.sh); no auth, no API key, no runtime dependencies.

> **Personal use only.** Uses iimjobs.com's public endpoints. Keep volume low
> (10s crawl-delay) and do not use commercially or for bulk collection.

## Install

```bash
cd .agents/skills/iimjobs-search/cli
bun install
```

## Usage

```bash
# Search (provide at least --query or --location)
bun run src/cli.ts search -q "business intelligence" --limit 10 --format table
bun run src/cli.ts search -q "data analyst" -l "Bangalore" --jobage 7
bun run src/cli.ts search -q "power bi" -l "Pune" --minexp 3 --maxexp 8 --format plain

# Detail (id or full URL)
bun run src/cli.ts detail 1712209 --format plain
```

### Flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title/skill/role) |
| `--location` | `-l` | City/region name or numeric loc id (e.g. `Bangalore`, `Mumbai`, `Remote`) |
| `--jobage <days>` | | Posted within N days |
| `--minexp <years>` | | Minimum experience |
| `--maxexp <years>` | | Maximum experience |
| `--page <n>` | | 1-indexed page (50/page) |
| `--limit <n>` | `-n` | Cap results emitted |
| `--format <fmt>` | | `json` (default) \| `table` \| `plain` |

## Output

`search` → `{ meta: { count, page }, results: [...] }`. Each result:
`id, title, company, location, date, url, minExp, maxExp, tags, applyUrl`
(nulls are always present, never omitted).

`detail` adds `description, designation, industry, functionalArea`.

Errors go to **stderr** as `{"error","code"}` with exit code 1.

## Design notes

- **JSON API, no HTML parsing.** iimjobs serves search/detail as clean JSON.
- **Two location-id spaces.** The API's `loc` filter ids differ from the ids in the
  site's JS bundle; this CLI uses the API's own ids (Bangalore=3, Mumbai=2, Pune=7,
  Delhi NCR=1, Remote=132). See `../url-reference.md`.
- **`--page` is 1-indexed** here, translated to the API's 0-indexed `page`.
- **Backoff.** Exponential backoff with jitter on 429/5xx (max 6 retries); 404 → null.
- **`detail` sends a Referer header**; the JD comes from the API's `introText` HTML,
  converted to plain text.

## Scripts

```bash
bun run typecheck   # tsc --noEmit
bun run test        # bun test --timeout 30000 (includes one live network test)
```
