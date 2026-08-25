---
name: setup
description: >-
  Profile onboarding and candidate information setup. Populates AGENTS.md, CV LaTeX templates,
  and profile evaluation files from documents, single CV, or interactive interview.
  Triggers on: setup, profile setup, configure profile, onboard, candidate profile, /setup.
---

# /setup - Profile Onboarding

You are running the onboarding setup for the AI Job Search framework. Your goal is to collect the user's professional information and populate all profile files so the application and scraping workflows work out of the box.

There are three paths into setup. Step 0 picks the right one; all three converge on Step 3 (file generation) and Step 4 (confirmation).

---

## Step 0: Welcome & Choose Path

If the user asked to update a specific section (e.g. `--section <name>`), skip directly to that section in Path C for an update-only flow. Do not run the path-selection prompt below.

Otherwise, before greeting the user, scan the `documents/` folder. Use `list_dir` or file listing on `documents/` and count files per subfolder (`cv/`, `linkedin/`, `diplomas/`, `references/`, `applications/`).

Then welcome the user with a single message that lists three paths. The wording changes based on what was found.

**If `documents/` has files** in one or more subfolders, lead with Path A:

> **Welcome to the AI Job Search setup!**
>
> I'll help you build your professional profile so we can evaluate job postings, tailor CVs, write cover letters, and prepare you for interviews.
>
> I see files in your `documents/` folder: [list per subfolder, e.g. "2 in cv/, 1 in linkedin/, 3 in references/"]. Three ways to start:
>
> **Path A: Read my documents folder** (recommended for what you have) - I'll read everything in `documents/`, cross-reference for consistency, and build your profile from real source materials. Idempotent and safe to re-run as you add more documents.
>
> **Path B: Single CV import** - Paste or provide a single CV/resume here. I'll extract it and ask follow-up questions for what's missing.
>
> **Path C: Interview mode** - I'll walk you through structured questions section by section.
>
> Which would you like?

**If `documents/` is empty or missing**, surface Path A as a "do this if you have materials" option:

> **Welcome to the AI Job Search setup!**
>
> I'll help you build your professional profile so we can evaluate job postings, tailor CVs, write cover letters, and prepare you for interviews.
>
> Three ways to start:
>
> **Path A: Documents folder** (best signal if you have several materials) - Drop your CV / LinkedIn export / diplomas / reference letters in the `documents/` folder, then say "go". I'll read everything and build your profile from it. See `documents/README.md` for the folder layout.
>
> **Path B: Single CV import** - Paste or provide a single CV/resume here. I'll extract it and ask follow-up questions for what's missing.
>
> **Path C: Interview mode** - I'll walk you through structured questions section by section. Good if you're starting from scratch.
>
> Which would you like?

Wait for the user's choice. If they pick A but the folder is still empty, tell them what to add (point at `documents/README.md`) and stop.

---

## Path A: Documents Folder

Reads structured documents in `documents/`, cross-references them for consistency, and merges extracted data into the profile skill files. Read-before-write and idempotent: changes already present will not be proposed again.

Follow these steps **exactly in order**.

### Step A1: Inventory

Scan the full `documents/` tree and print:

```
## Documents Found

**cv/**: [list files, or "(empty)"]
**linkedin/**: [list files, or "(empty)"]
**diplomas/**: [list files, or "(empty)"]
**references/**: [list files, or "(empty)"]
**applications/**: [list subfolders with their files, or "(empty)"]

I will read these and cross-reference before proposing any changes.
```

If every subfolder is empty, stop and tell the user to populate the folder. Point at `documents/README.md` for the layout.

### Step A2: Read Existing Skill Files

Read these in parallel before extracting anything:

- `.agents/skills/job-application-assistant/01-candidate-profile.md`
- `.agents/skills/job-application-assistant/02-behavioral-profile.md`
- `.agents/skills/job-application-assistant/03-writing-style.md`
- `.agents/skills/job-application-assistant/04-job-evaluation.md`
- `.agents/skills/job-application-assistant/05-cv-templates.md`
- `.agents/skills/job-application-assistant/06-cover-letter-templates.md`
- `.agents/skills/job-application-assistant/07-interview-prep.md`

