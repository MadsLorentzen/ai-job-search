---
name: protocoljobs-search
version: 1.0.0
description: >
  Use this skill to search jobs on Protocol Jobs (protocoljobs.ai), an
  India-focused job platform that aggregates tech and tech-adjacent white-collar
  roles (software, data/analytics, ML/AI, product, design, DevOps/cloud, QA,
  project/program management) pulled directly from company career pages and ATS
  systems (Greenhouse, Lever, Workday, SmartRecruiters, Ashby). Best for roles in
  Indian tech hubs — Bengaluru, Mumbai, Pune, Delhi NCR, Gurugram, Hyderabad,
  Chennai — and remote-in-India positions. Trigger phrases: "find data analyst
  jobs in Bengaluru", "protocol jobs", "tech jobs in India", "remote data jobs
  India", "look up this protocoljobs listing", search/openings/vacancies/hiring
  for tech roles in India.
context: fork
allowed-tools: Bash(bun run skills/protocoljobs-search/cli/src/cli.ts *)
---

# Protocol Jobs Search Skill

Search live job listings from **Protocol Jobs** (protocoljobs.ai), an India-focused
career platform that aggregates **tech and tech-adjacent white-collar roles** from
1000+ company career pages and ATS platforms (Greenhouse, Lever, Workday,
SmartRecruiters, Ashby). Runs on the site's public JSON API with **zero runtime
dependencies** — just `bun`.

> **Niche:** India tech/knowledge-work jobs. Domains covered: Product, Frontend,
> Backend, Fullstack, QA, DevOps, Cloud, ML/AI, Data, Mobile, Design, and
> Project/Program Management. It is **not** a general/blue-collar board, and its
> location taxonomy is Indian cities plus Remote/Hybrid.

## ⚠️ Personal use only

This uses Protocol Jobs' public API endpoints. robots.txt permits crawling and no
auth is required for these endpoints, but there is no published API agreement, so
**keep volume low and do not use it commercially or for bulk data collection.** Run
it on your own responsibility.

## When to use this skill

- Search tech/data/product roles in Indian cities or remote-in-India
- Filter by domain (data, ml/ai, backend, …), recency, or location
- Get the full description of a specific Protocol Jobs listing

## Commands

### Search job listings

```bash
bun run skills/protocoljobs-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — free-text keyword (job title/skill/role), e.g. `"data analyst"`, `"power bi"`.
- `--location <text>` / `-l <text>` — city or mode. Recognised: `Bengaluru`, `Mumbai`, `Pune`, `Delhi NCR`, `Gurugram`, `Noida`, `Hyderabad`, `Chennai`, `Kolkata`, `Ahmedabad`, `Remote`, `Hybrid`, `Tier 1`. Free-text like `"Bengaluru, Karnataka, India"` is matched to the right code.
- `--domain <text>` / `-d <text>` — `data`, `ml`/`ai`, `backend`, `frontend`, `fullstack`, `qa`, `devops`, `cloud`, `mobile`, `product`, `design`, `pm`.
- `--jobage <days>` — posted within N days, mapped to the nearest bucket (2, 3, 7, 14, or 28 days). Omit for all postings.
- `--page <n>` — 1-indexed page (20 results/page). Higher pages walk the API cursor (one request per page).
- `--limit <n>` / `-n <n>` — cap results emitted / page size (client-side, max 100).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run skills/protocoljobs-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the 24-char hex job id from `search` results (e.g. `6a58c47643dd50bdf47b3309`).
A full `/api/jobs/details/...` URL also works. Returns the full description, domain,
experience band, salary band, and Protocol's competition/shortlisting signals.
(The apply/career-page URL is only present on `search` results, not on `detail`.)

## Usage examples

```bash
# Data analyst roles in Bengaluru
bun run skills/protocoljobs-search/cli/src/cli.ts search -q "data analyst" -l "Bengaluru" --format table

# Power BI roles posted in the last 7 days, remote
bun run skills/protocoljobs-search/cli/src/cli.ts search -q "power bi" -l "Remote" --jobage 7 --format table

# All Data-domain roles in Pune, first 10
bun run skills/protocoljobs-search/cli/src/cli.ts search -d data -l "Pune" --limit 10 --format table

# Analytics roles in Gurugram, page 2
bun run skills/protocoljobs-search/cli/src/cli.ts search -q "analytics" -l "Gurugram" --page 2 --format table

# ML/AI roles, any location
bun run skills/protocoljobs-search/cli/src/cli.ts search -d ml -q "machine learning" --limit 15

# Full details for a specific job
bun run skills/protocoljobs-search/cli/src/cli.ts detail 6a58c47643dd50bdf47b3309 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail`. Includes `meta.total` and `meta.hasMore`. |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON search output shape:

```json
{ "meta": { "count": 5, "page": 1, "total": 976, "hasMore": true }, "results": [ ... ] }
```

Each result carries `id`, `title`, `company`, `location`, `date`, `url`, plus
`workplaceType`, `domain`, `experienceBands`, `experience`, `salary` (LPA band),
`competition`, `shortlisting`, `companyTier`, and `source`. Missing values are
`null`, never omitted.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- **Public endpoint used:** the app's authenticated keyword search (`/api/jobs/search`) is login-gated (401). This skill instead uses `/api/featured-jobs`, which is public, requires no auth, and is backed by the **full listing database** (~19k roles at time of writing) accepting the same `{ filters, page }` body.
- **Free-text query** (`--query`) maps to the API's `filters.keyword` and matches against the job title.
- **Pagination is cursor-based.** `--page N` fetches pages 1..N sequentially, following the API cursor; page size is 20 (or your `--limit`).
- **`--jobage` is bucketed**, not an exact-days filter — it maps to Protocol's `jobFreshness` buckets (last 48h / 72h / 1wk / 2wk / 4wk).
- **Salary/experience** are Indian LPA and years bands when the source provides them; otherwise `null`.
- The API may rate-limit; the CLI retries 429/5xx with exponential backoff. Keep volume low (see personal-use note above).
