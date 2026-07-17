# /gmail-sync - Sync Application Status from Gmail

You are scanning the user's Gmail for status signals on tracked job applications (interview invites, assessment links, offers, rejections) and writing detected changes directly into `job_search_tracker.csv` and `documents/applications/<company>_<role>/outcome.md` - the same two places `/outcome` writes to, in the same schema.

Unlike `/outcome` (which asks the user what happened), `/gmail-sync` classifies real emails and **writes automatically for high-confidence matches**. Because a wrong auto-write silently corrupts application history that `/setup` later calibrates from, every write must cite its source email and every uncertain case must be surfaced instead of guessed. Never treat this command's job as "notice something in an inbox" - it is "add a correct, sourced line to a permanent record."

Follow these steps **in order**.

---

## Step 0: Prerequisites

Confirm the Gmail MCP tools (`mcp__claude_ai_Gmail__*`) are available. If not, tell the user to connect the Gmail integration (claude.ai Settings → Connectors → Gmail) and stop - do not attempt this via Bash, IMAP, or any other channel.

---

## Step 1: Parse Input

`$ARGUMENTS` may contain:

- Nothing → default lookback (see Step 3)
- A company name, e.g. `/gmail-sync acme` → scope the search to that one tracked application
- `since <YYYY-MM-DD>` → override the lookback start date for this run only (does not change the persisted state file)

---

## Step 2: Load State

1. Read `job_search_tracker.csv`. If it does not exist, tell the user there is nothing to sync against yet (suggest `/outcome` or `/apply` first) and stop. Do not create it here - `/gmail-sync` never originates new applications, only updates existing ones.
2. Read `gmail_sync/state.json` (create if missing: `{"last_sync": null, "processed_message_ids": []}`).
3. Build the set of **open applications**: tracker rows whose `status` is not a final value (`hired`, `rejected`, `no response`, `offer declined`, `withdrawn`). For each, derive its archive folder `documents/applications/<company>_<role>/` (lowercase, underscores - same convention as `/outcome`) and check whether `outcome.md` exists there.
4. If `$ARGUMENTS` named a company, filter this set to the matching row(s) (case-insensitive). No match → tell the user and stop, do not guess.

---

## Step 3: Build the Search Query

Lookback window: `since <date>` argument if given, else `state.last_sync` if set, else `newer_than:30d`.

1. Call `list_labels` and look for a user label whose name suggests job-search email (e.g. contains "job", "application", "career" case-insensitively). Note its `id` if found.
2. Normalize each open application's company name for matching later (lowercase; strip `inc`, `inc.`, `llc`, `ltd`, `a/s`, `corp`, `corporation`, `group`; strip punctuation; collapse whitespace).
3. Build a Gmail query combining (with `OR` groups via `{}`):
   - `label:<id>` if a job-search label was found
   - A quoted-name OR-group of the open applications' company names, e.g. `{"Acme Corp" "BigCo"}`
   - A sender-domain OR-group of common ATS platforms: `{from:greenhouse.io from:lever.co from:myworkday.com from:ashbyhq.com from:smartrecruiters.com from:icims.com from:bamboohr.com}`
   - The lookback bound, e.g. `newer_than:30d` or `after:2026/06/15`
   - `in:inbox` (skip sent/drafts - status signals come from what employers send you, not what you sent them)

Example: `newer_than:30d in:inbox ({"Acme Corp" "BigCo"} OR {from:greenhouse.io from:lever.co from:myworkday.com from:ashbyhq.com})`

4. Call `search_threads` with `view: THREAD_VIEW_MINIMAL`, `pageSize: 50`, paginating via `pageToken` until exhausted or results are clearly outside the relevant window.

---

## Step 4: Filter to New Messages

For each returned thread, inspect its messages' IDs against `state.processed_message_ids`. Skip a thread entirely if every message in it is already processed. For threads with unprocessed messages, call `get_thread` with `messageFormat: FULL_CONTENT` to get full bodies - **classification in Step 5 must never be based on the snippet/subject alone**, since snippets truncate the exact phrase that distinguishes "we'd like to schedule a call" from "thanks for applying."

---

## Step 5: Classify Each Unprocessed Message

For each new message, first try to match it to one open application: compare the normalized sender domain / display name / subject / body against the normalized company names from Step 3. No confident match (company genuinely absent, or ambiguous between two tracked companies) → do not write; record it in the Step 8 summary as "unmatched" and move to the next message.

For a matched message, classify by content (require the signal phrase in the subject or the first few lines - a company name appearing only deep in a forwarded thread or newsletter footer is not a signal):

