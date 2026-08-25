---
name: interview
description: >-
  Prepares the user for a real, scheduled interview on a tracked application.
  Wires together STAR examples, company research, tough questions, and an
  interactive mock interview simulation. Triggers on: interview, interview prep,
  mock interview, interview practice, /interview.
---

# /interview - Prepare for an Interview on a Tracked Application

You are preparing the user for a real, scheduled interview on one of their applications. The frameworks for this already exist in `07-interview-prep.md` (STAR examples, tough questions, questions to ask, roleplay protocol) and the Company Research Checklist in `04-job-evaluation.md`.

`/apply` optimizes what the company reads; `/interview` optimizes what the company hears. The bridge between them is consistency: the interviewer has read the submitted CV and cover letter, so everything prepared here must match what those documents claim.

Follow these steps **in order**.

---

## Step 0: Parse Input

Input may contain a company name (optionally with a role), e.g. `/interview revionics`.

- **With an argument:** match against `job_search_tracker.csv` rows.
- **Without an argument:** list tracker rows whose status suggests a live process (`interview`, `offer`, or recently `applied`) and ask which one.

---

## Step 1: Load the Application Context

1. **The archive:** Check `documents/applications/<company>_<role>/` for `job_posting.md`, `cv_draft.tex`, `cover_letter.tex`, and `outcome.md`.
2. **Fallbacks:** If missing, check `cv/main_<company>*.tex` and `cover_letters/cover_<company>_*.tex` or ask the user.
3. **Ask the user what this interview is:** stage (phone screen / technical / system design / hiring manager / final round), date, format, and interviewer names/titles.
4. **Read the frameworks once:**
   - `.agents/skills/job-application-assistant/07-interview-prep.md`
   - `.agents/skills/job-application-assistant/01-candidate-profile.md`
   - `.agents/skills/job-application-assistant/02-behavioral-profile.md`
   - `.agents/skills/job-application-assistant/04-job-evaluation.md`

---

## Step 2: Research the Company (Interview-Focused)

Check `company_research/<normalized-company-name>.json` cache first per `04-job-evaluation.md`. If missing or stale, execute the Company Research Checklist and write the findings to cache.

- **Interviewer angle:** Note the likely technical/management angle per interviewer.
- **Conversation hooks:** 2-3 recent, verifiable company specifics (product launches, technical papers, engineering blog posts) to reference naturally.

---

## Step 3: Build the Prep Pack

Assemble a stage-appropriate prep document:
1. **Likely questions:** Derived from earlier feedback, candidate fit gaps, posting stack, and stage type.
2. **STAR answer mapping:** Map STAR examples from `07-interview-prep.md` (e.g. Enterprise RAG system, CostChangeWizard microservice, Coinbase Twitter ingestion stream, Goldman Sachs Kafka multiprocessing) to likely questions.
3. **Consistency brief:** Key metrics and claims on the submitted CV to defend.
4. **Tough questions & bridge answers:** "Why this company?", "Tell me about a time something failed", etc.
5. **Questions to ask:** 4-6 smart technical, team, and architectural questions.

Save the pack to `documents/applications/<company>_<role>/interview_prep_<stage>.md` and present the summary in chat.

---

## Step 4: Interactive Mock Interview (Optional)

Ask if the user wants to practice. If yes, run the simulation following the Roleplay Guidelines in `07-interview-prep.md`:
1. Warm-up question
2. Role-specific technical/architecture questions
3. 1-2 behavioral questions
4. 1 curveball question
5. Provide actionable feedback after each response.