Hold this content in context throughout Path A. Do not re-read.

### Step A3: Parse Documents

Read each document found in Step A1. Process subfolders in this order: `cv/`, `linkedin/`, `diplomas/`, `references/`, `applications/`.

- **`cv/` documents:** name, contact (email, phone, LinkedIn, GitHub), education (degree, institution, dates, thesis), work experience (title, company, dates, location, bullets), skills, publications, awards, profile/summary.
- **`linkedin/` documents:** About/summary section, work experience, education, skills and endorsements, certifications, volunteer work, publications, recommendations received. If multiple LinkedIn exports are present, use the most recently modified file.
- **`diplomas/` documents:** official degree title and level, institution name, graduation date, grade/GPA.
- **`references/` documents:** referee name, title, organization; letter text, specific quotes, competency language.
- **`applications/<company>_<role>/` subfolders:** `job_posting.md`, `cover_letter.tex`, `cv_draft.tex`, `outcome.md`.

### Step A4: Cross-Reference Check

Check for inconsistencies:
- Date mismatches between CV / LinkedIn / diploma
- Title mismatches across documents for the same role
- Education mismatches
- Employer name variations

If inconsistencies are found, present them as a numbered list and wait for the user to resolve each one before continuing.

### Step A5: Build Change Sets & Present

Compare extracted document content against existing skill files and present proposed additive and conflicting changes for user confirmation.

### Step A6: Apply Confirmed Changes and Fill Gaps

Apply changes to the skill files. Ask follow-up questions for gaps:
- Career goals and target role types
- What excites the user in their next role
- Deal-breakers and must-haves
- Salary expectations / baseline (optional)
- Commute or location constraints
- Job search configuration

Then proceed to Step 3.

---

## Path B: Single CV Import

1. Read the provided document/text thoroughly.
2. Extract all structured information: name, contact, education, experience, skills, publications, awards.
3. Present a summary of what was extracted.
4. Ask follow-up questions for gaps (behavioral profile, career goals, deal-breakers, salary expectations, references).
5. Proceed to Step 3.

---

## Path C: Interview Mode

Walk through each section conversationally:
- **Section 1: Identity & Contact** (Full name, location, phone, email, LinkedIn, GitHub, languages, commute constraints)
- **Section 2: Education & Certifications** (Degree levels, fields, institutions, years, thesis, coursework, certs)
- **Section 3: Professional Experience** (Roles, companies, dates, locations, key achievements, tech stack)
- **Section 4: Technical Skills** (Languages, frameworks, domain expertise, tools)
- **Section 5: Publications & Awards** (Papers, conferences, competitions)
- **Section 6: Behavioral Profile** (Work styles, thriving environments, decision making, communication)
- **Section 7: Career Goals & Preferences** (Target roles/industries, excitement, deal-breakers, salary expectations)
- **Section 8: References** (Names, titles, contact, relationships)
- **Section 9: Job Search Configuration** (Role titles, search terms, target companies, geographic tiers)

---

## Step 3: Generate Profile Files

1. **Update `AGENTS.md` and `CLAUDE.md`**: Replace all `[PLACEHOLDER]` tokens with the user's actual information.
2. **Populate `.agents/skills/job-application-assistant/01-candidate-profile.md`**
3. **Populate `.agents/skills/job-application-assistant/02-behavioral-profile.md`**
4. **Update `.agents/skills/job-application-assistant/04-job-evaluation.md`**
5. **Update `.agents/skills/job-application-assistant/05-cv-templates.md`**
6. **Update `.agents/skills/job-application-assistant/07-interview-prep.md`**
7. **Update `cv/main_example.tex`**
8. **Generate `.agents/skills/job-scraper/search-queries.md`**

---

## Step 4: Confirm & Next Steps

Summarize all files generated/updated and prompt the user with next steps:
- Run job search / scrape
- Apply to a specific role
