# /generate-csv - Scrape, Rank, and Export Today's Jobs to CSV

`/generate-csv` chains `/scrape` and `/rank` and then writes the result to a CSV file, so
the daily job-hunt check is one command and one file to open - not a chat table to scroll
back through. It does not replace `/scrape` or `/rank` for ad-hoc use; it runs their exact
logic back-to-back and adds a file-export step neither of them has today.

Follow these steps **in order**.

---

## Step 0: Parse Input

`$ARGUMENTS` may contain:

- Nothing → scrape the top 3 priority categories (same default as `/scrape`)
- `broad` → scrape all search categories (same as `/scrape broad`)
- A focus area (e.g. `/generate-csv data science`) → scrape and rank only that focus

---

## Step 1: Scrape

Run `.claude/skills/job-scraper/SKILL.md` Steps 0-4 exactly (load state, search, fetch &
parse, quick fit assessment, dedupe & store into `job_scraper/seen_jobs.json` with
`status: "new"`). Skip that skill's Step 5 presentation table - this command's own Step 4
below is the single presentation point, and skip Step 6 (tracker update stays manual,
same as `/scrape`).

If no new jobs were found, say so, then continue to Step 2 anyway - there may still be
jobs from a prior run sitting at `status: "new"` (e.g. an earlier interrupted run) worth
ranking and exporting.

---

## Step 2: Rank

Run `.claude/commands/rank.md` Steps 1-4 exactly, with no `--all` flag - i.e. score only
jobs with `status: "new"` (the batch Step 1 just produced, plus any leftover unranked
jobs from before), using the same parallel-agent WebFetch + `04-job-evaluation.md`
scoring. Write the same `rank_score`, `rank_verdict`, `rank_date`, `rank_deadline`,
`rank_location`, `rank_strengths`, `rank_gaps`, `rank_language` fields back into
`job_scraper/seen_jobs.json`, setting `status: "ranked"` or `status: "expired"` exactly as
`/rank` does. Skip that command's own Step 5 presentation - Step 4 below covers it.

If there is nothing to rank (no `status: "new"` jobs at all), say so and continue to Step
3 anyway - only relevant if the CSV should still be produced from ranked-today entries.

---

## Step 3: Export CSV

1. Ensure the directory `job_scraper/exports/` exists (create it if missing).
2. Select every entry in `job_scraper/seen_jobs.json` where `first_seen` equals today's
   date OR `rank_date` equals today's date - this is "today's batch": everything this run
   just scraped and/or ranked. Do not include older entries even if they are still
   `status: "new"` or `"ranked"` from a previous day.
3. Sort selected entries by `rank_score` descending. Entries with no `rank_score` (e.g.
   `status: "expired"`, or ranking didn't run) sort after all scored entries, in their
   original discovery order.
4. Write `job_scraper/exports/jobs_YYYY-MM-DD.csv` (today's date; overwrite if it already
   exists - a same-day re-run replaces, never appends) with the header row:
   ```
   date,company,title,location,fit,rank_score,rank_verdict,rank_deadline,status,source,url
   ```
   One row per selected entry, values read straight from the matching `seen_jobs.json`
   fields of the same name (`date` is the posting date already stored on the entry, not
   today's run date - do not conflate the two). Leave a field empty if the entry has no
   value for it (e.g. `rank_score` on an expired job).
5. Quote any field containing a comma, double quote, or newline per RFC 4180 (job titles
   and company names routinely contain commas, e.g. "Business Analyst, IoT" - test this
   deliberately, don't assume it won't come up). Write the file with the `Write` tool,
   the same way every other file in this repo is authored - no shell scripting needed for
   this.

---

## Step 4: Present

Print a short summary, not a full table (the CSV is the detailed view now):

```
## Job Export - YYYY-MM-DD

Scraped <N> new postings, ranked <R> (<S> shortlisted, <E> expired/vetoed).
Full results: job_scraper/exports/jobs_YYYY-MM-DD.csv

Top 3:
1. <Score> <Verdict> - <Title> at <Company> (<Location>)
2. ...
3. ...
```

Then: "Open the CSV for the full list, or give me a number to run `/apply` on."

---

## Important Rules

1. **Reuse, don't reimplement.** Steps 1 and 2 are the existing `/scrape` and `/rank`
   logic verbatim - if either of those change, this command inherits the change rather
   than drifting out of sync.
2. **`seen_jobs.json` stays the single source of truth.** This command must not write any
   field to `seen_jobs.json` that `/scrape` or `/rank` wouldn't otherwise write. The CSV
   is a derived view, never the record of state.
3. **The tracker is untouched.** Same as `/scrape` and `/rank`: `job_search_tracker.csv`
   is read-only here.
4. **One file per day.** Re-running `/generate-csv` the same day overwrites that day's
   CSV rather than creating a second file - there is one authoritative export per date.
5. **No fabricated rows.** Every CSV row must trace back to an actual `seen_jobs.json`
   entry populated by Steps 1-2 in this run; never invent postings to fill the file.
