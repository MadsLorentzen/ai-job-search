# jobgether-cli

CLI for searching **jobgether.com**, a global, English-language remote-jobs
aggregator — no authentication, any market (location is a filter, not a
requirement, since every listing is remote/remote-first/hybrid by default).

**Data source**: jobgether's own `/api/v1/jobs` REST API, documented at
`/astroapi/ai/jobs/docs` and published explicitly for AI agents/assistants.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **`detail` is WAF-blocked by default.** `search` works fine with the CLI's honest
> User-Agent; the HTML offer page `detail` needs does not (Cloudflare returns 403 to
> non-browser UAs there, even though `robots.txt` allows the path). The CLI reports
> this as a `FORBIDDEN` error rather than silently spoofing a browser — see
> `../url-reference.md` and `../SKILL.md` for the full writeup and the manual retry
> procedure.

## Installation

```bash
cd .agents/skills/jobgether-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job listing (subject to the WAF caveat above) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Product manager roles, Spain or Europe, fully remote
bun run src/cli.ts search -q "product manager" -l "spain,europe" --remote full-remote --format table

# Senior engineering roles, most recent first
bun run src/cli.ts search -q "engineer" --experience senior-5-10-years --sort date --format table

# Freelance design roles paying at least €50k
bun run src/cli.ts search -q "designer" --contract-type freelance --salary-min 50000 --currency EUR

# Full detail for one job
bun run src/cli.ts detail 6aaf5383865119c687d03d66 --format plain
```

See `../SKILL.md` for the full flag reference and usage examples.

## Search flags

| Flag | Alias | Description |
|------|-------|--------------|
| `--query` | `-q` | Keywords (title / skill / company / contract type). |
| `--location` | `-l` | Country/continent/city slugs, comma-separated, e.g. `"spain,europe"`. |
| `--job-function` | | Job-function slugs, comma-separated. |
| `--industry` | | Industry slugs or ids, comma-separated. |
| `--contract-type` | | `full-time` \| `part-time` \| `fixed-term` \| `freelance` \| `internships`. |
| `--experience` | | `entry-level-graduate` \| `junior-1-2-years` \| `mid-level-2-5-years` \| `senior-5-10-years` \| `expert-10-years`. |
| `--remote` | | `full-remote` \| `remote-first` \| `hybrid`. |
| `--include-hybrid` | | Also include hybrid roles. |
| `--salary-min` / `--salary-max` / `--currency` | | Annual salary filter. |
| `--sort` | | `relevance` (default) \| `date`. |
| `--jobage` | | Posted within N days — client-side filter (no server param exists). |
| `--page` | | 1-indexed page. Capped at 10 by the API. |
| `--limit` | `-n` | Results per page. Default 10, capped at 25. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun run typecheck
bun run test
```

`tests/parsing.test.ts` is a pure unit test of the JSON-LD detail parser (offline,
using a captured fixture). `tests/smoke.test.ts` hits the live API: a real search,
plus flag-validation error paths. There is no live `detail` smoke test — the WAF
caveat above means it deterministically 403s in CI; the parser is instead verified
by the offline fixture test.
