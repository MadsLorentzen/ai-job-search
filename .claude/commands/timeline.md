# /timeline - Application Pipeline Date View

You are presenting the user with a unified chronological view of everything time-sensitive across their active applications — upcoming deadlines, scheduled interviews, follow-up reminders, and applications that are missing deadline info. All data comes from `job_search_tracker.csv` — this command is about managing the pipeline of jobs you have already committed to, not the full scrape backlog.

Follow these steps **in order**.

---

## Step 0: Parse Input

`$ARGUMENTS` may contain:

- Nothing → show all upcoming items and gaps
- `--N` (e.g. `/timeline --14`) → only show items within the next N days (default: all upcoming)
- `--all` → include historically resolved items (past deadlines, past interviews) for a full retrospective

---

## Step 1: Load State

1. Read `job_search_tracker.csv`. If it does not exist or has only a header row, say:
   > "No applications tracked yet. Run `/apply` on a posting, then `/outcome <company>` to record it in the tracker and start building your timeline."
   and stop.
2. Today's date: use the current date.

---

## Step 2: Collect Items

Build a flat list of timeline items from the tracker rows. Skip the header row. For each row:

### Skip resolved applications

If `status` is a final resolution (`hired`, `rejected`, `offer_declined`, `withdrawn`, `no_response`, `interview_only`), skip the row entirely — unless `$ARGUMENTS` includes `--all`, in which case include past dates for the retrospective view.

### Active applications — collect these items

**Application deadline:**
If `deadline` is non-empty and the date is today or in the future:

| Field | Value |
|-------|-------|
| `date` | The `deadline` value |
| `type` | `"Application deadline"` |
| `company` | `company` column |
| `role` | `role` column |

**Upcoming interview:**
If `interview_date` is non-empty and the date is today or in the future:

| Field | Value |
|-------|-------|
| `date` | The `interview_date` value |
| `type` | `"Interview"` |
| `company` | `company` column |
| `role` | `role` column |

**Follow-up reminder:**
If `follow_up_date` is non-empty and the date is today or in the future:

| Field | Value |
|-------|-------|
| `date` | The `follow_up_date` value |
| `type` | `"Follow-up"` |
| `company` | `company` column |
| `role` | `role` column |

### Auto-detect overdue follow-ups

For rows where:
- `status` is `applied` or `interview` (not resolved)
- `follow_up_date` is empty
- `interview_date` is empty
- `date` (application date) is **21+ days** before today

| Field | Value |
|-------|-------|
| `date` | The `date` value (original application date — shown for reference, not as a timeline entry) |
| `type` | `"⚠️ Overdue — no response for N days"` |
| `company` | `company` column |
| `role` | `role` column |

These are applications that have gone silent. They go in a separate "Overdue" section, not the main timeline.

### Missing deadline

If `deadline` is empty and `status` is not a final resolution:

Collect into a separate "No Deadline Set" list. These don't appear in the timeline itself but are flagged so the user can fill them in.

---

## Step 3: Sort and Filter

1. Sort all timeline items (deadlines, interviews, follow-ups) by `date` ascending.
2. Assign urgency:
   - **🔥 Urgent**: date is 0–7 days from today (inclusive)
   - **📅 Upcoming**: date is 8+ days from today
3. If `$ARGUMENTS` specified `--N`, drop items beyond the N-day window.
4. If `$ARGUMENTS` included `--all`, include resolved applications with their past dates.

---

## Step 4: Present

```
## 📅 Application Timeline — YYYY-MM-DD

<if no items in all sections: "Nothing urgent or upcoming. You're on top of things." and stop>

### 🔥 Urgent (next 7 days)

| Date | Type | Company | Role |
|------|------|---------|------|
| Jul 12 | Application deadline | Novo Nordisk | Data Engineer |
| Jul 14 | Interview | Ørsted | ML Engineer |

### 📅 Upcoming

| Date | Type | Company | Role |
|------|------|---------|------|
| Jul 22 | Application deadline | LEGO | Data Scientist |
| Jul 28 | Follow-up | Systematic | Software Engineer |

<if any overdue:>

### ⚠️ Overdue Follow-ups

These applications have gone silent. Consider a brief follow-up or mark as `no_response` via `/outcome`.

| Applied | Company | Role | Days silent |
|---------|---------|------|-------------|
| Jun 10 | Rambøll | Consultant | 28 |
| Jun 15 | Netcompany | Developer | 23 |

<if any missing deadlines:>

### 📋 No Deadline Set

These applications are missing deadline info. Run `/outcome <company>` to add one.

| Company | Role | Status |
|---------|------|--------|
| Systematic | SW Engineer | applied |

---

After presenting, offer **one** relevant suggestion (don't list every possibility — pick the most pressing):

- If urgent items exist: "3 things need attention this week. Want me to help with any of them?"
- If only upcoming items: "Nothing urgent right now. Next deadline is July 22."
- If overdue items exist: "Netcompany and Rambøll have been silent for 3+ weeks. Want to send a follow-up or mark them resolved?"
- If missing deadlines: "2 applications are missing deadlines. Run `/outcome <company>` to fill them in."
```

---

## Step 5: Offer Actions

Based on what's in the timeline, offer at most 2 specific, actionable suggestions:

- **Interview coming up**: "Ørsted interview on July 14. The job posting should be archived in `documents/applications/orsted_ml_engineer/` — want me to generate likely interview questions from it?"
- **Deadline approaching**: "Novo Nordisk closes in 4 days. All set with the application?"
- **Overdue follow-up**: "Rambøll has been silent for 4 weeks. Consider a brief follow-up email or mark it `no_response` with `/outcome ramboll`."
- **Missing deadline**: "Run `/outcome systematic` to add the deadline — takes 30 seconds."

---

## Important Rules

1. **Tracker only.** `/timeline` reads only from `job_search_tracker.csv`. Scraped jobs that haven't been applied to live in the `/scrape` and `/rank` output — that's where their deadlines belong. This command manages your active pipeline.
2. **Never fabricate dates.** Only show what's actually recorded. If a date looks wrong (e.g. deadline in 2019), flag it rather than silently correcting.
3. **Respect final resolutions.** `hired`, `rejected`, `offer_declined`, `withdrawn`, `no_response`, `interview_only` rows are excluded unless `--all` is passed. The user doesn't need to see a deadline for a job they were already rejected from.
4. **Respect the data.** `deadline`, `follow_up_date`, and `interview_date` are optional fields — many rows won't have them. That's expected (especially for applications made before these columns existed). Don't nag about missing data; present what you have and offer to fill gaps.
5. **Keep it scannable.** The timeline is a dashboard, not a report. Each section should be glanceable — if a section would have 10+ items, consider grouping by week.
6. **Idempotent.** `/timeline` reads only — it never writes to the tracker.
