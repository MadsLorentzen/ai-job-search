# /outcome - Record the Result of an Application

You are recording what happened to a job application: progress updates (interview invitations, stages completed, offers) and final resolutions (hired, rejected, no response). The data lands in two places the framework already reads but nothing systematically writes:

- `job_search_tracker.csv` - the status column that `/scrape` and `/rank` use for dedup and exclusion
- `documents/applications/<company>_<role>/` - the per-application archive (posting, submitted drafts, `outcome.md`) that `/setup` Path A mines to calibrate `04-job-evaluation.md` and surface STAR candidates

`/outcome` writes the data; `/setup` interprets it. This command never edits the evaluation framework or profile files itself.

Follow these steps **in order**.

---

## Step 0: Parse Input

`$ARGUMENTS` may contain:

- Nothing → list open applications and ask which one to update
- A company name (optionally with a role), e.g. `/outcome acme` or `/outcome acme ml engineer` → target that application

---

## Step 1: Load State and Identify the Application

1. Read `job_search_tracker.csv`. If it does not exist, create it with the standard header:
   ```
   date,company,sector,role,role_type,channel,status,contact_person,fit_rating,notes,cv_file,cover_letter_file,source,deadline,follow_up_date,interview_date
   ```
2. **With an argument:** match rows case-insensitively on company (and role, if given). One match → proceed. Several → list them and ask. None → the application was made outside the workflow; collect company, role, date applied, channel, and posting URL from the user and add a tracker row. Also check `job_scraper/seen_jobs.json` for a matching entry (by URL or company+title) — if found and it has a `deadline`, use it. If not found, ask the user: "Do you know the application deadline?" and use their answer (or leave empty).
3. **Without an argument:** list all rows whose status is not final (not hired / rejected / no response / withdrawn / offer declined) as a numbered table (company, role, date applied, current status) and ask which to update. If every row is resolved, say so and stop.
4. Derive the archive folder name: `documents/applications/<company>_<role>/` - lowercase, underscores for spaces (the convention documented in `documents/README.md`). Check whether the folder and an `outcome.md` already exist - if so, you are updating, not creating.

---

## Step 2: Collect What Happened

Ask the user what happened, then classify:

**Progress updates** (application still open):
- Interview invitation / stage scheduled or completed (phone screen, technical, case, final round)
- Offer received (not yet accepted or declined)

**Resolutions** (application closed) - these map to the status enum in `documents/README.md` that `/setup` parses:
- `hired` - accepted an offer
- `offer_declined` - received an offer, turned it down
- `rejected` - explicit rejection at any stage
- `no_response` - no reply; if the user is unsure whether to call it, note how long it has been since the last contact and let them decide - do not impose a cutoff
- `interview_only` - reached interviews but the process stalled or was abandoned without an explicit rejection

Also collect, without interrogating - one or two open questions are enough:
- Dates for the stages reached. If an interview is scheduled, capture the specific date — this goes into the tracker's `interview_date` column and will appear in `/timeline`.
- For applications with no deadline recorded yet, ask: "Do you know the application deadline? Even an approximate date helps for tracking."
- Any feedback received, verbatim where the user remembers it
- What they'd do differently, and any signal about what the company valued (these feed `/setup`'s calibration and STAR-candidate mining, so concrete beats polished)

---

## Step 3: Archive the Application Materials

Create or update `documents/applications/<company>_<role>/`. All content here is personal data - the folder is already gitignored (`documents/applications/**`), so nothing needs redacting.

1. **`cv_draft.tex` and `cover_letter.tex`** - copy (never move) the submitted files. Locate them via the tracker row's `cv_file`/`cover_letter_file` columns; if those are empty, look for `cv/main_<company>.tex` and `cover_letters/cover_<company>_*.tex`. If a file already exists in the archive, leave it - the archived version is what was actually submitted. If no draft files exist (application made outside `/apply`), skip with a note.
2. **`job_posting.md`** - if it already exists, leave it. Otherwise try WebFetch on the tracker row's `source` URL and save the posting text. If the URL is dead (postings expire fast - this is exactly why the archive matters), ask the user to paste the posting, or write a stub noting the posting is unavailable. **Never reconstruct a posting from memory.**
3. **`outcome.md`** - write or update it in exactly the format documented in `documents/README.md`, so `/setup` Path A parses it without special cases:

```markdown
# Outcome: <Company> — <Role>

**Status:** in_progress | hired | offer_declined | rejected | no_response | interview_only

**Date resolved:** YYYY-MM-DD   <- only when resolved; omit while in_progress

## Interview stages reached
- [x] Phone screen (YYYY-MM-DD)
- [ ] Technical interview
- [ ] Case interview
- [ ] Final round
- [ ] Offer received

## Notes
<feedback received, what to do differently, signals about what they valued -
appended per update with a date, never overwritten>
```

Update rules: tick stage checkboxes as they are reached (add the date in parentheses), append dated entries to Notes, and only change `Status` from `in_progress` to a final value on resolution. Re-running `/outcome` on the same application is idempotent - it appends new information, never duplicates or rewrites history.

---

## Step 4: Update the Tracker

Update the matched row:
- `status` column (e.g. `applied` → `interview` → `offer` → `hired` / `rejected` / `no response` / `offer declined` / `withdrawn`)
- `deadline` column — if you collected a deadline in Step 2 or found one in `seen_jobs.json`, write it here (format: `YYYY-MM-DD`)
- `interview_date` column — if an interview was scheduled and you collected the date, write it here (format: `YYYY-MM-DD`)
- `follow_up_date` column — if no response and the user wants to follow up, suggest a date (~2-3 weeks after application or last contact) and write it here
- Append a short dated note to the `notes` column.
Never restructure the CSV, reorder rows, or touch other rows.

---

## Step 5: Calibration Handoff

Count the `outcome.md` files under `documents/applications/` with a **final** status (not `in_progress`).

- If 3 or more are resolved (or 2+ share a pattern - same role type rejected twice, same sector going silent), suggest:
  > "You now have <N> resolved applications on record. Run `/setup` (Path A) to fold them into your evaluation framework - it calibrates fit scoring from what actually got interviews, and mines your interview feedback for STAR examples."
- Do **not** write anything into `04-job-evaluation.md` or other skill files yourself. `/setup` Path A owns that merge - it is read-before-write and idempotent, and duplicating its logic here would race it.

---

## Step 6: Confirm

Summarize what was recorded:

> **Outcome recorded for <Role> at <Company>.**
>
> - `documents/applications/<company>_<role>/outcome.md` - status: <status>, <what changed>
> - Archived: <which of cv_draft.tex / cover_letter.tex / job_posting.md were copied or fetched, and which were skipped and why>
> - Tracker: status → <new status>
>
> [Calibration suggestion from Step 5, if triggered]

---

## Important Rules

1. **Write data, don't interpret it.** The archive and tracker are the outputs; calibration belongs to `/setup`. This command never edits profile or framework files.
2. **The archived version is the submitted version.** Existing files in the application folder are never overwritten by fresher drafts.
3. **Never fabricate.** A dead posting URL gets a user-pasted copy or an explicit "unavailable" stub, not a reconstruction. Feedback is recorded as the user reports it.
4. **Stay schema-compatible.** `outcome.md` follows the format in `documents/README.md` exactly (`in_progress` is the one addition, for open applications); the tracker keeps its columns.
5. **Idempotent updates.** Re-running on the same application appends new stages and notes; it never duplicates folders, rows, or history.
