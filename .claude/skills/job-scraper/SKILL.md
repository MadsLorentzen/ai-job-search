---
name: job-scraper
description: >
  Searches US job sites and ATS boards for new AI engineering positions matching your profile. Deduplicates across runs.
  Triggers on: job scrape, find jobs, search jobs, new jobs, job search, scrape jobs, /scrape
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Job Scraper

---

## How It Works

This skill searches US job sites and employer ATS boards (LinkedIn, Indeed, Dice, Built In, Wellfound, Greenhouse, Lever, Ashby, Workday, ClearanceJobs, USAJobs) using targeted queries based on the profile, deduplicates against previously seen jobs and the application tracker, and presents new matches with a quick fit assessment.

## Invocation

The user triggers this skill by saying things like:
- "Find new jobs"
- "Scrape for jobs"
- "Any new positions?"
- "/scrape"

Optional arguments:
- A focus area, e.g. "/scrape defense", "/scrape safety", "/scrape startups"
- "broad" to run all search categories, e.g. "/scrape broad"

---

## Execution Steps

### Step 0: Load State

1. Read `job_scraper/seen_jobs.json` (create if missing - start with `{"seen": {}}`)
2. Read `job_search_tracker.csv` to extract already-applied companies+roles
3. Read `search-queries.md` (this directory) for the search strategy

### Step 1: Search

Two search paths, run both:

**1a. LinkedIn via the CLI (preferred for LinkedIn).** Structured output, no WebSearch guesswork:

```bash
cd .agents/skills/linkedin-search/cli
bun run src/cli.ts search -q "AI Engineer" -l "Remote" --jobage 7 --format json
```

Run 2-4 variants across the target titles in `search-queries.md`. Keep the volume low: this uses LinkedIn's public pages and automated access is against their Terms of Service.

**1b. WebSearch for everything else.** Run queries from `search-queries.md`. By default, run the top 3 priority categories. If the user said "broad", run all categories.

If the user specified a focus area (e.g. "defense"), prioritize queries from that category.

For each search:
- Use `WebSearch` with site-specific queries (linkedin.com/jobs, indeed.com, dice.com, builtin.com, boards.greenhouse.io, jobs.lever.co, jobs.ashbyhq.com, etc.)
- Target your configured geographic area
- Look for postings from the last 14 days

### Step 2: Fetch & Parse

For each promising result from Step 1:
- Use `WebFetch` to retrieve the job posting page
- Extract: **job title**, **company**, **location**, **posting date** (or "recent"), **URL**, **key requirements** (brief), **application deadline** (if listed)
- Skip if the URL or company+title combo already exists in `seen_jobs.json`
- Skip if the company+role already appears in `job_search_tracker.csv`

### Step 3: Quick Fit Assessment

For each new job, do a rapid fit check (NOT the full evaluation from `04-job-evaluation.md` - just a quick signal):

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
      "first_seen": "YYYY-MM-DD",
      "fit": "high/medium/low",
      "status": "new/skipped/evaluated"
    }
  }
}
```
2. Only present jobs NOT already in the seen list or tracker.

### Step 5: Present Results

Present new jobs in a table sorted by fit (high first):

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

Prefer the employer ATS link (Greenhouse, Lever, Ashby, Workday) over the aggregator link when both exist, since that is the real application form and the one `/autofill` drives.

After presenting, ask:
> "Want me to evaluate any of these in detail? Just give me the number(s)."

If the user picks a number, invoke the **job-application-assistant** skill workflow (fit evaluation first, then CV + cover letter if approved), then offer `/autofill <url>` to prefill the application.

### Step 6: Update Tracker (Optional)

If the user decides to apply to any job, add a row to `job_search_tracker.csv`.

---

## Important Rules

1. **Never fabricate job postings.** Only present jobs found via actual WebSearch/WebFetch/CLI results.
2. **Respect deduplication.** Always check seen_jobs.json AND job_search_tracker.csv before presenting.
3. **Respect the location and authorization filters** in `search-queries.md`. Apply the authorization rules from search-queries.md exactly as written; work-authorization status changes whether a requirement is a barrier or an advantage.
4. **Only open positions.** Skip postings with expired deadlines or those marked as closed.
5. **Be efficient with WebFetch.** Don't fetch every search result - use titles and snippets to pre-filter before fetching.
6. **Parallel searches.** Use parallel WebSearch calls to speed up the search phase.
7. **Keep LinkedIn CLI volume low.** A handful of queries per run, not hundreds. Automated access is against LinkedIn's Terms of Service and this is personal use only.
8. **Indeed and Dice block direct fetching.** Reach them through WebSearch result snippets rather than WebFetch on the listing page, which will usually return a bot wall.
