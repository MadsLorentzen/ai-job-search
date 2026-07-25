# /autofill - Prefill a job application form

Prefills the application form at `$ARGUMENTS` (a job URL) from `application_profile.json`, attaches the tailored documents, and hands the browser over for review.

**This command never submits an application.** See `.agents/skills/ats-autofill/SKILL.md` for why.

---

## Step 0: Check the setup

```bash
cd .agents/skills/ats-autofill/cli && bun run src/cli.ts doctor
```

If it reports a missing dependency, run the setup and stop until it passes:

```bash
cd .agents/skills/ats-autofill/cli && bun install && bunx playwright install chromium
```

If `application_profile.json` is missing, copy `application_profile.example.json` to `application_profile.json` at the repo root, then walk the user through filling it in. Do not guess contact details or work-authorization answers.

If any profile value is literally `CONFIRM`, stop and ask the user for it before filling. Those placeholders must never reach a real application form.

---

## Step 1: Identify the documents

Determine the company and role from the URL or from the user.

Look for tailored documents from a prior `/apply` run:
- `cv/main_<company>.pdf`
- `cover_letters/cover_<company>_<role>.pdf`

If the tailored PDFs do not exist:
1. Tell the user which documents are missing.
2. Offer to run `/apply <url>` first to produce them.
3. If the user prefers to proceed now, fall back to the master resume at `documents/cv/` and say explicitly that a generic resume is being attached instead of a tailored one.

If the `.tex` files exist but the PDFs do not, compile them first (`lualatex` for the CV, `xelatex` for the cover letter) per `CLAUDE.md`.

---

## Step 2: Inspect before filling

Always inspect first. This touches nothing and shows exactly what the tool would do:

```bash
cd .agents/skills/ats-autofill/cli
bun run src/cli.ts inspect "<job_url>"
```

Present the result to the user as two lists:
- **Will fill** - label, value, and whether it is flagged `<-- CHECK`
- **Needs your input** - fields the tool could not confidently map

If the form asks essay questions (for example "Why do you want to work here?"), draft answers now using `03-writing-style.md` and the company research from `/apply`. Show the drafts to the user. Do not put them in `application_profile.json`, since they are per-application. The user pastes them during review.

---

## Step 3: Fill

Run headed so the user can review in the live browser:

```bash
cd .agents/skills/ats-autofill/cli
bun run src/cli.ts fill "<job_url>" --headed \
  --resume "<abs path to tailored CV pdf>" \
  --cover "<abs path to tailored cover letter pdf>"
```

The process fills the form and then waits. It does not click Submit.

---

## Step 4: Hand off

Tell the user plainly:

1. The browser is open with the form filled, and nothing has been submitted.
2. Which fields need their attention: everything under NEEDS YOUR INPUT, plus everything flagged `<-- CHECK`.
3. Any essay answers drafted in Step 2, ready to paste.
4. That they should verify work authorization, compensation, and EEO answers themselves before submitting.
5. That pressing Enter in the terminal closes the browser once they are done.

A screenshot is written to `job_scraper/autofill_<timestamp>.png` for the record.

---

## Step 5: Track it

Once the user confirms they submitted, append a row to `job_search_tracker.csv`:

```
date,company,sector,role,role_type,channel,status,contact_person,fit_rating,notes,cv_file,cover_letter_file,source
```

Use `status=applied` and set `channel` to the ATS (greenhouse / lever / ashby / workday / other). If the user did not submit, do not add a row.

---

## Rules

1. **Never click Submit**, and never add a flag that would. The human submits.
2. **Never invent** contact details, work-authorization answers, or compensation figures. If the profile lacks a value, ask.
3. **Never fill a compensation field** unless the user has set a figure in `application_profile.json`. Blank beats a number typed before knowing the range.
4. **EEO fields default to decline-to-self-identify.** Only change them if the user explicitly asks.
5. **If the portal blocks automation**, say so and fall back to filling by hand. Do not attempt to defeat bot detection.
6. **LinkedIn Easy Apply, Indeed, and Dice are not supported for filling.** Use them for discovery, then apply via the employer's own ATS link. If only an aggregator link exists, tell the user to apply manually.
