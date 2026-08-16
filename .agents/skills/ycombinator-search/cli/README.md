# ycombinator-cli

Zero-dependency Bun CLI for searching Y Combinator's **Work at a Startup**
(workatastartup.com) public job board.

## Install

```bash
bun install
```

Only dev types are installed (`typescript`, `@types/bun`) — there are **no runtime
dependencies**. Parsing is plain `fetch` + regex extraction of the page's Inertia
`data-page` JSON.

## Usage

```bash
# Search (keyword filter is client-side — see limitations)
bun run src/cli.ts search -q "data analyst" --format table
bun run src/cli.ts search -r science --limit 5 --format table
bun run src/cli.ts search -q "engineer" -l "Remote" --format json

# Detail
bun run src/cli.ts detail 95705 --format plain
```

Run `bun run src/cli.ts` with no command to print full help.

## Commands & flags

- `search`
  - `--query`/`-q <text>` — client-side keyword filter (title/role/company/tagline)
  - `--location`/`-l <text>` — client-side location substring filter
  - `--role`/`-r <slug>` — one of: `software-engineer`, `designer`, `product-manager`,
    `operations`, `sales-manager`, `marketing`, `recruiting`, `science`, `legal`, `finance`
  - `--jobage <days>` — accepted but ignored (portal has no posting dates)
  - `--page <n>` — client-side page (20/page)
  - `--limit`/`-n <n>` — cap results
  - `--format json|table|plain`
- `detail <id|url>` — full posting; `--format json|plain`

## Portal limitations

Work at a Startup exposes **no public keyword-search API and no pagination**. Public
browsing is by role category, each returning a fixed ~25–30 jobs. So:

- `--query`/`--location` fetch **all** role categories and filter the deduped union locally.
- `--page` pages that client-side union.
- Results have **no posting date** (`date` is always `null`); use `companyLastActiveAt`
  as a freshness proxy.

See `../url-reference.md` for endpoints and the response shape.

## Errors

Errors are written to **stderr** as `{"error": "...", "code": "..."}` with exit code 1.
`stdout` carries only successful results.

## Scripts

```bash
bun run typecheck   # tsc --noEmit
bun test            # unit + live network tests (bun test --timeout 30000)
```

The test suite includes live network tests against workatastartup.com; they need
outbound access and keep request volume low.
