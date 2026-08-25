# /reset - Reset Candidate Profile Data

You are resetting parts of the job search framework back to a blank state so the user can start fresh with `/setup`.

**This command is destructive.** Nothing is deleted until the user explicitly confirms. Follow these steps exactly in order.

---

## Step 0: Parse Scope from Arguments

Check `$ARGUMENTS` for a scope keyword:

- `profile` — clears candidate profile data from skill files only
- `documents` — deletes user-provided files from the `documents/` folder only
- `all` — both of the above

If `$ARGUMENTS` is empty or does not contain a recognized scope keyword, ask:

> **What would you like to reset?**
>
> - **`profile`** — Clears candidate data from the skill files (profile, behavioral, STAR examples, profile statements, personalized evaluation criteria, search queries). The framework structure, scoring framework, and writing rules are preserved. Use this to re-run `/setup` from scratch.
>
> - **`documents`** — Deletes all files you've placed in the `documents/` folder (CV PDFs, LinkedIn export, diplomas, references, pasted job postings, past applications). The folder structure and `README.md` are preserved.
>
> - **`all`** — Both of the above.
>
> Reply with `profile`, `documents`, or `all`.

Wait for the user's response before continuing.

---

## Step 1: Show Exactly What Will Be Cleared

Before doing anything, show the user precisely what will be wiped.

### If scope includes `profile`:

Read the current state of these files and report whether each has content or is already empty:

- `.claude/skills/job-application-assistant/01-candidate-profile.md`
- `.claude/skills/job-application-assistant/02-behavioral-profile.md`
- `.claude/skills/job-application-assistant/04-job-evaluation.md` *(personalized match areas, career goals, and life-situation constraints only — the scoring framework is preserved)*
- `.claude/skills/job-application-assistant/05-cv-templates.md` *(profile statements section only — framework structure is preserved)*
- `.claude/skills/job-application-assistant/07-interview-prep.md` *(STAR examples and STAR candidates sections only — framework structure is preserved)*
- `.claude/skills/job-scraper/search-queries.md` *(role titles, domain keywords, and location terms only — query structure is preserved)*

This list must stay in step with what `/setup` Step 3 populates: every skill file it writes candidate data into is cleared here.

Present as:

```
## Profile reset will clear:

- 01-candidate-profile.md — [has content / already empty]
  Full file will be replaced with a blank template.

- 02-behavioral-profile.md — [has content / already empty]
  Full file will be replaced with a blank template.

- 04-job-evaluation.md — [has personalized criteria / already blank]
  Your match areas, career goals, energizing/draining tasks, and life-situation
  constraints will be restored to placeholders. The scoring framework (dimensions,
  score bands, weights, Language Gate, Company Research Checklist) is preserved.

- 05-cv-templates.md — [has profile statements / already blank]
  Profile statement templates will be cleared. LaTeX structure and tailoring guidelines are preserved.

- 07-interview-prep.md — [has STAR examples / already blank]
  STAR examples and any STAR candidate stubs will be cleared. Framework, tough questions, and roleplay guidelines are preserved.

- job-scraper/search-queries.md — [has personalized queries / already blank]
  Your job boards, role titles, domain keywords, city, and commute tiers will be
  restored to placeholders. The query structure and filter sections are preserved.

The following files are NOT touched (they contain framework rules, not candidate data):
  - 03-writing-style.md
  - 06-cover-letter-templates.md

Outside the profile scope, still holding your personal data: CLAUDE.md and
cv/main_example.tex. This scope covers skill files only.
```

### If scope includes `documents`:

Use Glob to list all files present in `documents/cv/`, `documents/linkedin/`, `documents/diplomas/`, `documents/references/`, `documents/postings/`, and `documents/applications/`. Present as:

```
## Documents reset will delete:

documents/cv/
  - [filename] or "(empty)"

documents/linkedin/
  - [filename] or "(empty)"

documents/diplomas/
  - [filename] or "(empty)"

documents/references/
  - [filename] or "(empty)"

documents/postings/
  - [filename] or "(empty)"

documents/applications/
  - [subfolder/filename] or "(empty)"

documents/README.md — NOT deleted (instructions file)
```

If all document subfolders are already empty, state "All document subfolders are already empty — nothing to delete." and skip the confirmation step for this scope.

---

## Step 2: Require Explicit Confirmation

Present the confirmation prompt:

> **This cannot be undone.**
>
> Type **`RESET`** (all caps) to confirm, or anything else to cancel.

Wait for the user's response.

- If the user types exactly `RESET`: proceed to Step 3.
- If the user types anything else: abort and tell them "Reset cancelled. Nothing was changed."

---

## Step 3: Execute the Reset

### Profile reset

**For `01-candidate-profile.md`**, replace the file content with:

```markdown
# Candidate Profile

<!-- Run /setup to populate this file -->

## Identity

## Education

## Professional Experience

## Independent Projects

## Technical Skills

## Publications

## Awards

## References
```

**For `02-behavioral-profile.md`**, replace the file content with:

```markdown
# Behavioral Profile

<!-- Run /setup to populate this file -->

## Overview

## Strongest Behavioral Traits

## How I Work Best

## Growth Areas

## Mapping to Job Posting Language

## Management Style Preferences

## Using This in Applications
```

**For `04-job-evaluation.md`**, restore the values `/setup` Step 3.4 personalized back to their placeholder tokens, leaving every surrounding line untouched:

