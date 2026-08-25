---
name: outcome
description: >-
  Records the progress and final result of an application: stage reached,
  interviews, offers, rejections, feedback notes, and follow-ups. Updates
  the tracker and application archive. Triggers on: outcome, record outcome,
  application status, interview outcome, got rejected, got offer, /outcome.
---

# /outcome - Record the Result of an Application

You are recording what happened to a job application: progress updates (interview invitations, stages completed, offers) and final resolutions (hired, rejected, no response). The data lands in two places the framework already reads:

- `job_search_tracker.csv` - the status column that `/scrape` and `/rank` use for dedup and exclusion
- `documents/applications/<company>_<role>/` - the per-application archive (posting, submitted drafts, `outcome.md`) that `/setup` Path A mines to calibrate `04-job-evaluation.md` and surface STAR candidates

`/outcome` writes the data; `/setup` interprets it. This command never edits the evaluation framework or profile files itself.

The command also owns the stretch *before* there is an outcome to record: the **follow-up branch** (Step 2b) surfaces open applications that have gone quiet, drafts a brief follow-up note in the user's voice, and logs it.

Follow these steps **in order**.

---

## Step 0: Parse Input

Input may contain:

- Nothing → list open applications and ask which one to update
- A company name (optionally with a role), e.g. `/outcome revionics` or `/outcome revionics ml engineer` → target that application
- `followup` → enter the follow-up branch (Step 2b) over every quiet open application, using the default threshold of **10 days**
- `followup <N>`, e.g. `/outcome followup 14` → follow-up branch with an N-day threshold
- `followup <company>`, e.g. `/outcome followup revionics` → draft a follow-up for that application now, regardless of threshold

---

## Step 1: Load State and Identify the Application

1. Read `job_search_tracker.csv`. If it does not exist, create it with the standard header:
   ```
   date,company,sector,role,role_type,channel,status,contact_person,fit_rating,notes,cv_file,cover_letter_file,source,deadline
   ```
   If the file exists and its header does not end in `,deadline`, append `,deadline` to the header line only.
2. **With an argument:** match rows case-insensitively on company (and role, if given). One match → proceed. Several → list and ask. None → add tracker row.
3. **Without an argument:** list all rows whose status is not final as a numbered table (company, role, date applied, current status, deadline, days quiet, follow-ups sent) and ask which to update.
   - `drafted` rows are listed under their own heading ("Drafted, not yet submitted"), leave days quiet and follow-ups sent blank.
   - Deadline urgency: mark within 7 days with 🔥, passed with ⚠.
4. Derive archive folder name: `documents/applications/<company>_<role>/` by the **Subfolder naming** rule in `documents/README.md`.

---

## Tracker status vocabulary

Canonical spellings for the tracker CSV `status` column (underscores, never spaces):

`drafted` | `applied` | `interview` | `offer` | `hired` | `rejected` | `no_response` | `offer_declined` | `withdrawn`

- **Final** (application closed): `hired`, `rejected`, `no_response`, `offer_declined`, `withdrawn`
- **Open**: everything else, `drafted` included.
- `drafted` is open but distinct — nothing was sent, so no follow-up is ever due.
- Readers accept legacy space spellings `no response` and `offer declined` on read. Never write them.

---

## Step 2: Collect What Happened

Ask the user what happened, then classify:

**Progress updates** (application still open):
- Interview invitation / stage scheduled or completed (phone screen, technical, case, final round)
- Offer received (not yet accepted or declined)

**Resolutions** (application closed) — these map to the archive `Status:` enum in `documents/README.md`:
- `hired` - accepted an offer
- `offer_declined` - received an offer, turned it down
- `rejected` - explicit rejection at any stage
- `no_response` - no reply
- `interview_only` - reached interviews but stalled without explicit rejection

Also collect: dates for stages reached, feedback received verbatim, what they'd do differently.

---

## Step 2b: Follow-Up Branch (chase a quiet application)

An application qualifies when its status is neither final nor `drafted`, 10+ days have passed, and it has fewer than **two** logged follow-ups.

**Drafting:**
1. Read the archive folder (`job_posting.md`, `cv_draft.tex`, `cover_letter.tex`).
2. Apply writing style rules from `03-writing-style.md` (no cliches, no em-dashes, warm but direct).
3. Write roughly 60 to 120 words: address contact person, restate interest, remind value, inquire politely on timeline.
4. Shape for channel: email, LinkedIn message, or portal message.
5. Log upon user confirmation: append `followed up YYYY-MM-DD` to tracker `notes`, and save as `followup_YYYY-MM-DD.md` in the application archive.

---

## Step 3: Archive the Application Materials

Create or update `documents/applications/<company>_<role>/`:
1. `cv_draft.tex` and `cover_letter.tex` — copy submitted files. If already exists, leave it.
2. `job_posting.md` — if exists, leave it. Otherwise fetch or paste posting text.
3. `outcome.md` — write or update in standard format:

```markdown
# Outcome: <Company> — <Role>

**Status:** in_progress | hired | offer_declined | rejected | no_response | interview_only

**Date resolved:** YYYY-MM-DD

## Interview stages reached
- [x] Phone screen (YYYY-MM-DD)
- [ ] Technical interview
- [ ] Case interview
- [ ] Final round
- [ ] Offer received

## Notes
<feedback received, notes, lessons learned>
```

**Thank-you note trigger:** when ticking a newly completed interview stage, offer to draft a prompt thank-you note.

---

## Step 4: Update the Tracker

Update matched row's `status` column using canonical spellings and append a short dated note to `notes`. If moving off `drafted`, update `date` to the actual submission date.

---

## Step 5: Calibration Handoff

When 3+ applications have a final status, suggest running `/setup` (Path A) to calibrate fit scoring and mine interview feedback for STAR examples.

---

## Step 6: Confirm

Summarize what was recorded:
- `documents/applications/<company>_<role>/outcome.md`
- Tracker status updated
- Next steps (e.g. `/interview <company>` if interview is scheduled).

---

## Important Rules

1. **Write data, don't interpret it.**
2. **The archived version is the submitted version.**
3. **Never fabricate.**
4. **Stay schema-compatible.**
5. **Idempotent updates.**
6. **Follow-ups: draft only, never send.**
7. **Follow-ups: no new claims.**
8. **Maximum two follow-ups per application.**
