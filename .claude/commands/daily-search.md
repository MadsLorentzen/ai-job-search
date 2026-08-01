# /daily-search - Daily Job Search Pipeline

You are running the full daily job-search pipeline end to end, unattended. This command exists so the user (or a scheduled cron agent) can trigger the whole loop with one call instead of running `/scrape`, `/rank`, `/html-report`, and `/notion-sync` separately.

Each step is a normal invocation of the existing command/skill - this file adds no new scoring, ranking, or sync logic of its own. It only sequences them and reports one combined summary.

Follow these steps **in order**. Do not skip a step because a prior step found nothing - later steps are idempotent and safe to run on an unchanged state (they say so themselves and exit cleanly).

---

## Step 1: Scrape

Invoke the `job-scraper` skill (equivalent to running `/scrape` with no arguments) to find and dedupe new postings across every installed portal CLI (`linkedin-search`, `remoteok-search`, `weworkremotely-search`, `freehire-search`, the Danish CLIs) plus the WebSearch fallback queries in `.claude/skills/job-scraper/search-queries.md`.

Record: how many new postings were found, and whether `/scrape health` flagged any portal as degraded (surface degraded-portal warnings in the final report - don't silently swallow them).

---

## Step 2: Rank

Run `/rank` (no arguments - rank every job with status `new`). This scores fresh postings against `04-job-evaluation.md` and updates `job_scraper/seen_jobs.json` in place.

If Step 1 found zero new postings, still run this step - there may be previously-scraped, not-yet-ranked jobs from a prior partial run.

Record: how many were ranked, the shortlist (score ≥ 60 / Good Fit and above), and anything excluded by the location veto.

---

## Step 3: HTML Report

Run `/html-report` to regenerate the local dashboard from the now-current `seen_jobs.json` and `job_search_tracker.csv`. This is local-only (no network/auth dependency) and safe to run every time regardless of whether anything changed upstream.

Record: the report file path.

---

## Step 4: Notion Sync

Run `/notion-sync` (no arguments - default score ≥ 60 threshold) to push the ranked shortlist and tracked applications to Notion.

This step is **silently optional** per its own design: if the Notion MCP server isn't connected or isn't authenticable, `/notion-sync` exits with one line and no side effects. Do not treat that as a pipeline failure - report it as a skipped step, once, and continue. Never attempt to start an OAuth flow from this command.

---

## Step 5: Combined Report

Present one summary, not four separate ones:

```
## Daily Job Search Pipeline - YYYY-MM-DD

**Scrape:** <N> new postings found across <P> portals (<list any degraded portals, or "all healthy">)
**Rank:** <N> ranked (<X> shortlisted, <Y> below threshold, <Z> expired/vetoed)
**Report:** regenerated at <path>
**Notion:** synced <N> rows (<C> created, <U> updated) — or "skipped: Notion MCP not connected (run /mcp to connect)"

### Today's Shortlist (score >= 60)
| Score | Verdict | Title | Company | Location | Deadline | URL |
|-------|---------|-------|---------|----------|----------|-----|
...
```

If every step found nothing new (zero scraped, zero ranked), say so plainly in one line instead of printing empty tables: "Nothing new today - checked <P> portals, no fresh postings, dashboard/Notion left unchanged."

---

## Important Rules

1. **No new judgment logic here.** Scoring, ranking, veto rules, and sync rules all belong to their own commands/skills (`04-job-evaluation.md`, `/rank`, `/notion-sync`) - this command only sequences them and must not re-derive or override their output.
2. **Never stop the pipeline on an optional step's graceful skip.** Only a hard failure (e.g. `/rank` erroring because `seen_jobs.json` is corrupt) should halt the sequence early; report it clearly rather than silently continuing past a real error.
3. **Idempotent by construction.** Because every step it calls is itself idempotent, running `/daily-search` multiple times in a day (or after a partial failure) is always safe - already-ranked jobs are skipped, already-synced Notion rows are updated not duplicated.
4. **Unattended-safe.** This command is designed to also run from a scheduled cron agent with no human watching - never block on a question the user isn't there to answer (e.g. don't ask "want to apply to any of these?" the way `/rank` does interactively; just report the shortlist). When run interactively by the user, the shortlist Q&A from `/rank`'s Step 5 can still happen naturally at the end.