| Signal | Example phrasing | Tracker `status` | `outcome.md` action |
|---|---|---|---|
| Application ack | "we've received your application" | *(no change)* | *(no change - not a status signal, just noise)* |
| OA / assessment | "online assessment", "coding challenge", "complete your assessment", HackerRank/Codility links | `interview` | Tick nearest matching stage checkbox (or add a Notes line if no checkbox fits - assessments aren't always a listed stage) |
| Interview invite/scheduled | "schedule a call", "phone screen", "technical interview", "next round", "onsite", "final round" | `interview` | Tick the matching stage checkbox with the email's date |
| Offer extended | "pleased to offer", "extend an offer", "offer letter" | `offer` | Tick "Offer received" checkbox. **Never set `hired` or `offer_declined` from an email** - accepting or declining is the user's decision, not something to infer. Flag prominently in the Step 8 summary instead. |
| Rejection | "moving forward with other candidates", "not selected", "unable to proceed", "decided not to continue" | `rejected` | Set `Status: rejected`, `Date resolved:` to the email's date |

**Conflict rule:** if the classified signal contradicts the application's current final-ness (e.g. a "moving forward" email arrives for a company whose tracker row briefly shows a `rejected`-adjacent recent write already, or a rejection arrives after an offer was already recorded this run) - do not overwrite. Record it as a conflict in Step 8 for manual `/outcome` resolution instead.

---

## Step 6: Write Updates

For every message classified with a write action in Step 5:

1. **Tracker (`job_search_tracker.csv`):** update the matched row's `status` column per the table above, and append to `notes`: `<date> gmail-sync: <signal> ("<email subject>")`. Never restructure the CSV, reorder rows, or touch unrelated rows - same rule `/outcome` follows.
2. **`outcome.md`:** tick the relevant stage checkbox (adding the date in parentheses) or update `Status`/`Date resolved` per the table. Append a dated entry to `## Notes`, never overwrite existing Notes history:
   ```
   YYYY-MM-DD (via /gmail-sync): <one-line summary of what the email said>. Source: "<subject>" from <sender>, <email date>.
   ```
3. If no archive folder/`outcome.md` exists yet for a matched application (it was added to the tracker outside `/apply`/`/outcome`), create the folder and a minimal `outcome.md` following the exact format in `documents/README.md`, same as `/outcome` would.

---

## Step 7: Update State

Add every message ID processed this run (whether it produced a write, was unmatched, or was filtered as noise) to `gmail_sync/state.json`'s `processed_message_ids`, and set `last_sync` to today's date. This makes re-running idempotent - the same email never produces a duplicate tracker note or Notes entry.

---

## Step 8: Staleness Check

For open applications with **no** matching activity found this run, check the tracker's `date` column and the most recent dated Notes entry in their `outcome.md`. If the most recent of those is 30+ days old, flag the application as "needs follow-up" in the summary below. This is surfaced only - never write anything for staleness.

---

## Step 9: Present Summary

```
## Gmail Sync - YYYY-MM-DD

Scanned N threads (M new messages) since <lookback date>.

### Updates Written
| Company | Role | Signal | Tracker Status | Source Email |
|---|---|---|---|---|
| ... | ... | Interview invite | applied -> interview | "Subject line", 2026-07-10 |

### Offers Requiring Your Decision
- **<Company>** - offer received 2026-07-12 ("<subject>"). Tracker set to `offer`; run `/outcome <company>` to record accept/decline once you decide.

### Needs Manual Review (conflicting signal)
- **<Company>** - <what conflicted and why it wasn't auto-written>

### Unmatched Emails
- "<subject>" from <sender> - looked job-related but couldn't be confidently linked to a tracked application.

### Stale Applications (30+ days, no activity)
- **<Company>** - last activity YYYY-MM-DD, still `<status>`.
```

If nothing new was found, say so briefly instead of printing empty tables.

If this run pushed the count of applications with a **final** `outcome.md` status to 3+ (or resolved a second application sharing a pattern), suggest the same `/setup` Path A calibration handoff `/outcome` suggests - do not duplicate that logic, just point the user there.

---

## Important Rules

1. **Classify from full email bodies, never snippets.** A status-changing write requires having actually fetched and read the message via `get_thread`/`get_message`.
2. **Never auto-resolve to `hired` or `offer_declined`.** Those require the user's real-world decision; `/gmail-sync` stops at `offer` and flags it.
3. **A conflicting signal against an already-final or already-written status is a manual-review flag, not an overwrite.** When in doubt, don't write - surface it.
4. **Append-only to `outcome.md` Notes**, same as `/outcome`. Never rewrite or delete existing history.
5. **Idempotent by message ID.** Re-running must never duplicate a tracker note or a Notes entry for the same email.
6. **Never fabricate a match.** If the company can't be confidently identified from the email, it goes in "Unmatched," not a guess.
7. **Read-only against Gmail itself.** This command reads and classifies; it does not label, archive, or delete anything in the user's mailbox.
8. **All state is personal data.** `gmail_sync/state.json`, `job_search_tracker.csv`, and `documents/applications/**` are gitignored - never suggest committing them.
