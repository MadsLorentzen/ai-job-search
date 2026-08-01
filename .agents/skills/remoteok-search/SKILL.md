---
name: remoteok-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for fully remote jobs
  worldwide, find remote job listings, or look up a specific remote job
  posting on RemoteOK. Invoke for remote openings, remote vacancies, and
  remote hiring across any sector or role (software, design, marketing,
  ops, etc.). Trigger phrases: find a remote job, remote job search, search
  for remote jobs, remote openings, remote vacancies, remote hiring,
  fully remote positions, work from anywhere jobs, "are there any remote X
  jobs", look up this RemoteOK posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/remoteok-search/cli/src/cli.ts *)
---

# RemoteOK Search Skill

Search live, fully-remote job listings from RemoteOK's public JSON feed. No
authentication, no API key, and **zero runtime dependencies** — it runs with
just `bun`.

RemoteOK's `robots.txt` carries an explicit AI/LLM-crawler section (see
`url-reference.md`) that names `ClaudeBot`, `anthropic-ai`, and `Claude-Web`
with `Allow: /` for public job listings, and its API response embeds its own
attribution terms rather than forbidding automated use — this is a
publicly-documented, intentionally-consumable data source, not a scrape
against the site's wishes. Keep volume reasonable and credit RemoteOK as the
source if this data is used beyond personal job search.

## When to use this skill

- Search for fully-remote job openings in any sector or role
- Filter by recency (posted in the last N days) or a location hint (most
  postings are unrestricted/worldwide; some name a specific country/region)
- Get the full description of a specific RemoteOK job listing

## Commands

### Search job listings

```bash
bun run .agents/skills/remoteok-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). The first word also
  narrows RemoteOK's own `tags` filter server-side; the full phrase is then matched
  client-side against title/company/tags.
- `--location <text>` / `-l <text>` — client-side substring match. Use `remote` or `worldwide`
  to match postings with no specific location (most of them).
- `--jobage <days>` — posted within N days. Omit for all postings in the feed.
- `--page <n>` — page number (1-indexed, 20 results per page, paginated client-side over the feed).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/remoteok-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `1135691`). You may also pass a
full `remoteok.com/remote-jobs/...` URL. Returns the full description, tags, salary
range (when disclosed), and apply link.

## Usage examples

```bash
# Backend roles, posted in the last 14 days
bun run .agents/skills/remoteok-search/cli/src/cli.ts search -q "backend" --jobage 14 --format table

# Node.js roles, remote/worldwide only
bun run .agents/skills/remoteok-search/cli/src/cli.ts search -q "nodejs" -l remote --format table

# Payments/fintech-flavored search
bun run .agents/skills/remoteok-search/cli/src/cli.ts search -q "payments engineer" --format table

# Full detail for a specific job
bun run .agents/skills/remoteok-search/cli/src/cli.ts detail 1135691 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from RemoteOK's public `/api` JSON feed — no credentials required.
- The feed returns a snapshot of the ~100 most recent postings; there is no true
  server-side pagination or historical archive. `search --page 2` paginates
  client-side over that same snapshot.
- RemoteOK does not support true multi-tag or free-text search server-side, so this
  CLI sends only the first query word as a `tags` filter and does the rest of the
  matching (full phrase, location, job age) client-side after fetching the feed.
- `detail` on an ID that has aged out of the recent feed falls back to fetching the
  job's own page directly (a bare numeric ID 301-redirects to the full slug URL).
- Every listing worldwide with no specific country named is effectively remote-first
  by RemoteOK's own premise — `--location` narrows further only when a posting names
  a specific place.