| Line to restore | Token |
|---|---|
| `**Strong match areas:**` | `[YOUR_PRIMARY_SKILLS]` |
| `**Moderate match areas:**` | `[YOUR_SECONDARY_SKILLS]` |
| `**Weak match areas:**` | `[SKILLS_YOU_LACK]` |
| `**Strong:**` (Experience Match) | `[YOUR_DIRECT_EXPERIENCE_DOMAINS]` |
| `**Moderate:**` (Experience Match) | `[YOUR_ADJACENT_EXPERIENCE]` |
| `**Entry-level:**` (Experience Match) | `[ROLES_WITH_LIMITED_EXPERIENCE]` |
| the three `**Career goals:**` bullets | `[YOUR_CAREER_GOAL_1]`, `[YOUR_CAREER_GOAL_2]`, `[YOUR_CAREER_GOAL_3]` |
| `- Tasks that energize:` | `[YOUR_ENERGIZING_TASKS]` |
| `- Tasks that drain:` | `[YOUR_DRAINING_TASKS]` |
| `- **Security**:` | `[YOUR_FINANCIAL_SITUATION_CONTEXT]` |
| `- **Flexibility**:` | `[YOUR_SCHEDULE_CONSTRAINTS]` |
| `- **Professional development**:` | `[YOUR_GROWTH_PRIORITIES]` |

Also remove any `## Calibration from Past Applications` section, which `/setup` Path A writes from the user's own application outcomes.

Leave the rest of `04-job-evaluation.md` intact: the five scoring dimensions and their score bands, the weighting, the Language Gate, the red-flag guidance, the Company Research Checklist and cache schema, and the salary benchmark section. If `/setup` Step 3.4 ever personalizes a value not in the table above, add it here too.

**For `05-cv-templates.md`**, locate the section that begins with `**Profile statement templates` and extends through the role-specific template blocks. Replace only that section with:

```markdown
**Profile statement templates:**

<!-- Run /setup to populate role-specific profile statements -->
```

Leave all other content in `05-cv-templates.md` intact.

**For `07-interview-prep.md`**, locate and remove:
- The entire `## Ready-Made STAR Examples` section and all numbered STAR examples under it
- Any `## STAR Candidates (Complete Manually)` section added by `/setup` Path A

Replace with:

```markdown
## Ready-Made STAR Examples

<!-- Run /setup to populate STAR examples from your actual experience -->
```

Leave all other content in `07-interview-prep.md` intact (STAR format explanation, tough questions, questions to ask interviewers, phone/video tips, follow-up etiquette, roleplay guidelines).

**For `.claude/skills/job-scraper/search-queries.md`**, restore the values `/setup` Step 3.8 personalized back to their placeholder tokens:

- **Search Sites**: the board names back to `[YOUR_JOB_BOARD]`, `[YOUR_INDUSTRY_JOB_BOARD]`, `[YOUR_ADDITIONAL_JOB_BOARD]`, and the LinkedIn filter back to `[YOUR_COUNTRY]` / `[YOUR_CITY]`.
- **Query Categories**: the four priority headings back to `[YOUR_PRIMARY_ROLE_TYPE]`, `[YOUR_DOMAIN_EXPERTISE]`, `[YOUR_ADJACENT_ROLE_TYPE]`, and `Broader Technical / Consulting`; inside the query blocks, the titles, skills, and domain terms back to `[YOUR_PRIMARY_JOB_TITLE_1]`, `[YOUR_PRIMARY_JOB_TITLE_2]`, `[YOUR_ADJACENT_TITLE_1]`, `[YOUR_ADJACENT_TITLE_2]`, `[YOUR_KEY_SKILL]`, `[YOUR_DOMAIN_KEYWORD_1]`, `[YOUR_DOMAIN_KEYWORD_2]`, `[YOUR_DOMAIN]`, and the location terms back to `[YOUR_CITY]`, `[YOUR_COUNTRY]`, `[YOUR_REGION]`.
- **Location Filter**: the commute tiers back to `[YOUR_CITY]`, `[ACCEPTABLE_AREA_1]`, `[ACCEPTABLE_AREA_2]`, `[BORDERLINE_AREA]`, `[TOO_FAR_AREA]`.
- Remove any extra priority categories or translated query duplicates `/setup` added beyond the four shipped tiers.

Leave the rest of the file intact: the portal-CLI and WebSearch-fallback explanation, the Language scope note, the "organize by function, not job title" guidance, and the Language, Date, and Adapting Queries sections.

### Documents reset

For each non-empty document subfolder, delete all files within it using Bash `rm`. Do not delete the folder itself, and do not delete `documents/README.md`.

```bash
rm -f documents/cv/*
rm -f documents/linkedin/*
rm -f documents/diplomas/*
rm -f documents/references/*
rm -f documents/postings/*
rm -rf documents/applications/*/
```

---

## Step 4: Confirm What Was Done and Next Steps

After the reset is complete, report:

```
## Reset complete

### Cleared
[List each file/folder that was actually modified or cleared]

### Unchanged
[List anything that was already empty or was intentionally preserved]
```

Then tell the user what to do next based on what was reset:

**If profile was reset:**
> The skill files are now blank. Run `/setup` to repopulate them. The command auto-detects any files in your `documents/` folder and offers to read from there; otherwise it walks you through a CV import or interactive interview.
>
> Note that `CLAUDE.md` and `cv/main_example.tex` are outside the `profile` scope and still hold your personal data. If you are handing this fork over or making it public, clear them by hand.

**If documents were reset:**
> The `documents/` folder is now empty. Add your career documents and run `/setup` to populate your profile. See `documents/README.md` for instructions on what to put where.

**If both were reset:**
> Both your profile files and documents folder are now empty. Add documents to `documents/` (or skip and use the CV import / interview path), then run `/setup`.
