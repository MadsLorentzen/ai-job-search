# /negotiate - Salary & Offer Negotiation Strategy

You are preparing the user for a salary or offer negotiation on a tracked application. This command produces a concrete negotiation strategy, an opening script, and ready-to-send email/message drafts — not generic advice.

Follow these steps **in order**.

---

## Step 0: Parse Input

`$ARGUMENTS` may be a company name or offer details pasted inline, e.g. `/negotiate acme` or `/negotiate acme base=80k equity=0.1%`.

- **With a company name:** match against `job_search_tracker.csv` (case-insensitive). One match → proceed. Several → list and ask. None → ask for the company, role, and offer details directly.
- **With offer details pasted:** parse them and proceed — no tracker lookup needed.
- **Without an argument:** list tracker rows with status `offer` and ask which one.

---

## Step 1: Load Context

Read in this order:

1. `CLAUDE.md` — candidate profile, especially:
   - Location and commute constraints
   - Seniority level and total years of experience
   - Target roles and career goals
   - Any salary expectations or constraints already noted
2. The tracker row for the matched company/role (`job_search_tracker.csv`)
3. The application archive at `documents/applications/<company>_<role>/` if it exists:
   - `job_posting.md` — original posting (salary range, level, location)
   - `cv_draft.tex` — what was submitted
4. `documents/salary_data/` — any salary benchmark files the user has (from `/salary` runs or manually placed CSVs)

If salary data files are missing, note that benchmarking will use web search instead.

---

## Step 2: Research Market Rate

Use web search to find current compensation benchmarks for this role, level, and location. Search for:

- `"[role title] salary [city/country] [year]" site:levels.fyi OR site:glassdoor.com OR site:linkedin.com/salary`
- `"[role title] [industry] total compensation [year]"`
- Any recruiter or industry salary survey results from the past 12 months

Extract:
- **Base salary range** (p25, median, p75)
- **Bonus / variable pay** norms for this role/industry
- **Equity** norms (if applicable — startup vs. public company differs significantly)
- **Benefits** commonly included at this level (pension, health, remote budget, etc.)

State your sources and note any uncertainty. If data is sparse, say so honestly.

---

## Step 3: Analyze the Offer

If an offer has been shared, extract and present:

| Component | Offered | Market p25 | Market median | Market p75 |
|---|---|---|---|---|
| Base salary | | | | |
| Bonus/variable | | | | |
| Equity | | | | |
| Pension/benefits | | | | |
| **Total comp (estimated)** | | | | |

Assess: is this offer below/at/above market? Note any non-salary factors (remote flexibility, title, growth path) that affect total value.

If no offer numbers were provided, skip the table and proceed to Step 4 to help the user prepare before receiving the offer.

---

## Step 4: Build Negotiation Strategy

### Opening position
State the specific number or range to ask for, grounded in the market data from Step 2 and the offer analysis from Step 3. The opening ask should be slightly above the target to leave room to land where the user wants.

Rule: never anchor below the current offer. If the offer is already above market median, state that honestly.

### Priority order
Rank what to push for first if the employer can't move on base:
1. Signing bonus (often easier to grant — one-time, no ongoing cost)
2. Equity / vesting acceleration
3. Remote / flexible work arrangements
4. Extra vacation days
5. Professional development budget
6. Title / level adjustment (has long-term comp implications)

### Walk-away point
Ask: "What is the minimum you'd accept?" If not stated, flag this as something the user must decide before the conversation — going in without a walk-away number is a negotiation risk.

### Handling common pushbacks
Prepare short, honest responses to:
- "This is the best we can do / the band is fixed"
- "You don't have enough experience to justify more"
- "We need to know your answer by [date]"
- "What are you currently making?" (jurisdiction-dependent — note if this question is illegal in the user's location)

---

## Step 5: Draft Communication

Produce **two ready-to-use drafts** — pick the appropriate one based on how the offer was communicated:

### Draft A: Counter-offer email
Subject line included. Professional, warm, non-adversarial. Specific about the ask. Thanks the employer genuinely. Under 200 words.

### Draft B: Verbal opening script (phone/video call)
A 60-second spoken script the user can adapt. Covers: genuine enthusiasm for the role → transition to compensation → specific counter → invitation to discuss.

Both drafts must:
- Reference specific numbers (not vague "a bit more")
- Not reveal the walk-away point
- Not lie about competing offers unless the user confirms one exists

---

## Step 6: Update Tracker

After presenting the strategy and drafts, remind the user to log the outcome:
- Run `/outcome <company>` to update the tracker with negotiation notes and final agreed terms once resolved.

---

## Output Format

1. **Offer snapshot** (table from Step 3, or note if no offer yet)
2. **Market rate summary** (range + sources)
3. **Negotiation strategy** (opening position, priority order, walk-away prompt, pushback responses)
4. **Draft A — counter-offer email**
5. **Draft B — verbal script**
6. Reminder to run `/outcome` once resolved
