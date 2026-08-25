---
name: reset
description: >-
  Resets candidate profile data and/or documents folder back to a clean state for fresh setup.
  Triggers on: reset profile, reset documents, clear profile, wipe data, /reset.
---

# /reset - Reset Candidate Profile Data

You are resetting parts of the job search framework back to a blank state so the user can start fresh with setup.

**This workflow is destructive.** Nothing is deleted until the user explicitly confirms. Follow these steps exactly in order.

---

## Step 0: Parse Scope from User Input

Check user input for a scope keyword:
- `profile` — clears candidate profile data from skill files only
- `documents` — deletes user-provided files from the `documents/` folder only
- `all` — both of the above

If scope is unspecified, ask:
> **What would you like to reset?**
> - **`profile`** — Clears candidate data from the skill files (profile, behavioral, STAR examples, profile statements). Framework structure and writing rules are preserved.
> - **`documents`** — Deletes all files in `documents/` (CV PDFs, LinkedIn export, diplomas, references, past applications). Folder structure and `README.md` are preserved.
> - **`all`** — Both of the above.

---

## Step 1: Show Exactly What Will Be Cleared

Report precisely what files/folders will be wiped:
- Skill files: `.agents/skills/job-application-assistant/01-candidate-profile.md`, `02-behavioral-profile.md`, `05-cv-templates.md` (statements), `07-interview-prep.md` (STAR examples).
- Documents: `documents/cv/`, `documents/linkedin/`, `documents/diplomas/`, `documents/references/`, `documents/applications/`.
- Preserved: `03-writing-style.md`, `04-job-evaluation.md`, `06-cover-letter-templates.md`, `documents/README.md`.

---

## Step 2: Require Explicit Confirmation

Prompt the user:
> **This action is permanent and cannot be undone.**
> Type **`RESET`** (all caps) to confirm, or anything else to cancel.

Wait for response. If anything other than `RESET` is entered, cancel immediately.

---

## Step 3: Execute Reset

Apply the clean template structure to `.agents/skills/job-application-assistant/` files or remove document files.

---

## Step 4: Confirm Next Steps

Report cleared items and suggest running `setup` when ready.
