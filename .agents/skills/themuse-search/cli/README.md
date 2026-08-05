# themuse-cli

CLI for searching jobs on [The Muse](https://www.themuse.com) via its public API.
Zero runtime dependencies — plain `bun` + `fetch`.

## Install

```bash
bun install   # dev types only (typescript, @types/bun)
```

## Usage

```bash
bun run src/cli.ts search --category "Software Engineering" -l "Remote" --format table
bun run src/cli.ts detail 21675716 --format plain
```

Run `bun run src/cli.ts --help` for the full flag list.

## Important: `--query` is client-side

The Muse's public API has no free-text search parameter (verified — see
`../url-reference.md`). `--query` filters over title and company **after** fetching,
across a bounded page sweep controlled by `--pages`. Always narrow with the
server-side `--category` and `--location` first.

## Tests

```bash
bun run typecheck
bun test
```

The suite is **offline** — pure-function parsing tests plus flag validation that
exits before any network call. This matches the repo's CI policy of not making live
portal requests. Live verification is a local, on-demand step.
