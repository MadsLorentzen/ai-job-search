---
name: indeed-search
version: 1.0.0
description: >
  Use this skill to search live Indeed job listings (ie.indeed.com and other
  Indeed country sites) through the Apify actor misceres/indeed-scraper - the
  only automated route to Indeed, whose own pages refuse scripted access. This
  fork uses it for Dublin, Ireland. Trigger phrases: search Indeed, Indeed jobs,
  jobs on Indeed, Indeed Ireland, find jobs in Dublin on Indeed, Indeed jobs
  posted this week.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/indeed-search/cli/src/cli.ts *)
---

# Indeed Search Skill

Searches Indeed by running the Apify actor **misceres/indeed-scraper** on ordinary Indeed
search URLs (`ie.indeed.com/jobs?q=...&l=Dublin&fromage=7`) and reading back the results.
This CLI never requests Indeed itself. Zero runtime dependencies - it runs with just `bun`.

## ⚠️ Personal use only

Indeed blocks automated access, and its terms do not allow scraping. The actor gets past
that protection with residential proxies. The user chose this route knowingly for a
personal job search. Keep volume low: a handful of searches per `/scrape` run, never
bulk collection, never commercial use.

## Setup (required - every run is billed)

1. Create an Apify account and copy the personal API token (Settings → API & Integrations).
2. Export it, outside the repo:

   ```bash
   echo 'export APIFY_API_TOKEN="<your token>"' >> ~/.zshenv
   ```

The CLI reads the token **only** from `APIFY_API_TOKEN`. Without it, it exits 1 with
`MISSING_CREDENTIALS`.

**Cost:** the actor charges per job saved (from about $3 per 1,000 jobs, checked 2026-10-15),
plus a tiny start fee per run. All `;`-separated searches share **one** run. Every run
carries a hard spend cap (`--max-charge`, default $1.00): Apify stops the run when the cap
is reached. Example: 9 titles × 20 jobs = up to 180 jobs ≈ $0.54.

## Command

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "<keywords>[;<keywords>...]" [flags]
```

- `--query`, `-q <text>` - **required.** Separate several searches with `;` (max 20).
- `--location`, `-l <text>` - Indeed location, e.g. `Dublin`.
- `--country <code>` - Indeed site. Default `ie`.
- `--jobage <days>` - Indeed's own `fromage` filter, plus an exact client-side trim. Undated results ("30+ days ago" has no exact date) are kept and flagged by `/scrape`.
- `--limit`, `-n <n>` - jobs per search, default 20, max 100. **This is what you pay for.**
- `--max-charge <usd>` - hard spend cap for the run, default 1.00.
- `--no-description` - drop descriptions from the output (same cost).
- `--broad` - plain keyword search. **Default is an exact job-title phrase** (`title:"data engineer"`): Indeed's keyword search is loose (a live "data engineer" search in Dublin returned a Quality Manager, a sales intern and data-centre construction roles), and every returned job is billed.
- `--format json|table|plain` - default `json`.

There is **no `detail` command**: results already include the full description, and a run
per job would be billed again. `detail` exits 1 with `DETAIL_UNSUPPORTED`.

Runs take 30 seconds to a few minutes (the actor drives a browser).

## Usage examples (Dublin)

```bash
# One title, last 7 days
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "data engineer" -l "Dublin" --jobage 7 --format table

# The /scrape default: several titles in one run, capped
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "data engineer;analytics engineer;data quality analyst;etl tester;qa engineer;test automation engineer;software test engineer;data analyst;bi analyst" -l "Dublin" --jobage 7 -n 20 --max-charge 1

# Cheap check
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "qa analyst" -l "Dublin" --jobage 3 -n 5 --max-charge 0.10
```

## Output

`{ "meta": { "count", "page", "queries" }, "results": [...] }`. Each result:

| Field | Meaning |
|---|---|
| `id` | Indeed job key |
| `title`, `company`, `location` | as on Indeed; `null` when missing |
| `date` | `YYYY-MM-DD`, from the actor's parsed date or Indeed's "N days ago" label; `null` for "30+ days ago" |
| `url` | the Indeed posting (for the user to open in a browser) |
| `applyUrl` | the employer's own apply link when Indeed redirects to one - use it for verification |
| `salary`, `jobType`, `description` | as published |

Expired postings are dropped. Errors go to stderr as `{ "error", "code" }`, exit 1. Codes:
`MISSING_CREDENTIALS`, `BAD_CREDENTIALS`, `QUOTA_EXCEEDED`, `TIMEOUT`, `REQUEST_FAILED`,
`DETAIL_UNSUPPORTED`, `UNKNOWN_FLAG`, `NO_QUERY`, `BAD_ARG`.

## Notes for /scrape

- **Run once per `/scrape`,** with every target title joined by `;`, not one run per title.
- **Verify on the employer's site.** `applyUrl` is usually the employer's own posting: fetch it to confirm the role is live and store **that** URL in `seen_jobs.json`. If there is none (Indeed "Easily apply" jobs), find the role on the employer's careers site independently. Agency postings have no employer site; say so, as for other agency ads.
- **Never fetch `ie.indeed.com` URLs** from WebFetch or curl - only the actor touches Indeed.
- `description` is the full text, so contact extraction (`tools/extract_contacts.py --text-file`) works on it directly.
- The actor is third-party: if a run starts returning nothing for queries that worked before, check its changelog on Apify (the date filter on start URLs broke and was fixed on 2026-09-22).
