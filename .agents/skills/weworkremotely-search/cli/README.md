# weworkremotely-cli

CLI for searching [We Work Remotely](https://weworkremotely.com) via its public RSS
feeds. Zero runtime dependencies — plain `bun` + `fetch` + regex parsing (no XML
library needed; the feed is shallow and each `<item>` is parsed independently).

## Install

```bash
bun install   # dev types only (typescript, @types/bun)
```

## Usage

```bash
bun run src/cli.ts search --category remote-programming-jobs --format table
bun run src/cli.ts detail stripe-backend-engineer-ai-security --category programming --format plain
```

Run `bun run src/cli.ts --help` for the full flag list and the category slugs.

## `--category` is the only server-side filter

Each category has its own RSS feed, so `--category` genuinely narrows the source.
`--query`, `--region` and `--jobage` are client-side — RSS takes no parameters.

Each feed is a fixed-size recent window (~100 items), not a paginated archive.
There is no per-job endpoint, so `detail` scans feeds for the slug — pass
`--category` to check one feed instead of nine.

## Tests

```bash
bun run typecheck
bun test
```

Offline suite — pure-function parsing over an inline RSS fixture, plus flag
validation that exits before any network call.
