# indeed-cli

CLI for searching jobs on Indeed Spain (`es.indeed.com`). **Search only** — Indeed's `robots.txt`
disallows posting pages, so `detail` never fetches anything.

**Data source**: the JSON Indeed embeds in its public search results page.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Automated access is against Indeed's Terms of Service. Keep volume low, space
> requests out (a burst gets a 403, reported as `BLOCKED`), don't use it commercially or for bulk data
> collection, and run it on your own responsibility.

Indeed refuses Bun's HTTP client with a 403, so the CLI repeats a refused request once through the
system `curl` (same headers, same honest User-Agent). `curl` must be on the `PATH`.

## Installation

```bash
cd .agents/skills/indeed-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search listings (`--query` and/or `--location` required; `--page` 1–10) |
| `detail` | Validates the job key, then exits 1 with `DETAIL_UNAVAILABLE` (by design) |

`search` accepts `--format json|table|plain` (default `json`).
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "ingeniero industrial" -l Toledo --jobage 14 --format table
bun run src/cli.ts search -q "jefe de producción" -l Madrid --format table
```

## Tests

```bash
bun run typecheck
bun test
```

The suite is fully offline (fixtures and mocked `fetch`); it never contacts the site.
Parsing anchors and the robots.txt rules this CLI respects are in `../url-reference.md`.
