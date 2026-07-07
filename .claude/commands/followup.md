---
description: Draft follow-up emails for applications that have gone quiet, and log them in the tracker
argument-hint: "[company name] [--days N] [--dry-run]"
---

# /followup

Find applications that have gone quiet, draft a tailored follow-up email for each one you approve, and update `job_search_tracker.csv` once you confirm it's been sent.

This command never sends email on its own behalf — it drafts, you review, you send, then it logs it.

## Arguments

- No argument: scan the whole tracker.
- `<company name>`: scan only that company's row(s).
- `--days N`: override the default follow-up threshold (default: 10 business days since `Applied Date`, or since the last logged follow-up if one exists).
- `--dry-run`: just list what qualifies, don't draft anything.

## Steps

1. **Load the tracker.** Read `job_search_tracker.csv`. If it doesn't exist or has no rows beyond the header, tell the user there's nothing to follow up on yet and stop.

2. **Find candidates.** A row qualifies for a follow-up when:
   - Status indicates an active, unresolved application (e.g. `Applied`, `Followed Up` — not `Rejected`, `Withdrawn`, `Offer`, or `Interviewing`, since those already have signal and don't need a cold nudge).
   - Days elapsed since the later of `Applied Date` or `Last Follow-up Date` is ≥ the threshold.
   - Skip rows with obviously malformed dates or missing company/role — flag them to the user in one line instead of silently dropping them.

   If the tracker's column names differ from the ones above (this framework has been customized before), infer the closest match by header name and confirm the mapping with the user once at the start rather than guessing silently.

3. **Present the list.** Show each candidate as `Company — Role — applied X days ago — last follow-up: <date or "none">`. If `--dry-run`, stop here.

4. **Let the user pick.** Use the batch as the default selection, but let the user exclude any by name. Don't draft for companies they've marked "still deciding" or similar in tracker notes without asking first.

5. **Gather context per company.** Before drafting, check `documents/applications/<company>_<role>/` for:
   - The job posting text or URL originally used by `/apply`.
   - The cover letter that was sent (for tone and the angle already used — don't repeat the same line verbatim).
   - Any interview or contact notes already logged.

   If no folder exists for a row (tracker was edited by hand, or the application predates this framework), draft from the tracker row alone and tell the user the email will be more generic as a result.

6. **Draft the email.** Keep it short — 3–5 sentences:
   - Reference the specific role and approximate application date.
   - Restate interest without repeating the cover letter's opening line word-for-word.
   - Optionally surface one new, genuine point of relevance (a recent project, a relevant post from `/expand`'s linked sources) — only if it's true and adds signal, never invented.
   - Ask plainly whether there's an update on timeline, and offer to provide anything further.
   - No pressure tactics, no false urgency ("just circling back" tone, not "following up AGAIN" tone).

   Present each draft with a subject line. If a contact name/email is in the tracker or documents folder, address it to them; otherwise draft it generically and note that the user needs to find the right recipient.

7. **Review loop.** Ask the user to approve, edit, or skip each draft. Make requested edits directly rather than re-explaining the whole email.

8. **Log confirmed sends.** For each draft the user confirms they've sent (or will send as-is), update that row in `job_search_tracker.csv`:
   - Set/update `Last Follow-up Date` to today.
   - Set Status to `Followed Up` (unless the user reports a reply already came in, in which case update to whatever that reply indicates).

   Never edit the tracker for a draft the user didn't confirm.

9. **Summarize.** One line per company: drafted / sent / skipped / logged.

## Notes

- This command reads dates as calendar dates from the tracker; if the tracker stores dates in a locale-specific format, ask once rather than assuming.
- If `documents/applications/` contains a rejection notice or interview scheduling email for a company that's still showing `Applied` in the tracker, flag the mismatch to the user before drafting — the tracker may just be stale.
- Threshold defaults to business days, not calendar days, since weekends inflate the wait time and can trigger premature follow-ups.
