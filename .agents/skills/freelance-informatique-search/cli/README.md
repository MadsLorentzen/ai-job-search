# freelance-informatique-cli

CLI for searching freelance IT missions on
[freelance-informatique.fr](https://www.freelance-informatique.fr) — a French
board where every listing is a freelance mission.

**Zero runtime dependencies.** Plain `bun` + `fetch` + regex parsing; `bun
install` only pulls TypeScript dev types, and the CLI runs fine without it.

## Install (optional — types only)

```bash
bun install
```

## Usage

```bash
bun run src/cli.ts search -q "Node.js" --format table
bun run src/cli.ts search -q "Java" -l idf --jobage 7 --format table
bun run src/cli.ts search -q "Kubernetes" -l remote --format plain
bun run src/cli.ts detail 260728C015 --format plain
bun run src/cli.ts --help
```

`search` maps `--query` to the portal's `competences` parameter (a skills
taxonomy match, not full text) and `--page` to its pagination. `--location` and
`--jobage` are applied **client-side** — the portal's location filter needs an
id from a robots-disallowed endpoint, and it has no date parameter at all.

**Watch `meta.querySkillHits`.** A term outside the portal's taxonomy is
silently widened to a related skill instead of returning nothing: `-q "Rust"`
comes back with seven C++ missions, none tagged Rust. When no result carries the
queried tag the CLI writes a `QUERY_SUBSTITUTED` warning to stderr, and
`--strict` drops those rows.

`detail` accepts a bare mission reference, a path, or a full URL: the portal
301-redirects `/mission-<anything>-<REF>` to the canonical page, so the slug is
never needed.

## Output

`--format json` (default) emits `{ meta, results }` per the repo's portal-skill
contract; missing values are `null`, never omitted. Errors go to stderr as
`{"error", "code"}` with exit code 1.

Two fields are always `null` because the portal does not publish them:
`dailyRate` (no TJM anywhere on the site) and `company` (clients are
anonymised). For daily rates, use `free-work-search`.

## Tests

```bash
bun run test        # 30 tests
bun run typecheck
```

`tests/parsing.test.ts` runs offline against fixtures covering both card link
flavours, the five posting-date wordings, entity decoding and the client-side
filters. `tests/search.test.ts` is a live smoke test against the real portal —
a handful of requests, asserting on shape rather than on specific missions.

See `../url-reference.md` for the endpoint and markup documentation.
