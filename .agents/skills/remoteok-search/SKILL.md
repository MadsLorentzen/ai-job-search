---
name: remoteok-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for remote job listings on
  RemoteOK, or look up a specific RemoteOK job posting. Invoke for open remote
  positions and hiring across any sector or role (software, data, design,
  marketing, finance, legal, operations, etc.). Trigger phrases: remote jobs,
  remote job search, RemoteOK, search RemoteOK, remote openings, remote
  positions, "are there any remote X jobs", look up this RemoteOK job posting.
context: fork
allowed-tools: Bash(bun run skills/remoteok-search/cli/src/cli.ts *)
---

# RemoteOK Search Skill

Search live job listings from RemoteOK's public JSON API. All listings are remote by
definition. No authentication, no API key, and **zero runtime dependencies** — it runs
with just `bun`.

## When to use this skill

- Search for fully-remote job openings by keyword
- Optionally narrow by a location/region hint (e.g. "Europe", "US", "worldwide")
- Get the full description of a specific job listing

## Commands

### Search job listings

```bash
bun run skills/remoteok-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search across title, company, tags, and description.
- `--location <text>` / `-l <text>` — optional substring filter on the posting's location
  hint (e.g. `"Europe"`, `"US"`, `"Worldwide"`). Omit, or pass `"remote"`/`"anywhere"`, for
  all postings — RemoteOK is remote-only, so this is a narrowing filter, not a requirement.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run skills/remoteok-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `1134704`). You may also pass a
full `remoteok.com/remote-jobs/...` URL. Returns the full description, tags, salary
range (if listed), and apply link.

## Usage examples

```bash
# Data engineer roles, any region
bun run skills/remoteok-search/cli/src/cli.ts search -q "data engineer" --format table

# Designer roles, Europe-hinted only
bun run skills/remoteok-search/cli/src/cli.ts search -q "designer" -l "Europe" --format table

# Full details for a specific job
bun run skills/remoteok-search/cli/src/cli.ts detail 1134704 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from RemoteOK's public `remoteok.com/api` endpoint — no credentials required.
- The API always returns the ~100 most recent live postings; there is no server-side
  search or pagination, so `search` fetches once and filters client-side. `detail` looks
  up the ID within that same live set, so very old job IDs may return `NOT_FOUND`.
- Location/tag/salary data is only as complete as what the poster supplied — many
  postings have `location: ""` or no salary range.
