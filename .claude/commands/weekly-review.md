# /weekly-review - Weekly Job Search Pipeline Review

You are running a structured weekly review of the user's job search. The goal is a clear picture of where things stand, what's stalled, what needs action, and what to focus on in the coming week.

Follow these steps **in order**. Be honest about what the data shows — a pipeline that looks busy but has no live processes is a problem worth naming, not smoothing over.

---

## Step 1: Load All Data

Read these files:
1. `job_search_tracker.csv` — full pipeline
2. `seen_jobs.json` — all postings ever surfaced
3. `CLAUDE.md` — candidate profile, especially career goals, target roles, and any stated timeline/urgency
4. `documents/applications/` — list subdirectories to count active applications

---

## Step 2: Pipeline Snapshot

Build a status table from the tracker. Group by current status:

| Status | Count | Companies |
|---|---|---|
| Active (applied / interviewing / offer) | | |
| — Applied (awaiting response) | | |
| — Phone/recruiter screen | | |
| — Interview scheduled | | |
| — Offer received | | |
| Closed (rejected / withdrawn / hired) | | |
| Watching (saved, not yet applied) | | |

For each **active** row, show: Company · Role · Applied date · Days since last update · Next action

Flag any application that has had **no update in 14+ days** as stalled. Note that silence after 14 days usually means rejection or deprioritisation — advise the user to either follow up once or mentally close it.

---

## Step 3: Activity Metrics (Past 7 Days)

Count from the tracker and seen_jobs.json:

- **New postings surfaced** (added to seen_jobs.json this week)
- **New applications sent**
- **Responses received** (any stage — recruiter screen, interview invite, rejection)
- **Interviews completed**
- **Offers received**
- **Response rate** = responses / applications sent (rolling, all time)

Present this as a compact summary, not a table — one sentence per metric.

Honest benchmark to apply: a healthy active search typically generates 2–5 applications/week for senior roles, 5–10 for mid-level. A response rate below 10% suggests the CV or targeting needs attention. State this only if the data warrants it.

---

## Step 4: Momentum Assessment

Based on Steps 2–3, assess the search's overall health with one of these verdicts:

- **🟢 Good momentum** — active processes, steady applications, responses coming in
- **🟡 Slowing** — pipeline thin, few new applications this week, some processes stalled
- **🔴 Stalled** — little or no activity, pipeline mostly closed, needs a reset

Give a 2–3 sentence honest diagnosis. Don't soften a 🔴 into a 🟡.

---

## Step 5: Blockers and Risks

Identify the top 1–3 things most likely to derail the search this week. Common ones:

- No new roles being surfaced (run `/rank` with new portals, or broaden search criteria)
- Applications sent but no callbacks (CV or cover letter may need review — suggest `/expand` or adjusting targeting)
- An offer deadline approaching with no decision made
- A negotiation in progress with no strategy (suggest `/negotiate`)
- References not yet lined up (suggest `/references`)
- Interview approaching without prep (suggest `/interview`)

Be specific about which companies/roles each blocker applies to.

---

## Step 6: This Week's Priority Actions

Produce a short, prioritised action list — maximum 5 items. Each item should be:
- Concrete and completable in one sitting
- Tied to a specific company/role where relevant
- Ordered by urgency (deadlines first) then impact

Format:
```
Priority actions for the week of [date]:

1. [Action] — [reason / deadline]
2. [Action] — [reason / deadline]
3. [Action] — [reason / deadline]
```

Where relevant, name the Claude command that executes the action (e.g., "Run `/interview acme` to prep for Thursday's call").

---

## Step 7: Optionally Surface New Roles

If the active pipeline has fewer than 3 live processes, suggest running a fresh search:

> "Your pipeline is thin. Want me to search for new postings? Tell me the role and location and I'll run `/rank`."

Do not run the search automatically — ask first.

---

## Output Format

1. **Pipeline snapshot** (table)
2. **Activity metrics** (this week)
3. **Momentum verdict** (🟢/🟡/🔴 + diagnosis)
4. **Blockers and risks**
5. **Priority actions for this week**
6. Optional: prompt to search for new roles
