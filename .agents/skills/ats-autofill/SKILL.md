---
name: ats-autofill
description: >
  Prefills US job application forms (Greenhouse, Lever, Ashby, Workday, and generic forms)
  from a local profile, attaches the tailored resume and cover letter, screenshots the result,
  and hands the browser over for human review. Never submits.
  Triggers on: autofill, fill application, apply to job, /autofill
---

# ATS Autofill

Fills out a job application form so the only thing left is reading it and clicking Submit.

## The one rule

**This skill never clicks Submit.** Not on Greenhouse, not on Lever, not anywhere. It fills, screenshots, reports, and stops.

Three reasons, and none of them are negotiable:

1. **Terms of Service.** Automated submission on LinkedIn, Indeed, and Dice violates their terms and risks permanent suspension of the accounts the job search itself depends on. Losing a LinkedIn account to save thirty seconds per application is a bad trade.
2. **Legal attestation.** Application forms ask about work authorization, prior employment, compensation, and EEO status. Those answers are attested statements. A human confirms them.
3. **Recoverability.** A wrong field caught before submitting costs nothing. Caught after, it costs the application, and sometimes the relationship with that employer.

If a future change makes this tool submit automatically, that change is wrong.

## Setup

```bash
cd .agents/skills/ats-autofill/cli
bun install
bunx playwright install chromium
```

Then copy the profile template and fill it in:

```bash
cp application_profile.example.json application_profile.json
```

`application_profile.json` is gitignored. It holds contact details and work-authorization answers, so it never gets committed.

Verify the setup:

```bash
cd .agents/skills/ats-autofill/cli && bun run src/cli.ts doctor
```

## Usage

**Inspect first.** See what would be filled without touching the page:

```bash
bun run src/cli.ts inspect https://job-boards.greenhouse.io/acme/jobs/1234567
```

**Then fill, with the browser visible:**

```bash
bun run src/cli.ts fill https://job-boards.greenhouse.io/acme/jobs/1234567 --headed \
  --resume ../../../../cv/main_acme.pdf \
  --cover ../../../../cover_letters/cover_acme_ai_engineer.pdf
```

With `--headed`, the browser opens, the form fills, and the process waits. Review every field, submit by hand, then press Enter in the terminal to close the browser.

## How it decides what to fill

`src/matcher.ts` holds pure, unit-tested matching logic (`bun test`). For each form field it derives a label (aria-label, `<label for>`, ancestor label, fieldset legend, placeholder, name) and matches it against the profile.

Three behaviors worth knowing:

- **Sponsorship polarity is resolved explicitly.** "Do you require sponsorship?" and "Are you authorized to work without sponsorship?" get opposite answers from the same profile data. This is the single most dangerous class of field to auto-answer, so it is handled by a dedicated resolver with its own tests rather than by a generic keyword rule.
- **Compensation is never volunteered.** `desiredSalary` and `currentSalary` default to null and stay blank. A blank box is a better negotiating position than a number typed before you knew the range. Set the value in the profile if you want it filled, and it will be flagged for review.
- **Low confidence means unfilled.** When no rule matches confidently, the field is left alone and listed under NEEDS YOUR INPUT. The tool never invents a plausible answer to a question it does not understand.

Fields marked `<-- CHECK` in the output were filled from heuristic rules. Read those before submitting.

## What it does not do

- Does not submit, under any flag
- Does not create accounts or log in. Log in yourself first if the portal requires it, or use `--headed` and authenticate in the open browser.
- Does not defeat CAPTCHAs or bot detection. If a portal blocks automation, fill that one by hand.
- Does not answer essay questions ("Why do you want to work here?"). Those come from `/apply`, which writes them against the actual posting.

## Coverage

| ATS | Detection | Notes |
|-----|-----------|-------|
| Greenhouse | URL | Best coverage. Standard labels, native file inputs. |
| Lever | URL | Good coverage. |
| Ashby | URL | Good coverage. Some custom React widgets are skipped and reported. |
| Workday | URL | Partial. Multi-step wizards need manual navigation between steps; re-run per step. |
| Generic / company-hosted | fallback | Works when labels are semantic. Reports whatever it cannot map. |

LinkedIn Easy Apply, Indeed, and Dice are deliberately unsupported for filling. Use them to find the posting, then apply on the employer's own ATS link where one exists.
