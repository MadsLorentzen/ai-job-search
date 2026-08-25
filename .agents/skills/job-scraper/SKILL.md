---
name: job-scraper
description: >
  Scrapes Indian job sites (LinkedIn via a local CLI, Naukri/Foundit/Shine/TimesJobs/Instahyre via
  web search) for new positions matching your profile. Deduplicates across runs.
  Triggers on: job scrape, find jobs, search jobs, new jobs, job search, scrape jobs,
  jobs india, naukri, /scrape
---

# Job Scraper

---

## How It Works

This skill searches multiple Indian job sites using targeted queries based on your profile, deduplicates against previously seen jobs and the application tracker, and presents new matches with a quick fit assessment — **Remote (India) roles always presented first**.

Search runs in two lanes:

- **Lane A (structured):** The `linkedin-search` CLI at `.agents/skills/linkedin-search/cli/src/cli.ts` (zero dependencies, run with `bun`, personal-use tool). Returns clean JSON per query.
- **Lane B (web search):** Site-scoped **web search** queries from `search-queries.md` covering **naukri.com**, **foundit.in**, **shine.com**, **timesjobs.com**, and **instahyre.com**. These portals cannot be scraped directly — e.g. Naukri's JSON API requires a JS-generated signed token behind Akamai bot protection and returns HTTP 406 without it — so they are covered through search results instead.

## Location & Priority

Results are ordered by location priority. Remote-India roles are surfaced and presented first wherever ordering applies; city roles follow in this order:

| # | Location | LinkedIn `-l` value |
|---|----------|---------------------|
| 1 | **Remote (India)** | `"Remote"` |
| 2 | Bengaluru | `"Bengaluru, Karnataka, India"` |
| 3 | Hyderabad | `"Hyderabad, Telangana, India"` |
| 4 | Pune | `"Pune, Maharashtra, India"` |
| 5 | Delhi | `"Delhi, India"` |
| 6 | Gurugram | `"Gurugram, Haryana, India"` |

## Invocation

The user triggers this skill by saying things like:
- "Find new jobs"
- "Scrape for jobs"
- "Any new positions?"
- "/scrape"

Optional arguments:
- A focus area, e.g. "/scrape data science" or "/scrape data engineering"
- "broad" to run all search categories, e.g. "/scrape broad"

---

## Execution Steps

### Step 0: Load State

1. Read `job_scraper/seen_jobs.json` (create if missing - start with `{"seen": {}}`)
2. Read `job_search_tracker.csv` to extract already-applied companies+roles
3. Read `search-queries.md` (this directory) for the search strategy

### Step 1: Search

Run both lanes below. By default, use the top 3 priority role categories from `search-queries.md`. If the user said "broad", run all categories. If the user specified a focus area (e.g. "data science"), prioritize that category.

#### Lane A: LinkedIn CLI (structured)

Run the CLI once per role-keyword × location combination from the Location & Priority table above (**always include `-l "Remote"`**):

```bash
bun run .agents/skills/linkedin-search/cli/src/cli.ts search -q "<keywords>" -l "Bengaluru, Karnataka, India" --jobage 14 --limit 20
```

- Parse the JSON output: `{"meta": {"count", "page"}, "results": [{"id", "title", "company", "location", "date", "url"}]}`
- Errors go to stderr as `{"error", "code"}` with exit code 1 — note them and continue
- Use `--format json` (the default); optionally add `--remote remote` for remote-only filtering
- To enrich an individual posting, run `detail <id|url>`
- **Keep total request volume low** (personal-use tool): default runs should stay within ~12 CLI calls (e.g. 2 keywords × 6 locations); even "broad" runs should stay under ~20. Prefer fewer keywords over skipping the Remote location.

#### Lane B: Web Search (Naukri / Foundit / Shine / TimesJobs / Instahyre)

Run the site-scoped **web search** queries from `search-queries.md` (`site:naukri.com`, `site:foundit.in`, `site:shine.com`, `site:timesjobs.com`, `site:instahyre.com`). Remote-India variants of each query run first.

For each lane's results:
- Look for postings from the last 14 days

### Step 2: Fetch & Parse

For each promising result from Step 1:

- Use web fetch to retrieve the job posting page (Lane B hits), or `detail <id>` (Lane A) for enrichment
- Extract: **job title**, **company**, **location**, **posting date** (or "recent"), **URL**, **key requirements** (brief), **application deadline** (if listed)
- **Honest fallback for blocked pages:** Naukri (and occasionally Foundit/Shine/TimesJobs/Instahyre) pages are behind Akamai bot protection and may be blocked or return empty. If web fetch fails or returns nothing usable, take title/company/location/date from the **search snippet metadata** and keep the URL as-is. If a field is not present in the snippet, mark it honestly (e.g. "date unknown") — never guess or invent requirements/deadlines.
- Skip if the URL or company+title combo already exists in `seen_jobs.json`
- Skip if the company+role already appears in `job_search_tracker.csv`

### Step 3: Quick Fit Assessment

For each new job, do a rapid fit check (NOT the full evaluation from `.agents/skills/job-application-assistant/04-job-evaluation.md` - just a quick signal):

- **High match**: Role directly involves your core skills
- **Medium match**: Role is adjacent to your experience
- **Low match**: Role requires significant skills you lack

### Step 4: Deduplicate & Store

1. Add ALL fetched jobs (new and skipped) to `seen_jobs.json` with structure:
```json
{
  "seen": {
    "<url_or_company_title_key>": {
      "title": "...",
      "company": "...",
      "url": "...",
      "location": "...",
      "first_seen": "YYYY-MM-DD",
      "fit": "high/medium/low",
      "status": "new/skipped/evaluated"
    }
  }
}
```
2. Only present jobs NOT already in the seen list or tracker.

### Step 5: Present Results

Present new jobs in a table sorted by fit (high first), with **Remote (India) roles at the top** within each fit tier:

```
## New Job Matches - YYYY-MM-DD

Found X new positions (Y high, Z medium, W low match).

| # | Fit | Title | Company | Location | Deadline | URL |
|---|-----|-------|---------|----------|----------|-----|
| 1 | High | ... | ... | ... | ... | [Link](...) |

### High-Match Highlights
For each high-match job, add 2-3 bullet points:
- Why it matches your profile
- Key requirements to check
- Any red flags
```

After presenting, ask:
> "Want me to evaluate any of these in detail? Just give me the number(s)."

If the user picks a number, invoke the **job-application-assistant** skill workflow (fit evaluation first, then CV + cover letter if approved).

### Step 6: Update Tracker (Optional)

If the user decides to apply to any job, add a row to `job_search_tracker.csv`.

---

## Important Rules

1. **Never fabricate job postings.** Only present jobs found via actual CLI/web search/web fetch results. If portal pages are blocked (Akamai), fall back to snippet metadata and mark unknown fields honestly.
2. **Respect deduplication.** Always check seen_jobs.json AND job_search_tracker.csv before presenting.
3. **Focus on configured locations.** Remote (India) roles are always in scope and come first; on-site jobs must match Bengaluru, Hyderabad, Pune, Delhi, or Gurugram. Skip anything requiring relocation outside these.
4. **Only open positions.** Skip postings with expired deadlines or those marked as closed.
5. **Be efficient with web fetch.** Don't fetch every search result - use titles and snippets to pre-filter before fetching. Blocked fetches get one snippet-based fallback, not retries.
6. **Parallel searches, low volume.** Use subagents (via `invoke_subagent`) or parallel web search calls to speed up Lane B, and parallel CLI calls in Lane A — but keep the total number of requests low; this is a personal-use tool.
