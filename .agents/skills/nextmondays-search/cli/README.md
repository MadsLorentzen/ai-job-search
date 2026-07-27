# nextmondays-cli

CLI for searching freelance tech missions in France on
[Next Mondays](https://nextmondays.com).

**Zero runtime dependencies** — plain `bun` + `fetch` + regex parsing. `bun install` only
pulls dev types for `tsc`; the CLI itself runs on a fresh clone with nothing but `bun`.

## Install

```bash
cd .agents/skills/nextmondays-search/cli && bun install
```

Optional — only needed for `bun run typecheck`.

## Usage

```bash
bun run src/cli.ts search -q "typescript" --format table
bun run src/cli.ts search -q "node backend" --tjm-min 550 --format table
bun run src/cli.ts search -t react -l Paris --format table
bun run src/cli.ts search -g "web & edition" --jobage 90 --format table
bun run src/cli.ts detail 03P712386 --format plain
bun run src/cli.ts --help
```

## Commands

| Command | Purpose |
|---------|---------|
| `search` | List missions, filtered client-side by keyword / tag / domain / rate / city / age |
| `detail <id\|url>` | Full brief for one mission |

Flags are documented in `--help` and in [`../SKILL.md`](../SKILL.md).

## Output contract

- Search stdout: `{ "meta": { "count", "page", "pageSize", "matched", "boardSize", "source", "query", "enriched", "enrichTruncated" }, "results": [...] }`
- Each result always includes `id`, `title`, `company`, `location`, `date`, `url` — missing
  values are `null`, never omitted.
- `company` is **always `null`**: Next Mondays is a placement intermediary and never names
  the end client. The anonymised blurb is in `clientProfile`.
- Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## robots.txt

`nextmondays.com` disallows `/Search`. This CLI never requests it — it reads the allowed
`/jobs/regions/*`, `/jobs/groups/*`, and `/jobs/tags/*` listing pages and filters keywords
client-side. See [`../url-reference.md`](../url-reference.md).

## Tests

```bash
bun run test        # live smoke tests against the portal
bun run typecheck
```

Tests hit the live site (a handful of requests). If they fail on parsing rather than
network, the markup anchors in `src/helpers.ts` and `../url-reference.md` are the place
to look.
