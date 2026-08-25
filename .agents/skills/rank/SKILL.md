---
name: rank
description: >-
  Triage scraped jobs into a ranked shortlist by batch-scoring new postings
  against the candidate profile and evaluation framework. Triggers on: rank,
  rank jobs, shortlist, prioritize jobs, /rank.
---

# /rank - Triage Scraped Jobs into a Ranked Shortlist

You are batch-scoring the jobs that `/scrape` has collected, so the user can decide where to spend `/apply` effort. `/scrape` finds and dedupes postings; `/apply` evaluates one at a time in depth. `/rank` is the bridge: it scores every new posting against the fit framework and returns a ranked shortlist.

`/rank` produces **triage scores**, not final evaluations. It scores from the posting text and the candidate profile only - no company research, no reviewer agent. `/apply`'s Step 1 evaluation (which adds company research) remains authoritative and always re-runs when the user applies.

Follow these steps **in order**.

---

## Step 0: Parse Input

Input may contain:
- Nothing → rank all jobs with status `new` in `job_scraper/seen_jobs.json`
- A focus area (e.g. `/rank ml engineer`) → rank only jobs whose title or stored fit-notes match the focus
- `--all` → re-rank every job that has not been applied to, including previously ranked ones
- `--top <N>` → shortlist size (default 5)

---

## Step 1: Load State

1. Read `job_scraper/seen_jobs.json`. If the file is missing or has no entries, tell the user to run `/scrape` first and stop.
2. Read `job_search_tracker.csv`. Build the exclusion set: any company+role already in the tracker is out of scope regardless of flags.
3. Select candidates: entries with status `new` (or entries of any status with `--all`), minus the exclusion set, filtered by the focus area if one was given.
4. If no candidates remain, say so ("Nothing new to rank - run /scrape to find fresh postings") and stop.
5. Read the scoring framework and profile **once**:
   - `.agents/skills/job-application-assistant/04-job-evaluation.md`
   - `.agents/skills/job-application-assistant/01-candidate-profile.md`

State how many jobs will be ranked before proceeding.

---

## Step 2: Batch-Fetch and Score

Fetch each posting URL (using `read_url_content` or `curl` per `09-web-research.md`) and score **only from actually fetched content**. If a URL is dead or expired, mark `expired`.

For each candidate job, generate scoring data:
```json
{
  "key": "<the job's key in seen_jobs.json>",
  "status": "scored" | "expired",
  "scores": { "technical": 0-100, "experience": 0-100, "behavioral": 0-100, "career": 0-100 },
  "location_verdict": "PASS" | "FAIL" | "FLAG",
  "language_gate": "PASS" | "FAIL" | "FLAG",
  "language_note": "<posting requirement + declared level, only when FLAG or FAIL>",
  "deadline": "YYYY-MM-DD" | null,
  "strengths": ["1-3 bullets, grounded in posting text"],
  "gaps": ["1-3 bullets, honest"],
  "language": "<posting language>"
}
```

---

## Step 3: Aggregate and Rank

1. Compute overall score with weighting from `04-job-evaluation.md` (Technical 30%, Experience 25%, Behavioral 15%, Career Alignment 30%; location is unweighted).
2. Map to verdict bands: Strong Fit (75+), Good Fit (60-74), Moderate Fit (45-59), Weak Fit (30-44), Poor Fit (<30).
3. **Location veto:** `FAIL` excludes the job from the shortlist.
4. **Language veto:** `language_gate: FAIL` excludes the job from the shortlist.
5. **Deadline urgency:** A deadline within 7 days gets a 🔥 marker and wins ties. A past deadline marks `expired`.
6. Sort by overall score (descending), urgency as tiebreaker.

---

## Step 4: Update State

Update `job_scraper/seen_jobs.json` in place:
- Ranked jobs: set `"status": "ranked"`, `"rank_score": <overall>`, `"rank_verdict": "<band>"`, `"rank_date": "YYYY-MM-DD"`, `"location_verdict": "PASS"/"FAIL"/"FLAG"`, `"language_gate": "PASS"/"FAIL"/"FLAG"`, `"strengths": [...]`, `"gaps": [...]`.
- Dead or past-deadline jobs: set `"status": "expired"`.

---

## Step 5: Present the Shortlist

Present the ranked table to the user with title, company, score, verdict, strengths, gaps, and links.
Ask the user if they would like to proceed with `/apply` on any of the shortlisted roles.
