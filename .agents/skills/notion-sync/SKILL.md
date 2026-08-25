---
name: notion-sync
description: >-
  Pushes ranked jobs and application tracker state to a Notion database as a
  glanceable, read-only dashboard. Triggers on: notion sync, sync notion,
  sync to notion, /notion-sync.
---

# /notion-sync - Push Ranked Jobs and Applications to a Notion Database

You are publishing a **read-only view** of the job search into the user's Notion workspace: one database row per job, with a detailed page per shortlisted match. The repo files stay the system of record - `job_scraper/seen_jobs.json` owns scraped/ranked jobs and `job_search_tracker.csv` owns applications. Notion is a disposable presentation layer on top of them; nothing ever syncs back.

This command requires the **Notion MCP server** (OAuth) or equivalent integration. It reads state, upserts pages, and stops - it never ranks, applies, or edits repo files.

## Lane: `/html-report` vs `/notion-sync`

Both present the same tracker data; they own different moments. `/html-report` is the **deep-review lane**: a self-contained offline dashboard with charts and a filterable table. `/notion-sync` is the **glanceable lane**: current pipeline state reachable anywhere Notion runs (desktop, web, phone).

Follow these steps **in order**.

---

## Step 0: Parse Input

Input may contain:

- Nothing → sync ranked jobs with score ≥ 60 (Good Fit and above) plus every tracked application
- `--min-score <N>` → override the score threshold
- `--all` → sync every ranked job regardless of score
- `--rebuild` → re-fetch and rewrite page bodies too (normally bodies are write-once)

---

## Step 1: Preflight the Connection

1. Check that Notion tools/integration are available.
2. Verify connection with one cheap call.
3. If not connected/configured, exit gracefully with clear setup instructions.

---

## Step 2: Build the Sync Set

1. Read `job_scraper/seen_jobs.json` and `job_search_tracker.csv`.
2. Select `seen_jobs.json` entries with status `ranked` whose `rank_score` meets the threshold.
3. Every tracker row joins the sync set (an applied-to job always syncs, ranked or not).
4. **Status precedence:** the tracker wins. A job that is `ranked` in `seen_jobs.json` but `interview` in the tracker syncs as `interview`.
5. **Deadline precedence:** the tracker wins too.
6. If sync set is empty, stop. State counts before touching the destination.

---

## Step 3: Load Sync State and Locate the Database

1. Read `job_scraper/notion_sync.json` (`{ "database_id": "...", "database_url": "...", "last_sync": "YYYY-MM-DD" }`).
2. Search workspace for database named "Job Search Pipeline". If none exists, create it with properties:

| Property | Type | Values / notes |
|----------|------|----------------|
| Name | title | `<Role> — <Company>` |
| Company | rich text | |
| Score | number | 0-100 from `rank_score` |
| Verdict | select | Strong Fit / Good Fit / Moderate Fit / Weak Fit / Poor Fit |
| Status | select | `ranked` / `drafted` / `applied` / `interview` / `offer` / `hired` / `rejected` / `no_response` / `offer_declined` / `withdrawn` / `expired` |
| Fit | select | high / medium / low (scraper quick-fit) |
| Deadline | date | tracker `deadline` column, fallback to `seen_jobs.json` |
| First seen | date | |
| Ranked | date | `rank_date` |
| Applied on | date | tracker `date` column |
| Channel | select | tracker `channel` column |
| CV file | rich text | tracker `cv_file` column |
| Cover letter | rich text | tracker `cover_letter_file` column |
| URL | url | posting URL |
| Key | rich text | dedup anchor in `seen_jobs.json` |

3. Write `job_scraper/notion_sync.json` with database ID and URL.

---

## Step 4: Upsert Database Rows

For each job in the sync set:

1. Query database for page where `Key` equals job key.
2. **No match** → create page with all properties, then write body (Step 5).
3. **Match** → update properties only. Do not touch page body (bodies belong to the user after creation).
4. Never delete or archive pages.
5. Normalise Status value before writing (map legacy spaces to `no_response` / `offer_declined`).

---

## Step 5: Write the Detail Page (new pages only)

1. **Fit summary** - score, verdict, quick-fit, dates, submitted file names.
2. **The posting** - WebFetch job URL (retrying 403 with browser headers per `09-web-research.md`) and write readable digest of requirements, location, deadline.
3. **Links** - posting URL, local archive path name.

---

## Step 6: Report

```
## Pipeline Sync - YYYY-MM-DD

Database: <database_url>
Synced <N> jobs (threshold: score ≥ <T>): <C> created, <U> updated, <S> unchanged.
```

---

## Important Rules

1. **One-way, always.** Destination content never flows back into repo files.
2. **Idempotent upsert on `Key`.**
3. **Page bodies are write-once.**
4. **Never fabricate.**
5. **Job data only.** Profile files never sync.
6. **Documents never leave the machine.** CVs and cover letters sync as filenames only.
