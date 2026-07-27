# hellowork-cli

Command-line search for **[HelloWork](https://www.hellowork.com)**, the largest
French generalist job board. Zero runtime dependencies — plain `bun` + `fetch` +
regex parsing. `bun install` pulls dev types only (TypeScript, `@types/bun`),
and is needed solely for `bun run typecheck`; the CLI runs without it.

> ⚠️ **Personal use only.** HelloWork's `robots.txt` disallows the search
> endpoint (`/fr-fr/emploi/recherche.html`, and any URL with a query string) for
> generic user-agents. Detail pages are not disallowed. Keep volume low, no
> commercial or bulk use, own responsibility. See `../SKILL.md`.

## Install

```bash
cd .agents/skills/hellowork-search/cli && bun install && cd ../../../..
```

## Usage

```bash
bun run src/cli.ts search [flags]
bun run src/cli.ts detail <id|url> [--format json|plain]
bun run src/cli.ts --help
```

```bash
# Freelance backend missions in Paris
bun run src/cli.ts search -q "backend" -l "Paris 75000" -c Freelance --format table

# Newest listings across Île-de-France from the last 3 days
bun run src/cli.ts search -q "developpeur" -l "Ile-de-France" -c Freelance --jobage 3 --sort date

# Full description, skills, and TJM of one posting
bun run src/cli.ts detail 81577686 --format plain
```

`--location` needs HelloWork's own form: `"<City> <postcode>"` (`Paris 75000`)
or a region name (`Ile-de-France`). A bare city name returns zero results.

Full flag reference and portal quirks: `../SKILL.md`.
Endpoints and parsing anchors: `../url-reference.md`.

## Layout

| Path | Role |
|---|---|
| `src/cli.ts` | Arg parsing, help text, command dispatch |
| `src/helpers.ts` | Fetch with backoff, card/JSON-LD parsers, date and contract normalisation |
| `src/commands/search.ts` | URL building, client-side age filter, output rendering |
| `src/commands/detail.ts` | Id/URL normalisation, detail rendering |
| `tests/` | Parser unit tests (fixtures), flag validation, and live smoke tests |

## Output contract

`search` emits `{ "meta": { count, page }, "results": [...] }` on stdout, each
result carrying at least `id`, `title`, `company`, `location`, `date`, `url`.
Missing values are `null`, never omitted. Errors go to **stderr** as
`{"error": "...", "code": "..."}` with exit code 1.

## Tests

```bash
bun run test        # bun test --timeout 30000
bun run typecheck   # tsc --noEmit
```

`tests/parsing.test.ts` and `tests/cli-flag-validation.test.ts` are offline.
`tests/search.test.ts` hits HelloWork live — it makes a handful of requests, so
avoid running it in a loop.
