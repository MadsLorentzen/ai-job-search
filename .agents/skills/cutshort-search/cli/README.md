# cutshort-cli

Zero-dependency Bun CLI for searching public job postings on **CutShort** (cutshort.io),
an India tech/startup hiring platform. Part of the `cutshort-search` skill.

## Install

```bash
cd .agents/skills/cutshort-search/cli
bun install
```

## Usage

```bash
# Search (default JSON output)
bun run src/cli.ts search -q "data analyst" -l "Bangalore" --limit 5

# Human-readable table
bun run src/cli.ts search -q "business intelligence" -l "Pune" --format table

# Full detail of one posting
bun run src/cli.ts detail arcRXEzK --format plain
```

See `../SKILL.md` for the full flag reference and `../url-reference.md` for the data sources.

## Scripts

- `bun run start` — run the CLI
- `bun run typecheck` — `tsc --noEmit`
- `bun run test` — live tests against cutshort.io (network required)

## Data sources

Public, robots-allowed surfaces only: the jobs sitemap (`sitemap_jobs.xml`) for search and
public `/job/<id>` pages for detail. CutShort's login-gated profile-matching search API is
**not** used. **Personal use only — keep volume low.**
