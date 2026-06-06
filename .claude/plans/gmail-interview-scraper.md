# Plan: Gmail Interview Tracker Scraper

**Status: completed (first run June 2026) — 86 applications scraped**

---

## Goal
Scrape Gmail for job application events and populate `documents/applications/<company>_<role>/outcome.md` files.

---

## Event Types to Detect

| Event | Signal phrases / subjects |
|-------|--------------------------|
| **Application received** | "thanks for applying", "we received your application", "application submitted", "application confirmation" |
| **Recruiter outreach** | "I came across your profile", "I'd love to connect", "exciting opportunity" |
| **Phone/screening invite** | "schedule a call", "introductory call", "recruiter screen", "30-minute chat" |
| **Technical interview invite** | "technical interview", "coding challenge", "take-home assessment", "HackerRank", "Codility" |
| **On-site / final round invite** | "final round", "on-site interview", "panel interview", "meet the team" |
| **Offer** | "pleased to offer", "offer letter", "job offer", "we'd like to extend" |
| **Rejection** | "not moving forward", "decided to pursue other candidates", "unfortunately", "we won't be progressing" |
| **Withdrawal / no response** | (no reply after N days — inferred, not scraped) |

---

## How to Re-run (Option A — Gmail MCP)

Run all queries below **in parallel**, then compare results against existing folders in `documents/applications/`.

### Step 1 — Search queries

```
# Keyword-based (catches most ATS emails)
subject:(application OR applying OR applied) after:<LAST_RUN_DATE> -in:sent -in:draft
subject:(interview OR screen OR assessment) after:<LAST_RUN_DATE> -in:sent -in:draft
subject:(offer OR congratulations) after:<LAST_RUN_DATE> -in:sent -in:draft
subject:(unfortunately OR regret OR "not moving forward" OR "other candidates") after:<LAST_RUN_DATE> -in:sent -in:draft
from:(greenhouse.io OR lever.co OR workday OR smartrecruiters OR ashbyhq.com OR jobvite.com OR personio OR recruitee) after:<LAST_RUN_DATE>

# Label-based (catches manually labelled emails missed by keywords)
label:Applications
label:Applications/In-progress
label:Applications/Rejected
```

Replace `<LAST_RUN_DATE>` with the date of the previous run (format: `YYYY/MM/DD`).

**Last run date: stored in `.claude/gmail-scraper-state.md`** — read `next_query_date_filter` from there before running.

### Step 2 — For each thread found

1. Check if a folder already exists in `documents/applications/` for that company+role.
2. If yes: read existing `outcome.md` and append new events to the timeline. **Never overwrite a `**Status:**` line that was set manually.**
3. If no: create a new folder `<company>_<role>/` and write a fresh `outcome.md`.

### Step 3 — For manually provided subjects

If the user says "the subject for X is Y", search that exact subject with:
```
subject:"<exact subject>"
```
Then update the relevant `outcome.md`.

---

## What Was Learned (first run)

- **Label-based search was essential** — many applications were not caught by keyword queries alone. Always run all three label queries (`Applications`, `Applications/In-progress`, `Applications/Rejected`).
- **ATS senders to watch**: `@ashbyhq.com`, `@greenhouse.io`, `@greenhouse-mail.io`, `@lever.co`, `@personio.de`, `@personio.com`, `@myworkday.com`, `@smartrecruiters.com`, `@successfactors.com`, `@recruitee.com`, `@teamtailor.com`, `@workablemail.com`, `@join.com`, `@100hires.com`, `@softgarden.io`.
- **Calendar invites** are a reliable signal for interviews — subjects like "Invitation: <Company> Interview" or "Appointment booked: First-round Interview".
- **Some rejections have non-obvious subjects** (e.g. "Rejection Langdock", "Flatiron Health Update") — check with user if outcome is unknown.
- **Duplicate applications** are common (same company, same role applied twice). Create separate entries or note in the same file.
- **Recruiter platforms** (Clera, Xena) appear as intermediaries — track both the recruiter thread and the company thread.

---

## Output Format

Each `documents/applications/<company>_<role>/outcome.md`:

```markdown
# Outcome: <Company> — <Role>

**Status:** hired | offer_declined | rejected | no_response | interview_only

**Date resolved:** YYYY-MM-DD

## Interview stages reached
- [ ] Phone screen
- [ ] Technical interview
- [ ] Case interview
- [ ] Final round
- [ ] Offer received

## Email Timeline (auto-scraped)
| Date | Event | Notes |
|------|-------|-------|
| YYYY-MM-DD | Application received | Subject: ... |
| YYYY-MM-DD | Rejection | Subject: ... |

## Notes
```

---

## Privacy / Scope Notes
- Only scrape from `silvia.giammarinaro@gmail.com`.
- Do not store raw email bodies — only extracted structured fields.
- Never silently overwrite a `**Status:**` line that was filled in manually.
