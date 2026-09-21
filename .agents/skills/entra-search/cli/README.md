# entra-cli

CLI for searching [ENTRA](https://entracareers.com) — verified AI & tech jobs
ingested straight from company hiring systems (Greenhouse, Lever, Ashby, …) across
many countries — via its public JSON API.

**Data source**: ENTRA REST API (`/api/jobs`, `/api/jobs/{id}`, `/api/companies`).
**Authentication**: None required — reads are public.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Hosted-service dependency.** This skill talks to entracareers.com. If the API is
> unreachable the CLI exits non-zero with a clear error rather than hanging, so an
> outage degrades gracefully instead of breaking the caller. Point `ENTRA_API_URL`
> at a staging instance to swap the source.

## Installation

```bash
cd .agents/skills/entra-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search jobs by keyword and filters |
| `detail` | Fetch full detail for a single job by its id or URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "machine learning engineer" --remote --limit 10 --format table
bun run src/cli.ts search -q "product manager" -l "United States" --experience 3_6_years --format table
bun run src/cli.ts search --company spacex --jobage 14 --sort salary --format table
bun run src/cli.ts detail 25b71e5a-db28-43a2-84c0-1c7df875a547 --format plain
```

See `../SKILL.md` for the full flag reference and `../url-reference.md` for the API.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skills / company). Full-text; optional. |
| `--location` | `-l` | Client-side substring filter on `"City, Country"`. |
| `--remote` | | `remote` (bare) \| `hybrid` \| `office` (`onsite` alias). |
| `--experience` | | `no_experience` \| `1_3_years` \| `3_6_years` \| `6_plus_years`. |
| `--employment` | | `full_time` \| `part_time` \| `contract` \| `freelance` \| `internship`. |
| `--specialization` | | Specialization slug(s), comma = OR. |
| `--company` | | Company slug or name (resolved via `/companies`). |
| `--salary-min` | | Stated minimum salary ≥ n (postings without a salary are excluded). |
| `--jobage` | | Posted within N days (client-side). |
| `--sort` | | `date` (default) \| `salary`. |
| `--page` | | 1-indexed page. Default 1. |
| `--limit` | `-n` | Results per page, 1–100. Default 25. |
| `--no-description` | | Drop description bodies. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun run typecheck
bun test            # offline: mocked fetch + flag validation
```
