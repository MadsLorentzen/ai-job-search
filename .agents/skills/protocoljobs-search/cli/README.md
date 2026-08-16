# protocoljobs-cli

Zero-dependency CLI for searching **Protocol Jobs** (protocoljobs.ai), an India-focused
aggregator of tech and tech-adjacent white-collar roles. Runs on `bun` using the site's
public JSON API (`api.protocoljobs.ai`) — no auth, no API key, no runtime dependencies
(only dev types: `typescript`, `@types/bun`).

> **Personal use only.** Public endpoints, permissive robots.txt, but no published API
> agreement — keep volume low, no commercial/bulk use.

## Install

```bash
cd .agents/skills/protocoljobs-search/cli
bun install
```

## Usage

```bash
# Search
bun run src/cli.ts search -q "data analyst" -l "Bengaluru" --format table
bun run src/cli.ts search -d data -l "Remote" --jobage 7 --limit 10

# Detail
bun run src/cli.ts detail 6a58c47643dd50bdf47b3309 --format plain
```

### Search flags

| Flag | Alias | Meaning |
|------|-------|---------|
| `--query` | `-q` | Free-text keyword (matches job title) |
| `--location` | `-l` | City or mode (Bengaluru, Mumbai, Pune, Delhi NCR, Gurugram, Noida, Hyderabad, Chennai, Kolkata, Ahmedabad, Remote, Hybrid) |
| `--domain` | `-d` | data, ml/ai, backend, frontend, fullstack, qa, devops, cloud, mobile, product, design, pm |
| `--jobage` | | Posted within N days (bucketed: 2/3/7/14/28) |
| `--page` | | 1-indexed page (20/page; walks the cursor) |
| `--limit` | `-n` | Cap results / page size (max 100) |
| `--format` | | `json` (default), `table`, `plain` |

## Output

Search JSON: `{ "meta": { "count", "page", "total", "hasMore" }, "results": [ ... ] }`.
Each result has `id, title, company, location, date, url` plus `workplaceType, domain,
experienceBands, experience, salary, competition, shortlisting, companyTier, source`;
missing values are `null`. Errors go to **stderr** as `{ "error", "code" }` with exit 1.

## Scripts

```bash
bun run typecheck   # tsc --noEmit
bun run test        # bun test --timeout 30000 (includes live API smoke tests)
```

## How it works

Protocol's authenticated search (`/api/jobs/search`) is login-gated, so the CLI uses the
public `/api/featured-jobs` endpoint, which accepts the same `{ filters, page }` body and
is backed by the full listing database. Responses are JSON (no HTML scraping); only the
detail `description` field is HTML and is tag-stripped / entity-decoded. See
`../url-reference.md` for the full API contract.
