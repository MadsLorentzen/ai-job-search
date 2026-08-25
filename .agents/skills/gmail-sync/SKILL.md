---
name: gmail-sync
description: >-
  Syncs job application updates from Gmail (interview invites, OA links, offers, rejections)
  into job_search_tracker.csv and application archives. Triggers on: gmail sync, sync email,
  sync applications from gmail, /gmail-sync.
---

# /gmail-sync - Sync Application Status from Gmail

You are scanning the user's Gmail for status signals on tracked job applications (interview invites, assessment links, offers, rejections) and, once approved, writing the detected changes into `job_search_tracker.csv` and `documents/applications/<company>_<role>/outcome.md` - the same two places `/outcome` writes to, in the same schema.

Unlike `/outcome` (which asks the user what happened), `/gmail-sync` classifies real emails on its own - but it never writes on its own. Every classified change is presented as a batch **before** anything touches the tracker or `outcome.md`, and only proceeds once the user approves it. Never treat this command's job as "notice something in an inbox" - it is "propose a correct, sourced line for a permanent record, and write it only once the user says yes."

Follow these steps **in order**.

---

## Step 0: Prerequisites

Confirm Gmail tools or integration are available. If not, tell the user to connect the Gmail integration and stop.

---

## Step 1: Parse Input

Input may contain:

- Nothing → default lookback
- A company name, e.g. `/gmail-sync revionics` → scope the search to that one tracked application
- `since <YYYY-MM-DD>` → override the lookback start date for this run only

---

## Step 2: Load State

1. Read `job_search_tracker.csv`. If it does not exist, tell the user there is nothing to sync against yet and stop.
2. Read `gmail_sync/state.json` (create if missing: `{"last_sync": null, "processed_message_ids": []}`).
3. Build the set of **open applications**: tracker rows whose `status` is not **Final** (per the **Tracker status vocabulary** in `/outcome`). For each, derive its archive folder `documents/applications/<company>_<role>/` by the **Subfolder naming** rule in `documents/README.md`.
4. If an argument named a company, filter this set to matching rows.

---

## Step 3: Build the Search Query

Lookback window: `since <date>` argument if given, else `state.last_sync` if set, else `newer_than:30d`.

1. Check for user labels suggesting job search.
2. Normalize open company names.
3. Build a Gmail query combining ATS domains (`{from:greenhouse.io from:lever.co from:myworkday.com from:ashbyhq.com from:smartrecruiters.com from:bamboohr.com}`), open company names, lookback bound, and `-in:sent -in:drafts`.
4. Search message threads.

---

## Step 4: Filter to New Messages & Classify

For each new message, call for full message body (never classify on snippets alone).

Classify by content:

| Signal | Example phrasing | Tracker `status` | `outcome.md` action |
|---|---|---|---|
| Application ack | "we've received your application" | `drafted` -> `applied`, otherwise *(no change)* | On `drafted` row, propose move with date set to email date |
| OA / assessment | "online assessment", "coding challenge", HackerRank/Codility links | `interview` | Tick nearest matching stage checkbox |
| Interview invite/scheduled | "schedule a call", "phone screen", "technical interview", "next round", "onsite" | `interview` | Tick matching stage checkbox with email date |
| Offer extended | "pleased to offer", "extend an offer", "offer letter" | `offer` | Tick "Offer received" checkbox. **Never propose `hired` or `offer_declined`** |
| Rejection | "moving forward with other candidates", "not selected", "unable to proceed" | `rejected` | Set `Status: rejected`, `Date resolved` to email date |

---

## Step 5: Present Proposed Updates

Present every classified change as a single batch before writing:

```
## Gmail Sync - Proposed Updates - YYYY-MM-DD

### Proposed Changes (reply "approve all", or list which to skip)
| # | Company | Role | Signal | Current -> Proposed Status | Source Email (date) |
|---|---|---|---|---|---|
| 1 | ... | ... | Interview invite | applied -> interview | "Subject" (YYYY-MM-DD) |

### Needs Manual Review (conflicting signal)
- **<Company>** - <details>

### Unmatched Emails
- "<subject>" from <sender>

### Stale Applications (30+ days, no activity)
- **<Company>** - last activity YYYY-MM-DD
```

---

## Step 6: Wait for Approval & Write

Stop and wait for user's explicit reply ("approve all" / "skip 2" / "no").

For approved rows:
1. **Tracker:** Update `status` and append `<date> gmail-sync: <signal> ("<subject>")` to `notes`.
2. **`outcome.md`:** Tick stage checkbox with date, or update Status/Date resolved. Append dated entry to `## Notes`.
3. If no archive folder exists yet, create it with a minimal `outcome.md`.

---

## Step 7: Update State & Summary

Add processed message IDs to `gmail_sync/state.json` and set `last_sync` to today's date.
Present closing summary.

---

## Important Rules

1. **Classify from full email bodies, never snippets.**
2. **Nothing is written before user approves.**
3. **Never propose `hired` or `offer_declined`.**
4. **Append-only to `outcome.md` Notes.**
5. **Idempotent by message ID.**
6. **Read-only against Gmail.**
