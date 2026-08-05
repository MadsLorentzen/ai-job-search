---
name: weworkremotely-search
version: 1.0.0
description: >
  Use this skill to search We Work Remotely, one of the largest remote-only job
  boards, covering programming, devops, design, product, customer support, sales
  and marketing. Good for fully-remote roles at companies that hire globally or
  US-only. Complements themuse-search (broader, includes on-site) and
  remotive-search (smaller remote feed). Trigger phrases: remote jobs, work from
  home jobs, fully remote roles, remote-only, distributed team jobs, WWR, we work
  remotely, remote programming jobs, remote design jobs.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/weworkremotely-search/cli/src/cli.ts *)
---

# We Work Remotely Search Skill

Search [We Work Remotely](https://weworkremotely.com) via its **public RSS feeds**.
No authentication, no API key, and **zero runtime dependencies**.

Of the remote boards in this fork, this is the more substantial one — and it is the
only portal here with **real server-side filtering**: each category has its own feed,
so `--category` genuinely narrows the source rather than filtering after the fact.

## Commands

### Search job listings

```bash
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--category <slug>` — **server-side.** Picks a narrower feed. Valid slugs:
  `remote-programming-jobs`, `remote-design-jobs`, `remote-devops-sysadmin-jobs`,
  `remote-customer-support-jobs`, `remote-sales-and-marketing-jobs`,
  `remote-product-jobs`, `remote-management-and-finance-jobs`,
  `all-other-remote-jobs`. Short forms work too: `programming`, `design`.
  An unrecognized category is a hard error, not a silent fall back to all jobs.
- `--query <text>` / `-q <text>` — client-side keyword filter over title, company and skills.
- `--region <text>` / `-l <text>` — client-side eligibility filter. `"USA"` matches both `"USA Only"` and `"Anywhere in the World"` listings, since the latter accept US candidates.
- `--jobage <days>` — posted within N days.
- `--page <n>` — 1-indexed page, 25 results per page.
- `--limit <n>` / `-n <n>` — cap results emitted.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts detail <id|url> [--category <slug>] [--format json|plain]
```

`id` is the URL slug from `search` results (e.g. `stripe-backend-engineer-ai-security`);
a full WWR posting URL works too.

**WWR has no per-job API.** Descriptions ship inside the RSS, so `detail` locates the
posting by scanning feeds. **Pass `--category` when you know it** — that checks one
feed instead of sweeping all nine.

## Usage examples

```bash
# Programming roles (server-side category feed)
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search --category remote-programming-jobs --format table

# Senior programming roles, short-form category
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search --category programming -q "senior" --format table

# Anything open to US candidates, last 7 days
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -l "USA" --jobage 7 --format table

# Devops roles
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search --category remote-devops-sysadmin-jobs --format table

# Full details (scoped to one feed — faster)
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts detail stripe-backend-engineer-ai-security --category programming --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, includes `meta.feedSize` and the feed URL |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **Each RSS feed is a fixed-size recent window (~100 items), not a paginated archive.** Older postings drop out entirely, so `--page 5` will be empty and a `detail` lookup on an aged-out job returns `NOT_FOUND`. That is the source's behaviour, not a breakage — open the URL directly for old postings.
- **The employer is encoded in the RSS `<title>` as `"Company: Job Title"`.** The parser splits on the **first** colon only, so job titles containing further colons ("Engineer: Platform") and company names containing commas ("Gusto, Inc.") both survive intact.
- **Two location fields.** `<region>` is the broad eligibility string (`"Anywhere in the World"`, `"USA Only"`); `<country>` is more specific when present. The contract `location` field prefers `country`, and `--region` matches against both.
- `<description>` is double-escaped HTML. Entities are decoded with `&amp;` handled **last**, so double-escaped markup survives a single pass rather than being over-decoded.
- Some titles carry emoji from the employer's own posting; those render as-is.
- `meta.feedSize` reports how many items the feed held, so a caller can tell a narrow filter from an exhausted window.
