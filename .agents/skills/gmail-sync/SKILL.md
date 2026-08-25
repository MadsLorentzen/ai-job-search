---
name: gmail-sync
description: >-
  Syncs job application updates from Gmail (interview invites, OA links, offers, rejections)
  into job_search_tracker.csv and application archives. Triggers on: gmail sync, sync email,
  sync applications from gmail, /gmail-sync.
---

# /gmail-sync - Sync Application Status from Gmail

You are scanning the user's Gmail for status signals on tracked job applications (interview invites, assessment links, offers, rejections) and, once approved, writing the detected changes into `job_search_tracker.csv` and `documents/applications/<company>_<role>/outcome.md`.

Every classified change is presented as a batch **before** anything touches the tracker or `outcome.md`, and only proceeds once the user approves it.

Follow these steps **in order**.

---

## Step 0: Prerequisites & Parse Input

- Ensure Gmail integration/tooling is available.
- `$ARGUMENTS` may contain a company name or `since <YYYY-MM-DD>`.

---

## Step 1: Load State

1. Read `job_search_tracker.csv`.
2. Read `gmail_sync/state.json` (create if missing: `{"last_sync": null, "processed_message_ids": []}`).
3. Build the set of **open applications** (tracker rows where status is not `hired`, `rejected`, `no_response`, `offer_declined`, `withdrawn`).

---

## Step 2: Search & Classify Messages

Search recent emails from ATS platforms (`greenhouse.io`, `lever.co`, `myworkday.com`, `ashbyhq.com`, `smartrecruiters.com`, `bamboohr.com`) and matching company names.

| Signal | Status mapping |
|---|---|
| Application ack | `drafted` -> `applied` |
| OA / assessment link | `interview` |
| Interview invite / scheduling | `interview` |
| Offer extended | `offer` |
| Rejection | `rejected` |

---

## Step 3: Present Proposed Updates & Wait for Approval

Present proposed updates in a clear table showing company, signal, current -> proposed status, and email source.
**Wait for explicit approval** before updating `job_search_tracker.csv` and `documents/applications/<company>_<role>/outcome.md`.
Update `gmail_sync/state.json` with processed message IDs.
