# greenhouse-cli

CLI for searching a company's [Greenhouse](https://www.greenhouse.io) job board via
the public Job Board API. Zero runtime dependencies — plain `bun` + `fetch`.

## Install

```bash
bun install   # dev types only (typescript, @types/bun)
```

## Usage

```bash
bun run src/cli.ts search -c stripe -q "engineer" -l "Remote" --format table
bun run src/cli.ts detail 8089353 --company stripe --format plain
```

Run `bun run src/cli.ts --help` for the full flag list.

## `--company` is required

Greenhouse has no cross-company search — the API is scoped to one board token at a
time. Pass a comma-separated list to sweep several employers in one call. `--query`,
`--location` and `--jobage` are all client-side filters; see `../url-reference.md`.

## Tests

```bash
bun run typecheck
bun test
```

Offline suite — pure-function parsing tests plus flag validation that exits before
any network call, matching the repo's CI policy on live portal requests.
