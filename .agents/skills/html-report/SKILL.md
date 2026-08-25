---
name: html-report
description: >-
  Generates a self-contained, interactive HTML dashboard visualizing job search
  metrics, status breakdowns, conversion funnels, and filterable application
  tables. Triggers on: html report, generate dashboard, dashboard, analytics
  report, /html-report.
---

# /html-report - Self-Contained HTML Job Search Dashboard

You are generating a **single-file, self-contained, interactive HTML report** of the job search. The file lands at `documents/reports/job_search_report_YYYY-MM-DD.html`. It is zero-dependency: opens in any browser, runs without a server, works completely offline, and contains no external CDN links or network calls.

The report presents the facts already recorded in `job_search_tracker.csv`, `documents/applications/*/outcome.md`, and `job_scraper/seen_jobs.json`.

Follow these steps **in order**.

---

## Step 0: Parse Input

Input may contain:

- Nothing → generate report into `documents/reports/job_search_report_YYYY-MM-DD.html`
- `--open` → generate and immediately open in default browser (`open documents/reports/...`)
- `--since <YYYY-MM-DD>` → filter metrics to applications on or after date

---

## Step 1: Load State

1. Read `job_search_tracker.csv`. If missing or 0 data rows, tell user there is no application data yet and stop.
2. Read all `outcome.md` files under `documents/applications/*/outcome.md` if present.
3. Read `job_scraper/seen_jobs.json` for top-of-funnel discovery metrics.

---

## Step 2: Compute Metrics & Aggregations

1. **Pipeline Overview**:
   - Total applications
   - Active / in-progress
   - Interview rate (% applications reaching at least one interview stage)
   - Offer rate
   - Response rate (% not ending in `no_response`)
   - Average days to first response

2. **Status Breakdown**:
   - Count by canonical status (`drafted`, `applied`, `interview`, `offer`, `hired`, `rejected`, `no_response`, `offer_declined`, `withdrawn`)

3. **Conversion Funnel**:
   - Applied → Phone Screen → Technical/Deep Dive → Final Round → Offer → Hired

4. **Time Series & Cohorts**:
   - Applications per week/month
   - Channel breakdown (referral, portal, direct/online)

---

## Step 3: Generate Self-Contained HTML File

Generate a beautifully styled, self-contained dashboard.

### Design Standards
- Dark / Modern clean UI (slate background `#0f172a`, card background `#1e293b`, accents `#3b82f6`, `#10b981`, `#f59e0b`, `#ef4444`).
- Modern typography using clean system font stack (`system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`).
- SVG or pure CSS bar charts / funnel charts (zero external JS dependencies).
- Interactive vanilla JS table with:
  - Instant live search/filtering across company, role, channel, status
  - Column sorting (by date, company, fit rating, status)
  - Status filter pill buttons
- Fully responsive layout for desktop and tablet viewing.

### Report File Output Path
`documents/reports/job_search_report_YYYY-MM-DD.html`

Ensure parent directory `documents/reports/` exists.

---

## Step 4: Validate and Present

1. Verify file size and content integrity.
2. If `--open` flag was passed, run `open documents/reports/job_search_report_YYYY-MM-DD.html`.
3. Present summary in chat:
   - High-level metrics (Total applications, interview rate, active pipeline)
   - Clickable link to generated HTML report: `[Job Search Report](file:///Users/zerodoxxx/Desktop/Self%20Projects/ai-job-search/documents/reports/job_search_report_YYYY-MM-DD.html)`

---

## Important Rules

1. **Self-contained always.** No remote script tags, no external stylesheets, no remote fonts.
2. **Offline readable.**
3. **Data fidelity.** Display exact numbers from tracker CSV and outcome records without distortion.
4. **Never overwrite historical reports.** Name uniquely with ISO date.
