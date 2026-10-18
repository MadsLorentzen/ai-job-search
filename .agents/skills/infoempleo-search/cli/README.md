# infoempleo-cli

CLI for searching jobs on [Infoempleo.com](https://www.infoempleo.com), a Spanish general job board.

**Data source**: Infoempleo's public search pages (`/trabajo/?search=...`) and offer pages
(`/ofertasdetrabajo/.../<id>/`, read from their schema.org `JobPosting` JSON-LD).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Keep volume low, don't use it commercially or for bulk data
> collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/infoempleo-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search listings (`--query` and/or `--location` required) |
| `detail` | Fetch full detail for one offer by numeric ID or URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "ingeniero industrial" -l Toledo --jobage 15 --format table
bun run src/cli.ts search -q "jefe de producción" -l Madrid --format table
bun run src/cli.ts detail 3204839 --format plain
```

## Tests

```bash
bun run typecheck
bun test
```

The suite is fully offline (fixtures and mocked `fetch`); it never contacts the site.
Parsing anchors and endpoint details are in `../url-reference.md`.
