---
name: interview
description: >-
  Prepares the user for a real, scheduled interview on a tracked application.
  Wires together STAR examples, company research, tough questions, and an
  interactive mock interview simulation. Triggers on: interview, interview prep,
  mock interview, interview practice, /interview.
---

# /interview - Prepare for an Interview on a Tracked Application

You are preparing the user for a real, scheduled interview on one of their applications. The frameworks for this already exist - `07-interview-prep.md` (STAR examples, tough questions, questions to ask, roleplay protocol) and the Company Research Checklist in `04-job-evaluation.md` - and the `/outcome` archive records which stage the user is at and what earlier stages surfaced. This command wires them together into a stage-specific prep pack and an optional mock interview.

`/apply` optimizes what the company reads; `/interview` optimizes what the company hears. The bridge between them is consistency: the interviewer has read the submitted CV and cover letter, so everything prepared here must match what those documents claim.

Follow these steps **in order**.

---

## Step 0: Parse Input

Input may contain a company name (optionally with a role), e.g. `/interview revionics`.

- **With an argument:** match against `job_search_tracker.csv` rows (case-insensitive on company, then role). One match → proceed. Several → list and ask. None → this application isn't tracked; suggest `/outcome <company>` to register it first, or accept the posting and role details directly if the user wants to prep anyway.
- **Without an argument:** list tracker rows whose status suggests a live process (`interview`, `offer`, or recently `applied`) and ask which one.

---

## Step 1: Load the Application Context

1. **The archive** (started by `/apply`, maintained by `/outcome`): derive `<company>_<role>` by the **Subfolder naming** rule in `documents/README.md`, then use `documents/applications/<company>_<role>/`.
   - `job_posting.md` - the exact posting the user applied to
   - `cv_draft.tex` and `cover_letter.tex` - what was actually submitted. **These are what the interviewer read**; every talking point must be consistent with their claims.
   - `outcome.md` - the stage reached so far and any recorded feedback from earlier stages.
2. **Fallbacks**: posting via `source` URL or user paste; CV via `cv/main_<company>*.tex` and cover letter via `cover_letters/cover_<company>_*.tex`.
3. **Ask the user what this interview is**: stage (phone screen / technical / system design / hiring manager / final round), date, format, and who is interviewing (names and titles).
4. **Read the frameworks once**:
   - `.agents/skills/job-application-assistant/07-interview-prep.md`
   - `.agents/skills/job-application-assistant/01-candidate-profile.md`
   - `.agents/skills/job-application-assistant/02-behavioral-profile.md`
   - `.agents/skills/job-application-assistant/04-job-evaluation.md`

---

## Step 2: Research the Company (Interview-Focused)

**First, check the cache**: read `company_research/<normalized-company-name>.json` per the Company Research Cache section in `04-job-evaluation.md`. If it exists and is within the 30-day TTL, start from it.

If the cache is missing or stale, execute the Company Research Checklist from `04-job-evaluation.md` and write the findings to cache.

Additions for interview purposes:
- **Interviewer angle:** look up public professional background of interviewers.
- **Conversation hooks:** 2-3 recent, verifiable company specifics to reference naturally in answers.

---

## Step 3: Build the Prep Pack

Assemble a stage-appropriate prep document with these sections:

### 1. Likely questions
1. **Recorded feedback from earlier stages** (`outcome.md`)
2. **The fit evaluation's gaps** — bridge answers acknowledging gaps and highlighting learning paths
3. **The posting's stated requirements**
4. **The stage type**

### 2. STAR answer mapping
Match the ready-made STAR examples in `07-interview-prep.md` to likely questions. Ground any additional STAR drafts strictly in `01-candidate-profile.md`.

### 3. Consistency brief
Specific metrics and claims on the submitted CV and cover letter to defend.

### 4. Tough questions, customized
Tough questions with customized answers ("Why this company specifically?", "Tell me about a technical disagreement", etc.).

### 5. Questions to ask
4-6 questions from `07-interview-prep.md` customized to the company and stage.

### 6. Logistics
Phone/video tips, date, interviewers.

Save the pack to `documents/applications/<company>_<role>/interview_prep_<stage>.md`. Present the pack in chat.

---

## Step 4: Offer a Mock Interview

Ask if the user wants to practice. If yes, run the roleplay following Roleplay Guidelines in `07-interview-prep.md`:
1. Warm-up questions
2. Role-specific technical questions
3. 1-2 behavioral questions
4. 1 curveball question
5. Provide actionable feedback after each answer calibrated against `02-behavioral-profile.md`.

---

## Step 5: Close the Loop

End with:
> Good luck. After the interview, run `/outcome <company>` to log the stage and any feedback.

---

## Important Rules

1. **Consistency with the submitted documents.**
2. **Honesty on gaps.**
3. **Verified research only.**
4. **Stage-appropriate prep.**
5. **Write only to the application archive** (except updating `01-candidate-profile.md` if new facts surface).
