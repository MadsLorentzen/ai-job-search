# instahyre-cli

Search jobs on [Instahyre](https://www.instahyre.com) (India, tech/startup focus)
from the command line. Uses Instahyre's public `job_search` JSON API — no
authentication, **zero runtime dependencies** (plain `bun` + `fetch`).

> Personal use only. Keep request volume low; do not use for commercial or bulk
> data collection.

## Install

```bash
cd .agents/skills/instahyre-search/cli
bun install    # dev types only (TypeScript, @types/bun)
```

## Usage

```bash
# Keyword search (maps to Instahyre's skill filter)
bun run src/cli.ts search -q "backend developer" --format table

# Keyword + city
bun run src/cli.ts search -q "data scientist" -l "Bangalore" --format table

# Paginate (35 results/page) and cap output
bun run src/cli.ts search -q "React" -l "Mumbai" --page 2 --limit 10 --format plain

# Full posting detail (description, employment type, posted date)
bun run src/cli.ts detail 432044 --format plain
bun run src/cli.ts detail https://www.instahyre.com/job-19-sde-1-full-stack-at-instahyre-noida/
```

## Commands & flags

`search`
- `--query`, `-q <text>` — keywords / skill / role (Instahyre skill filter)
- `--location`, `-l <city>` — city filter (Bangalore, Mumbai, Delhi NCR, Pune, …)
- `--jobage <days>` — **unsupported** by the portal (no posting-age filter); ignored
- `--page <n>` — 1-indexed page, 35 results/page (default 1)
- `--limit`, `-n <n>` — client-side cap on emitted results
- `--format <json|table|plain>` — default `json`

At least one of `--query` or `--location` is required.

`detail <id|url>`
- `--format <json|plain>` — default `json`

## Output

`search` JSON:

```json
{ "meta": { "count": 5, "page": 1 }, "results": [
  { "id": "432044", "title": "...", "company": "...", "location": "...",
    "date": null, "url": "https://www.instahyre.com/job-...", "keywords": ["..."] }
]}
```

Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code 1.

## Notes / quirks

- `date` is always `null` in search results — Instahyre's search API carries no
  posting date. The `detail` command does return `datePosted` (from the posting
  page's JobPosting JSON-LD).
- The API's free-text `q=` param is ignored by the server, so `--query` is mapped
  to the `skills=` filter, which is the real keyword filter.
- Server page size is fixed at 35; `--limit` trims client-side.

See `../url-reference.md` for the full endpoint documentation.

## Test

```bash
bun run typecheck
bun run test        # live smoke tests — hits Instahyre; keep volume low
```
