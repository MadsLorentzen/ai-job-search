# Application operations and session recovery

Read alongside `10-remote-brazil.md` when resuming a search, handling a batch, or
working in a live application portal. This is operating guidance for an authorized
agent; it does not implement a submission adapter or a scheduler.

## Recover evidence before continuing

Identify the public framework checkout and the existing private workspace before
writing candidate information. Reuse the private workspace; do not create a fresh
profile because a new task cannot see the old conversation. Inspect its source
marker, candidate profile, tracker, and application archives. Keep all personal
checkpoints and receipts there, outside the public repository.

Treat another task's summary as a lead to evidence, not proof of completion. Check
that referenced files actually exist and inspect the tracker and saved receipt.
Distinguish recovered files, claims reported by another task, and missing artifacts.
Do not recreate lost leads, drafts, login confirmations, or submission counts from
memory. Browser sessions and visible login state must be checked in the current
session before relying on them.

Keep a short private `reports/session-handoff.md` with the last checked date,
profile and tracker paths, batch scope, completed work with evidence paths,
remaining roles, blockers, and next action. Use paths relative to the private
workspace where possible. Update it before yielding or handing off; it supplements
the tracker rather than introducing a second application ledger. Never store
passwords, verification codes, authentication tokens, or session cookies in it.

## Confirmed facts and portal readiness

Apply the confirmed-fact writeback rule in `/apply` even when the user supplies a
correction during browser work: update private `01-candidate-profile.md` in the same
turn and correct contradictory facts in private `CLAUDE.md` and the master CV.
Record that the user confirmed the fact and when. Keep official employment titles
separate from responsibilities; do not upgrade a title to match a target role.

Before an application, check only the profile fields the portal or employer needs,
including contact details, employment dates, location, authorization, and uploaded
resume. Use already confirmed facts without asking again. Save authorized profile
changes and verify they persisted; filling a field is not proof of a successful save.
If facts or required answers remain unknown, prepare everything independent of them
and ask only for the missing information. Never infer consent answers.

## Authorized batches

Distinguish permission to discover roles, prepare materials, edit a profile, and
submit applications. An explicit request to apply to a batch can authorize repeated
submissions within the user's stated scope; do not require a fresh confirmation
solely because the next employer is different. Retain the user's actual instruction
and constraints in the private handoff. Do not infer submission permission from a
request to draft, or broaden a batch to unrelated roles or additional disclosures.

Follow the active runtime's permissions and any actual approval review decision.
If a tool blocks a disclosure or submission, do not retry through another channel
to bypass it. Finish the reviewable materials, explain the specific blocked action
and reason, and request only the authorization the runtime requires.

Evaluate every role against `10-remote-brazil.md` before applying. Quotas do not
override eligibility, evidence, factual accuracy, or missing-answer requirements.
Report a shortfall honestly instead of counting prepared applications as submitted.

## Submission evidence and interrupted attempts

Use the existing tracker vocabulary and `/outcome` workflow. A draft, an opened
form, or a click on Submit is not a confirmed application. Mark `applied` only after
an employer/portal success confirmation, a submission receipt, or an explicit user
report of submission, identifying which kind of evidence supports the status.
Save the evidence reference and checked date in the private application archive.

If the browser times out or the session ends after submission may have occurred,
record an uncertain attempt in tracker notes and the private handoff, without
inventing a new tracker status or claiming success. Check the portal's application
history or a receipt before retrying, to avoid duplicate applications. Check existing
tracker records and employer/role identity before every new submission.

Report discovered, prepared, confirmed submitted, and blocked/uncertain counts
separately. Do not claim a recurring run is active based on a prior chat message:
verify the saved scheduler configuration and current status. A request to keep
applying authorizes continued work within scope, but does not itself establish an
always-on process. State scheduling limitations when they affect continuation.
