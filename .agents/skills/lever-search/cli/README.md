# lever-cli

CLI for searching a company's [Lever](https://www.lever.co) job postings via the
public postings API. Zero runtime dependencies — plain `bun` + `fetch`.

## Install

```bash
bun install   # dev types only (typescript, @types/bun)
```

## Usage

```bash
bun run src/cli.ts search -c palantir -q "engineer" --format table
bun run src/cli.ts detail https://jobs.lever.co/palantir/<uuid> --format plain
```

Run `bun run src/cli.ts --help` for the full flag list.

## `--company` is required

Lever has no cross-company search — the API is scoped to one site slug at a time.
Pass a comma-separated list to sweep several employers in one call.

`--team` and `--commitment` are server-side (exact match). `--query`, `--location`,
`--remote` and `--jobage` are client-side; see `../url-reference.md` for why
location in particular is not delegated to the API.

## Tests

```bash
bun run typecheck
bun test
```

Offline suite — pure-function parsing tests plus flag validation that exits before
any network call.
