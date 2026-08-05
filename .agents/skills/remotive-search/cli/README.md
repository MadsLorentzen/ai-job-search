# remotive-cli

CLI for searching [Remotive](https://remotive.com)'s curated remote-jobs feed.
Zero runtime dependencies — plain `bun` + `fetch`.

## ⚠️ Personal use only

Remotive's API carries an explicit legal notice: credit Remotive and link back, do
not republish listings to third-party job sites, and do not use the feed to collect
signups. Free-tier listings are delayed 24h. See `../SKILL.md` for the full text.

## Install

```bash
bun install   # dev types only (typescript, @types/bun)
```

## Usage

```bash
bun run src/cli.ts search --category "Software Development" --format table
bun run src/cli.ts detail 1749306 --format plain
```

Run `bun run src/cli.ts --help` for the full flag list.

## Everything is client-side

The free feed holds only ~32 jobs and ignores all documented filter parameters
(verified — see `../url-reference.md`). The CLI fetches the feed once and filters
locally. There is also no per-job endpoint, so `detail` selects out of the feed.

## Tests

```bash
bun run typecheck
bun test
```

Offline suite — pure-function parsing tests plus flag validation that exits before
any network call.
