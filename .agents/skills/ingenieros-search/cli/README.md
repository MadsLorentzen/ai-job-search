# ingenieros-cli

CLI for the [Ingenieros.es](https://www.ingenieros.es/bolsa_de_trabajo) engineering job board (Spain).

**Data source**: the board's public latest-offers listing and offer pages.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Keep volume low, don't use it commercially or for bulk data
> collection, and run it on your own responsibility.

The board is small: `search` reads its single front-page listing (usually under ten offers) and
filters it client-side. See `../SKILL.md` for what that means in practice.

## Installation

```bash
cd .agents/skills/ingenieros-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | List and filter the latest offers (`--query`, `--location`, `--jobage`) |
| `detail` | Fetch full detail for one offer by numeric ID or URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search --format table
bun run src/cli.ts search -q "proyectos industriales" -l Valencia --format table
bun run src/cli.ts detail 3509 --format plain
```

## Tests

```bash
bun run typecheck
bun test
```

The suite is fully offline (fixtures and mocked `fetch`); it never contacts the site.
Parsing anchors are in `../url-reference.md`.
