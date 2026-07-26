# free-work-cli

CLI for searching IT jobs and freelance missions on
[Free-Work](https://www.free-work.com) (France) via its public JSON API.

**Zero runtime dependencies** — plain `bun` + `fetch`. `bun install` pulls dev
types only (`typescript`, `@types/bun`), and is optional unless you want
`typecheck` to resolve.

## Setup

```bash
cd .agents/skills/free-work-search/cli
bun install     # optional: dev types only
```

## Usage

```bash
bun run src/cli.ts search -q "backend" -c contractor -l "Ile-de-France" --format table
bun run src/cli.ts search -q "rust" -c contractor --jobage 14 --format plain
bun run src/cli.ts detail <slug|url> --format plain
bun run src/cli.ts --help
```

See `../SKILL.md` for the full flag reference and `../url-reference.md` for API
documentation.

## Scripts

| Script | Purpose |
|---|---|
| `bun run start` | Run the CLI |
| `bun run test` | Test suite (`bun test --timeout 30000`) |
| `bun run typecheck` | `tsc --noEmit` |

## Layout

```
src/
  cli.ts              Arg parsing, flag validation, command dispatch
  helpers.ts          API constants, fetch+backoff, normalizers, HTML→text
  commands/
    search.ts         GET /job_postings, filter, render
    detail.ts         GET /job_postings/{slug}, render
tests/
  helpers.ts                    runCLI + parseJSON utilities
  parsing.test.ts               Pure unit tests, no network
  cli-flag-validation.test.ts   Error paths: JSON on stderr, exit 1
  search.test.ts                Live smoke tests against the real API
```

`search.test.ts` requires network access and assumes Free-Work is carrying
freelance backend missions, which is normally true but makes those tests
inherently environment-dependent. `parsing.test.ts` and
`cli-flag-validation.test.ts` run offline.

## Gotchas

- `detail` takes a **slug**, not a numeric id (`/job_postings/{id}` 404s).
- The keyword parameter is `searchKeywords`; the API silently ignores `query=`.
- There is no server-side date filter, so `--jobage` filters client-side after
  sorting by `order=date`.
