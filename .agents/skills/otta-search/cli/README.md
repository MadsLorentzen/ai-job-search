# otta-cli

Zero-dependency CLI for searching jobs on **Otta / Welcome to the Jungle** (`otta.com` now
redirects to `welcometothejungle.com`). Runs on [Bun](https://bun.sh) — no runtime
dependencies, only dev types.

> **Personal use only.** Uses Welcome to the Jungle's public job data; keep volume low and do
> not use commercially or for bulk collection. See `../SKILL.md`.

## Setup

```bash
cd .agents/skills/otta-search/cli
bun install        # dev types only (typescript, @types/bun)
bun run typecheck
```

## Usage

```bash
# Search
bun run src/cli.ts search -q "data analyst" -l India --format table
bun run src/cli.ts search -q "data engineer" --remote remote --jobage 14 --limit 10

# Detail (id from search results, or a full job URL)
bun run src/cli.ts detail 4051077 --format plain
```

See `bun run src/cli.ts` (no args) for full help.

## How it works

- **Search** hits the public Algolia index `wk_cms_jobs_production` (the same one the WTTJ
  website queries client-side). No account or personal API key required.
- **Detail** hits the site's public REST API (`api.welcometothejungle.com`), because the HTML
  job pages sit behind an anti-bot challenge.
- Both use a browser User-Agent and retry `429`/`5xx` with exponential backoff + jitter.

No HTML scraping is needed — both sources return JSON — so there is no parsing library. See
`../url-reference.md` for endpoints, parameters, and maintenance notes (e.g. what to do if the
public Algolia key rotates).

## Tests

```bash
bun run test        # bun test --timeout 30000
```

`tests/cli-flag-validation.test.ts` covers flag parsing / error codes (offline, no network).
