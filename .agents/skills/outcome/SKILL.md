---
name: outcome
description: >-
  Records the progress and final result of an application: stage reached,
  interviews, offers, rejections, feedback notes, and follow-ups. Updates
  the tracker and application archive. Triggers on: outcome, record outcome,
  application status, interview outcome, got rejected, got offer, /outcome.
---

# /outcome - Record the Result of an Application

You are recording what happened to a job application: progress updates (interview invitations, stages completed, offers) and final resolutions (hired, rejected, no response). The data lands in two places:

- `job_search_tracker.csv` - the status column that `/scrape` and `/rank` use for dedup and exclusion
- `documents/applications/<company>_<role>/outcome.md` - the per-application archive

Follow these steps **in order**.

---

## Step 0: Parse Input

Input may contain:
- Nothing → list open applications and ask which one to update
- A company name (optionally with a role), e.g. `/outcome revionics`
- `followup` → check for open applications that have gone quiet (default 10 days) and draft follow-up notes

---

## Step 1: Tracker Status Vocabulary

Canonical spellings for the tracker CSV `status` column:
`drafted` | `applied` | `interview` | `offer` | `hired` | `rejected` | `no_response` | `offer_declined` | `withdrawn`

- **Final** (closed): `hired`, `rejected`, `no_response`, `offer_declined`, `withdrawn`
- **Open**: `drafted`, `applied`, `interview`, `offer`

---

## Step 2: Update Application Archive & Tracker

1. Update the row in `job_search_tracker.csv` with the new status, date, and brief note.
2. In `documents/applications/<company>_<role>/outcome.md`, record:
   - **Date:** YYYY-MM-DD
   - **Stage reached:** Screen, Technical Round, Take-home, Onsite, Offer, etc.
   - **Outcome:** Hired / Offer / Rejected / In Progress
   - **Feedback & Notes:** Questions asked, technical topics covered, things that went well, areas for improvement.

---

## Step 3: Follow-Up Drafts (When quiet)

If an application is 10+ days without a response:
- Draft a concise, professional 2-3 sentence follow-up email inquiring on status and reaffirming interest.
- Record the follow-up attempt in the tracker notes.
