---
name: html-report
description: >-
  Generates a self-contained, interactive HTML dashboard visualizing job search metrics,
  status breakdowns, conversion funnels, and filterable application tables.
  Triggers on: html report, generate dashboard, dashboard, analytics report, /html-report.
---

# /html-report - Generate Application Tracker Dashboard

Generate a self-contained HTML dashboard from `job_search_tracker.csv` and the application archives under `documents/applications/`. The output is a single `.html` file (with inline CSS & SVG charts, fully offline, zero external CDN dependencies) that can be opened directly in a browser.

Follow these steps **in order**.

---

## Step 0: Parse Arguments

- No argument → output to `reports/application-dashboard.html`
- A path argument → write to that path
- Ensure `reports/` directory exists.

---

## Step 1: Collect Data & Compute Statistics

1. Read `job_search_tracker.csv` and `documents/applications/*/outcome.md`.
2. Normalize statuses into canonical buckets: Drafted, Active, Interview, Offer, Hired, Rejected/Closed.
3. Compute summary metrics: total applications, funnel progression rate, status counts, sector breakdown, channel breakdown.

---

## Step 2: Generate Offline HTML Dashboard

Generate single `.html` document with:
- Top stat cards with color-coded badges
- Inline SVG charts: Status doughnut chart, sector bar chart, channel bar chart, application conversion funnel
- Interactive client-side filterable table (search by company/role, filter by status and sector)
- Safe HTML escaping for all text values

Write to output destination and present summary.
