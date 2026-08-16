# apna-cli

CLI for searching jobs on **apna.co** — India's largest blue-collar,
grey-collar and entry-level job board (delivery, driver, telecaller, sales,
retail, warehouse, security, data entry, field work), strong in tier-2/tier-3
cities.

**Data source**: apna.co public web pages — server-rendered listing pages
(`__NEXT_DATA__` JSON) and schema.org `JobPosting` detail pages. See
`../url-reference.md`.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex). `bun install` is optional
and only pulls dev type defs.

## How search works

apna has **no public free-text keyword search** (it is app/login-gated). The
public web is browsed by slug only. This CLI resolves your `--query` to apna's
nearest job **category/department** from apna's live catalog, fetches that
listing (optionally scoped to `--location`), then narrows results **client-side**
by keyword. Broad or unusual queries fall back to city-wide listings filtered by
keyword. See `../url-reference.md` for the resolution logic.

## Installation

```bash
cd .agents/skills/apna-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings (at least one of `--query`/`--location` required) |
| `detail` | Fetch full detail for a single job by id or URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Delivery roles in Delhi (canonical test query)
bun run src/cli.ts search -q "delivery executive" -l "Delhi" --format table

# Telecaller / BPO roles in Mumbai, first 10
bun run src/cli.ts search -q "telecaller" -l "Mumbai" --limit 10 --format table

# Driver jobs in Bengaluru posted in the last 7 days
bun run src/cli.ts search -q "driver" -l "Bengaluru" --jobage 7 --format table

# Data-entry / back-office roles anywhere in India
bun run src/cli.ts search -q "data entry" --format table

# Full detail for one posting (numeric id or full apna.co/job/... URL)
bun run src/cli.ts detail 276594032 --format plain
```

See `../SKILL.md` for the full flag reference and portal quirks.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Role/keyword, e.g. `"delivery executive"`, `"telecaller"`. Recommended. |
| `--location` | `-l` | Indian city, e.g. `"Delhi"`, `"Mumbai"`, `"Bengaluru"`. Optional (defaults all-India). |
| `--jobage` | | Keep only postings created within N days (client-side). |
| `--page` | | 1-indexed page (25 results/page). |
| `--limit` | `-n` | Cap results emitted (client-side). |
| `--format` | | `json` \| `table` \| `plain`. |

At least one of `--query` or `--location` is required (else exit 1, `NO_CRITERIA`).

## Output shape

JSON search output is `{ "meta": { "count", "page" }, "results": [...] }`; each
result has `id`, `title`, `company`, `location`, `date`, `url`, `salary`,
`category`, `department`, `employmentType`, `openings`, `workFromHome` (missing
values are `null`, never omitted).

## Tests

```bash
bun run typecheck     # tsc --noEmit
bun test              # flag-validation + live search/detail smoke tests
```

Live tests hit apna.co; keep volume low. The CLI retries 429/5xx with
exponential backoff and returns `""`/`NOT_FOUND` on 404.
</content>
