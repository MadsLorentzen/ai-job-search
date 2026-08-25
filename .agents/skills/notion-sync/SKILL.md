---
name: notion-sync
description: >-
  Pushes ranked jobs and application tracker state to a Notion database as a
  glanceable, read-only dashboard. Triggers on: notion sync, sync notion,
  sync to notion, /notion-sync.
---

# /notion-sync - Push Ranked Jobs and Applications to Notion

You are publishing a **read-only view** of the job search into the user's Notion workspace: one database row per job, with a detailed page per shortlisted match. The repo files stay the system of record - `job_scraper/seen_jobs.json` owns scraped/ranked jobs and `job_search_tracker.csv` owns applications. Notion is a disposable presentation layer on top of them; nothing ever syncs back.

Follow these steps **in order**.

---

## Step 0: Parse Input & Preflight

Input may contain `--min-score <N>`, `--all`, or `--rebuild`.
Confirm Notion MCP or API access is available. If not, inform the user gracefully.

---

## Step 1: Build the Sync Set

1. Read `job_scraper/seen_jobs.json` and `job_search_tracker.csv`.
2. Select ranked jobs meeting the threshold (default score ≥ 60) plus every tracked application.
3. If the set is empty, stop.

---

## Step 2: Upsert Database Rows & Detail Pages

- Locate or create the "Job Search Pipeline" database in Notion with properties: Name, Company, Score, Verdict, Status, Deadline, Applied on, Channel, CV file, Cover letter, URL, Key.
- Normalize status values to canonical forms (`drafted`, `applied`, `interview`, `offer`, `hired`, `rejected`, `no_response`, `offer_declined`, `withdrawn`).
- For each item, upsert the row by `Key`. Page bodies are written once upon creation.
- Update `job_scraper/notion_sync.json` with sync metadata.
