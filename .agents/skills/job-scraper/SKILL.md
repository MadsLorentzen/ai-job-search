---
name: job-scraper
description: Find new job opportunities through LinkedIn, Portugal/EU job boards, company career pages, and general web search. Deduplicate results and rank them against the candidate profile. Use when the user asks to find jobs, search jobs, scrape jobs, monitor openings, or invokes $job-scraper.
---

# Job Scraper

## How It Works

Search for open roles using targeted web queries rather than bundled country-specific job-board scripts. Prioritize LinkedIn, company career pages, Portugal-friendly remote/hybrid boards, and reputable job boards relevant to the user's target roles.

## Invocation

The user triggers this skill by saying things like:
- "Find new jobs"
- "Search LinkedIn for roles"
- "Any new positions?"
- "$job-scraper"

Optional arguments:
- A focus area, e.g. "$job-scraper data science" or "$job-scraper product analytics"
- "broad" to run all search categories, e.g. "$job-scraper broad"

## Execution Steps

### Step 0: Load State

1. Read `job_scraper/seen_jobs.json` (create if missing - start with `{"seen": {}}`).
2. Read `job_search_tracker.csv` to extract already-applied companies and roles.
3. Read `.agents/skills/job-scraper/search-queries.md` for the search strategy.

### Step 1: Search

Run web searches from `search-queries.md`. By default, run the top 3 priority categories. If the user said "broad", run all categories.

If the user specified a focus area, prioritize matching queries and create 2-3 additional targeted searches.

For each search:
- Prefer LinkedIn Jobs, company career pages, Wellfound, Otta/Welcome to the Jungle, Landing.jobs, ITJobs.pt, Net-Empregos, Indeed, Glassdoor, and other sites relevant to the role.
- Target Portugal, Lisbon, Porto, Braga, Coimbra, remote Portugal, remote EU, and Europe-friendly remote roles according to the profile.
- Look for postings from the last 14 days when the date is available.

### Step 2: Fetch & Parse

For each promising result:
- Fetch the job posting page when available, or use the search result snippet if the page blocks automated access.
- Extract: **job title**, **company**, **location/remote policy**, **posting date** (or "date unknown"), **URL**, **key requirements**, **salary range in EUR** if listed, and **application deadline** if listed.
- Skip if the URL or company+title combo already exists in `seen_jobs.json`.
- Skip if the company+role already appears in `job_search_tracker.csv`.

### Step 3: Quick Fit Assessment

Do a rapid fit check for each new job:

- **High match**: Role directly uses the candidate's core skills and meets location/remote constraints.
- **Medium match**: Role is adjacent or has manageable gaps.
- **Low match**: Role requires major missing skills, relocation, or poor constraints.

### Step 4: Deduplicate & Store

Add all fetched jobs (new and skipped) to `seen_jobs.json`:

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

Only present jobs that are not already in the seen list or tracker.

### Step 5: Present Results

Present new jobs in a table sorted by fit:

```markdown
## New Job Matches - YYYY-MM-DD

Found X new positions (Y high, Z medium, W low match).

| # | Fit | Title | Company | Location/Remote | Salary | Deadline | URL |
|---|-----|-------|---------|-----------------|--------|----------|-----|
| 1 | High | ... | ... | ... | ... | ... | [Link](...) |
```

For high-match jobs, add 2-3 bullets explaining why the role fits, what to verify, and any red flags.

After presenting, ask:
> "Want me to evaluate any of these in detail? Just give me the number(s)."

If the user picks a number, use `job-application-assistant` or `job-apply` for detailed evaluation and drafting.

## Important Rules

1. Never fabricate job postings. Only present jobs found via real web search/fetch results.
2. Respect deduplication. Always check `seen_jobs.json` and `job_search_tracker.csv`.
3. Focus on the configured location/remote constraints.
4. Prefer jobs that state or plausibly support EUR compensation, Portugal employment, Portugal remote, or EU remote.
5. Skip expired postings and closed roles.
6. Be efficient with fetching; use titles and snippets to pre-filter before opening pages.
