# infojobs-cli

CLI for searching jobs through the **official InfoJobs API** (Spain).

**Data source**: `https://api.infojobs.net` (offer list `/api/9/offer`, offer detail `/api/7/offer/{id}`).
**Authentication**: your own InfoJobs developer application, as `INFOJOBS_API_TOKEN=client_id:client_secret`
in the environment. Never a flag, never a file in this repo, never printed.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Not yet verified against the live API** (it needs credentials the author does not have). See
> `../SKILL.md` for the Setup steps and the check to run before enabling the skill.

## Installation

```bash
cd .agents/skills/infojobs-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search offers (`--query`, `--location` (province) and/or `--city` required) |
| `detail` | Fetch full detail for one offer by ID or URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
export INFOJOBS_API_TOKEN="<client_id>:<client_secret>"
bun run src/cli.ts search -q "ingeniero industrial" -l Toledo --jobage 15 --format table
bun run src/cli.ts detail eb371a01c14f97838d790d19d606ce --format plain
```

## Tests

```bash
bun run typecheck
bun test
```

The suite is fully offline (mocked `fetch`, documentation-shaped responses); it never contacts the API
and never needs a real token. Endpoint and field mappings are in `../url-reference.md`.
