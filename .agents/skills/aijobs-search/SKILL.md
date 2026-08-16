---
name: aijobs-search
version: 1.0.0
description: >
  Search aijobs.net — a curated global job board for AI, data science, machine
  learning, data engineering, and analytics roles worldwide (with salary bands).
  Use this whenever the user wants AI/data/ML/analytics jobs, especially remote or
  globally, or wants the full detail of an aijobs.net posting. Trigger phrases:
  "AI jobs", "data science jobs", "machine learning jobs", "ML engineer jobs",
  "data analyst jobs", "data engineering jobs", "BI jobs remote", "analytics jobs",
  "find AI/data jobs", "aijobs.net".
context: fork
allowed-tools: Bash(bun run skills/aijobs-search/cli/src/cli.ts *)
---

# AIJobs.net Search Skill

Search live job listings from **aijobs.net**, a curated global board for **AI, data
science, machine learning, data engineering, and analytics** roles. Server-rendered
public pages — no authentication, no API key, and **zero runtime dependencies** (just
`bun`). aijobs.net is niche/global (not India-specific), and most postings expose a
**salary band**, which this skill captures.

## ⚠️ Personal use only

This reads aijobs.net's public job pages. Their `robots.txt` permits crawling (only
`/account/` is disallowed and no AI/Claude bot is named), but **keep volume low and do
not use it for bulk data collection or commercial scraping.** Run it on your own
responsibility.

## When to use this skill

- Find AI / data science / ML / data-engineering / analytics / BI jobs, globally or remote
- Filter to remote-friendly postings, cap results, or page through listings
- Read the full detail (tasks, skills, salary, apply link) of a specific posting

## Commands

### Search job listings

```bash
bun run skills/aijobs-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Recommended.
- `--location <text>` / `-l <text>` — location text (city/country). aijobs.net is global
  and has **no dedicated location parameter**, so this is folded into the keyword string
  (e.g. `-q "data analyst" -l "India"` searches `data analyst India`). Best-effort.
- `--remote <mode>` — `remote` keeps only remote-friendly postings (client-side, using the
  board's remote flag). `hybrid`/`onsite` are **not supported** (aijobs exposes no such filter).
- `--jobage <days>` — keep only postings from the last N days (client-side; aijobs has no
  server-side age filter — see Notes).
- `--page <n>` — page number (1-indexed, ~50 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run skills/aijobs-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the **slug** from `search` results (e.g. `data-analyst-richardson-tx-us-231820`),
or a full aijobs.net `job/...` URL. A bare numeric id cannot be used — aijobs.net detail
pages require the full slug (which `search` returns as each result's `id`). Returns the
company, salary, level, employment type, apply link, and a structured description
(tasks, perks, skills).

## Usage examples

```bash
# Business intelligence roles, quick scan
bun run skills/aijobs-search/cli/src/cli.ts search -q "business intelligence" --limit 5 --format table

# Data analyst roles biased toward India
bun run skills/aijobs-search/cli/src/cli.ts search -q "data analyst" -l "India" --format table

# Power BI roles, remote only
bun run skills/aijobs-search/cli/src/cli.ts search -q "power bi" --remote remote --format table

# Machine learning jobs posted in the last 7 days
bun run skills/aijobs-search/cli/src/cli.ts search -q "machine learning engineer" --jobage 7 --format table

# Data engineering roles, page 2
bun run skills/aijobs-search/cli/src/cli.ts search -q "data engineer" --page 2 --limit 10

# Full details for a specific job (slug id from search results)
bun run skills/aijobs-search/cli/src/cli.ts detail competitive-coder-remote-200475 --format plain
```

## Output format

Each search result (and detail) is JSON with these fields:

| Field | Meaning |
|-------|---------|
| `id` | Job slug (use with `detail`) |
| `title` | Job title |
| `company` | Company name (`null` on search — aijobs hides it on listings; present on `detail`) |
| `companyUrl` | Company page URL (`detail` only) |
| `location` | Location text (or `Remote`) |
| `date` | ISO date derived from the relative age ("7d ago" → `YYYY-MM-DD`) |
| `url` | Canonical aijobs.net job URL |
| `salary` | Salary band, e.g. `USD 68K-88K` (or `null`) |
| `level` | Experience level, e.g. `Mid-level`, `Senior-level` |
| `employmentType` | e.g. `Full Time`, `Contract`, `Internship` |
| `remote` | `true` if flagged remote-friendly |
| `skills` | Skill tags (search results) |
| `description`, `applyUrl` | `detail` only |

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits `1`.

## Notes

- **Company on listings:** aijobs.net deliberately obscures the company name on search
  cards (shows "O…"), so `company` is `null` in search results. `detail` recovers the real
  name from the `/company/<slug>/` link.
- **Salary:** most postings expose a salary band; captured verbatim (currency varies —
  USD, EUR, GBP, INR, etc.).
- **No JSON API:** the listing UI is server-rendered HTML. aijobs' "Export JSON" button is a
  stateful, CSRF-protected POST tied to a session search context, so this skill parses HTML.
- **Filters are best-effort:** aijobs.net honors only free-text `keyword` and `page` via GET.
  `--location` is folded into the keyword; `--remote remote` and `--jobage` are applied
  client-side to the fetched page. `--remote hybrid/onsite` are unsupported.
- **Featured jobs** are pinned to the top of results regardless of query.
- aijobs.net may rate-limit; the CLI retries 429/5xx with exponential backoff. Keep volume low.
