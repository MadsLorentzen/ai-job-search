---
name: jobgether-search
version: 1.0.0
description: >
  Use this skill to search live remote job listings from jobgether.com, a global,
  English-language remote-first job aggregator, or to look up a specific posting.
  Every listing is remote/remote-first/hybrid by default; location filters narrow
  by country, continent, or city rather than requiring one. Trigger phrases: find a
  remote job, remote job search, jobgether, remote work, work from home jobs,
  fully remote positions, "are there any remote <role> jobs", look up this
  jobgether posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jobgether-search/cli/src/cli.ts *)
---

# jobgether Search Skill

Search live job listings from **[jobgether.com](https://jobgether.com)**, a global
remote-jobs aggregator — no authentication, no API key, and **zero runtime
dependencies**, just `bun`. Location is a filter, not a requirement: every listing
on the platform is remote, remote-first, or hybrid, so this skill works for any
market out of the box.

> This is a country-agnostic worked example of the repo's job-portal-skill pattern,
> like `linkedin-search` and `freehire-search`. Search queries jobgether's own
> `/api/v1/jobs` REST API — a JSON endpoint the site documents and publishes
> explicitly **for AI agents/assistants** (see `robots.txt`'s
> `Content-Signal: ai-input=yes` and the `/astroapi/ai/jobs/docs` reference) — so
> results are structured, not parsed from markup.

## ⚠️ `detail` is WAF-blocked by default (search is not)

The search API works fine with an honest, tool-identifying User-Agent. The HTML
offer page that `detail` needs (there is no JSON endpoint for a single posting) does
not: jobgether's Cloudflare WAF returns **403** to the CLI's honest UA on every
`/offer/...` URL, while a full browser UA gets 200 on the identical page.
`robots.txt` does **not** disallow this path (verified with `tools/robots_check.py`
→ `ALLOWED`) — this is a WAF default, not a declined policy — so it is exactly the
case `.claude/skills/job-application-assistant/09-web-research.md` covers. Per this
repo's portal-skill contract, the CLI does not spoof a browser UA by default: it
reports the 403 as `FORBIDDEN` and points at that file's manual retry procedure
(`tools/robots_check.py`, then `curl` with browser headers). The underlying
parser (JSON-LD extraction) was verified working end-to-end against a real,
live-fetched offer page obtained that way — description, employment type,
deadline, and the real ATS apply link all extracted cleanly. See
`url-reference.md` for the full writeup.

In practice: use `search` freely for triage (it already returns title, company,
location, remote mode, contract type, experience level, salary range, and posting
date). Reach for `detail` only when you actually need the full description or
apply link for one shortlisted posting, and expect to run the manual escalation
for it.

## When to use this skill

- Search for remote job openings by keyword, location (country/continent/city),
  job function, industry, contract type, experience level, or salary range
- Filter to fully-remote vs. remote-first vs. hybrid, and optionally include
  hybrid roles alongside remote ones
- Sort by relevance or posting date; narrow to postings from the last N days
- Get the full description, employment type, deadline, and apply link for one
  specific posting (subject to the WAF caveat above)

## Commands

### Search job listings

```bash
bun run .agents/skills/jobgether-search/cli/src/cli.ts search [-q "<keywords>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, company, contract type). Optional.
- `--location <slugs>` / `-l <slugs>` — country/continent/city slugs, comma-separated, e.g. `"spain,europe"` or `"worldwide"`. An unknown slug is a 400 from the API, not a silent no-op.
- `--job-function <slugs>` — job-function slugs, comma-separated, e.g. `"product-manager"`.
- `--industry <slugs>` — industry slugs or ids, comma-separated.
- `--contract-type <types>` — `full-time` \| `part-time` \| `fixed-term` \| `freelance` \| `internships` (comma-separated for OR).
- `--experience <levels>` — `entry-level-graduate` \| `junior-1-2-years` \| `mid-level-2-5-years` \| `senior-5-10-years` \| `expert-10-years`.
- `--remote <mode>` — `full-remote` \| `remote-first` \| `hybrid`.
- `--include-hybrid` — also include hybrid roles alongside remote ones.
- `--salary-min <n>` / `--salary-max <n>` / `--currency <code>` — annual salary filter, e.g. `--salary-min 60000 --currency EUR`.
- `--sort <mode>` — `relevance` (default) \| `date`.
- `--jobage <days>` — posted within N days. **Client-side filter** (the API has no such parameter) applied to the fetched page only — combine with `--sort date` to see the freshest postings first, and re-page if you need more.
- `--page <n>` — 1-indexed. Capped at 10 by the API.
- `--limit <n>` / `-n <n>` — results per page. Default 10, capped at 25 by the API.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/jobgether-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is a search result's `id` (e.g. `6aaf5383865119c687d03d66`). You may also pass
the full `https://jobgether.com/offer/<id>-<slug>` URL. Returns the full
description, employment type, deadline, and the real (external ATS) apply link —
when the WAF allows the fetch through; see the caveat above.

## Usage examples

```bash
# Product manager roles, Spain or Europe, fully remote
bun run .agents/skills/jobgether-search/cli/src/cli.ts search -q "product manager" -l "spain,europe" --remote full-remote --format table

# Senior engineering roles, most recent first
bun run .agents/skills/jobgether-search/cli/src/cli.ts search -q "engineer" --experience senior-5-10-years --sort date --format table

# Freelance design roles paying at least €50k
bun run .agents/skills/jobgether-search/cli/src/cli.ts search -q "designer" --contract-type freelance --salary-min 50000 --currency EUR --format table

# Anywhere in the world, remote or hybrid
bun run .agents/skills/jobgether-search/cli/src/cli.ts search -q "data analyst" -l "worldwide" --include-hybrid --format table

# Posted in the last 2 days, freshest first
bun run .agents/skills/jobgether-search/cli/src/cli.ts search -q "product manager" --jobage 2 --sort date --format plain

# Full detail for a specific job
bun run .agents/skills/jobgether-search/cli/src/cli.ts detail 6aaf5383865119c687d03d66 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "hasMore" }, "results": [...] }`; each
result carries at least `id`, `title`, `company`, `location`, `date`, `url` (missing
values are `null`), plus `remote`, `contractType`, `experience`, `salaryRange`, and
`jobFunctions`. All errors are written to **stderr** as `{ "error": "...", "code":
"..." }` and the process exits with code `1`.

## Notes

- Data is from jobgether.com's public `/api/v1/jobs` API — no credentials required.
  `search` does not hardcode `contractType`/`experience`/`remoteType`/`sort` enums
  client-side; it passes the value straight through and surfaces the API's own 400
  error (message + allowed values) if it's wrong, so the CLI never drifts from the
  API's own vocabulary. `locations` and `job-function` are open taxonomies — an
  unrecognized slug is likewise a 400 from the API, not a silent no-op.
- The API retries 429/5xx (including the documented 504 "search budget exceeded")
  with exponential backoff, max 6 attempts.
- `id` in search results is the jobgether job id — pass it as-is to `detail`.
- See `url-reference.md` for the full endpoint reference, including the WAF
  writeup and the JSON-LD structure `detail` parses.
