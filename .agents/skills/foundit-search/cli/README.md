# foundit-cli

Read job postings from **Foundit** (formerly Monster India) — **detail-only**,
zero runtime dependencies (`bun` + `fetch` + regex/JSON parsing).

## Why detail-only?

Foundit has no robots-allowed, bot-accessible search surface:

- Its keyword/location search JSON API lives under `/middleware/`, which
  `robots.txt` **disallows**.
- Its HTML `/search/...` pages return **HTTP 403** to non-browser clients
  (Akamai bot protection) and carry no job data server-side anyway.

Individual job pages (`/job/<slug>-<id>`) are robots-**allowed** and server-render
a complete schema.org `JobPosting` block, so `detail` works cleanly. See
`../url-reference.md`.

## Install

```bash
cd .agents/skills/foundit-search/cli && bun install
```

`bun install` pulls only dev types (`typescript`, `@types/bun`).

## Usage

```bash
# By numeric id
bun run src/cli.ts detail 57203413 --format plain

# By full URL
bun run src/cli.ts detail "https://www.foundit.in/job/software-development-specialist-ntt-data-pune-57203413"

# search is unsupported — exits 1 with a JSON error pointing to the detail workflow
bun run src/cli.ts search -q "data analyst"   # -> {"error":"...","code":"SEARCH_UNSUPPORTED"}
```

## Output

- `json` (default): a single object with `id`, `title`, `company`, `location`,
  `date`, `url`, `description`, `employmentType`, `deadline`,
  `experienceMonths`, `category`, `industry`, `skills`, `applyUrl`.
- `plain`: human-readable text.

Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Test

```bash
bun run typecheck
bun run test        # live: pulls a fresh job id from the today's-jobs sitemap
```
