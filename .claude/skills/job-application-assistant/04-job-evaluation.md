---
framework_version: 1.2.3
---

# Job Evaluation Framework

<!-- SETUP: Skill match areas and career goals are personalized by running /setup -->

## Eligibility Gate — run before scoring

If the candidate is not a citizen or permanent resident of the country they are applying in, run this first. It is a hard filter, not a scoring dimension, and it is separate from work-permit *timing*: timing asks "can they work the required hours yet?", eligibility asks "are they permitted to hold this job at all?". A candidate can pass timing and still be categorically excluded.

Read the posting's eligibility / work rights / "who can apply" section **verbatim** and classify:

| Posting wording | Verdict |
|-----------------|---------|
| Names a **citizenship or permanent-residency requirement** ("must be a citizen of X", "permanent resident", "PR required", "full working rights" where the employer means citizen/PR) | **FAIL — hard stop.** Do not score, do not draft. Quote the exact wording back to the user. |
| Requires a **security clearance** at any level | **FAIL** in most countries, since clearance is normally gated on citizenship. Verify the specific scheme rather than assuming. |
| **Explicitly names** the candidate's permit class, or says "international applicants welcome", "visa holders considered", "we sponsor" | **PASS** — verified acceptance. Worth noting as a positive in the application. |
| **Silent** on citizenship or residency | **PROCEED, but mark unverified.** Check the employer's own careers or international-applicant page before drafting. |

**Two rules that are easy to get wrong:**

1. **Silence is not permission.** Large graduate programs frequently gate eligibility on their own website rather than in the job ad. Highest-risk categories: professional-services firms, government and defence, banking, telecommunications, and anything touching critical infrastructure.
2. **A company-wide "we accept international applicants" statement is not role-level permission.** The common pattern is a general welcome followed by a *named list* of the specific programs or service lines it covers. Confirm the **specific posting or stream** appears on that list before drafting.

**Report an eligibility failure to the user with the quoted source** rather than silently dropping the role. They may know something about their own status that the profile does not record.

If the candidate's permit also constrains *hours* or *start date* (a student visa with a term-time cap, a permit that begins on graduation), record that as a second gate under this section during `/setup`, with the specific dates. Do not merge it with the eligibility question above — they fail for different reasons and need different answers.

A role that fails this gate is not scored and not drafted. Everything below applies only to roles that pass it.

### Candidate-specific timing gate (added by /setup, triple-market search)

The candidate runs a **triple-market search**: UK (Reading-based), Germany (English-speaking roles only), and Ireland (added 2026-08-20).

- **UK roles:** Current Skilled Worker visa expires **February 2027**. The current employer (Cognizant) cannot sponsor a transfer, so a new UK role must come from an employer able to sponsor from scratch. Before scoring any UK posting, check whether the employer is a genuine, active sponsor — an "we sponsor" statement in the posting is not enough on its own; prefer employers with a visible, current sponsor licence. Treat sponsorship uncertainty on a UK posting as a **FLAG**, not an automatic pass — surface it explicitly rather than assuming it will work out, given the Feb 2027 deadline.

#### UK Sponsor Register Check (standard, mandatory for every UK posting)

Don't stop at whether the posting *mentions* sponsorship — cross-check the employer against the UK Home Office's own **Register of Licensed Sponsors: Workers**, the authoritative public source, before scoring or drafting any UK role:

1. **Use the cached copy first.** `job_scraper/uk_sponsor_register.csv` holds the last-downloaded register (gitignored — regenerable, never committed). Check its file mtime: the register updates several times a week, so if the cached copy is more than ~3-4 days old, re-fetch it rather than trusting a stale copy.
2. **To refresh:** WebFetch `https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers` to find the current CSV's direct download URL (it's dated and changes each update), then download it to `job_scraper/uk_sponsor_register.csv`, overwriting the old copy.
3. **Search by company name, but expect legal-entity mismatches.** The register lists the sponsoring *legal entity*, not always the consumer-facing brand — a posting from "Arrive" may only appear under one of its trading brands (e.g. "Flowbird Ltd", "RingGo Limited"). If a direct name search misses, try known parent/subsidiary/brand names before concluding there's no match (check the company's own "about us" page for its registered UK entity name if needed).
4. **Verdict mapping:**
   - **Found, with a "Worker" route (Skilled Worker or Global Business Mobility) at any rating** → sponsorship **PASS** — a genuine, current sponsor. Worth noting as a positive.
   - **Not found after trying plausible name variants** → this is a **stronger signal than ordinary posting-silence** — it means no active licence exists at all, not just that the posting didn't mention one. Don't auto-fail silently: surface it prominently to the user and treat it as a near-blocking FLAG. If pursuing further (e.g. a company that's newly incorporated or plausibly just missed a name-variant search), also check Companies House for a UK legal entity as a secondary signal, the same way the Reap evaluation did on 2026-08-21 before it correctly stopped rather than drafting for a role with no verified UK sponsor.
5. This check happens at **both** `/rank` triage and `/apply`'s Step 1 full evaluation — triage should surface the result (PASS/no-match) in the shortlist output, and `/apply` re-verifies since a licence can change between triage and application.
- **Germany roles:** No sponsorship dependency — the candidate plans to relocate independently via the **Chancenkarte (Opportunity Card)**, for which they are eligible but have not yet submitted an application. This route does not require the employer to sponsor a work permit on day one, so a German posting should **not** be failed or flagged for silence on sponsorship the way a UK posting would be. It still must pass the Language Gate below (English-speaking role required — the candidate's German is A0).
- **Ireland roles:** No independent route equivalent to the Chancenkarte — treated the same as UK roles. Only pursue roles where the employer can sponsor an Irish employment permit (Critical Skills Employment Permit or General Employment Permit). Treat sponsorship silence on an Ireland posting as a **FLAG**, never an automatic pass, the same as a UK posting.

## Language Gate — run before scoring

This gate checks a posting's language requirements against what the candidate actually speaks. It is not one of the five Scoring Dimensions below - it runs before them, structured the same way as the Eligibility Gate above: read the posting, classify against profile data, and treat a hard mismatch as FAIL before scoring. Its verdict is tracked downstream: `/rank` records the result as `language_gate` (PASS/FAIL/FLAG) with a supporting `language_note`, persists both into `seen_jobs.json`, and treats a FAIL as a shortlist veto; `/scrape` surfaces the flag in its results table and carries a language-override rule for postings whose ad language differs from the role's working language. `/apply`'s language detection (Step 1, which extracts a posting's required language generically) feeds this same check.

Read the posting's language requirements as stated for **the role itself** — not the language the ad happens to be written in. A posting written in a language you don't work in, for a role that only needs languages you do work in on the job, passes fine; only an explicit job-condition requirement ("fluent X required," "must communicate with the Y team in Z") triggers this check. For each language the posting requires as a job condition, compare it against your Languages table in CLAUDE.md / `01-candidate-profile.md`:

| Posting requirement vs. your Languages table | Verdict |
|---|---|
| Requires a language **not on your table at all** (e.g. "fluent Polish required," "must communicate with the Warsaw team in Russian," and you list no Polish/Russian row) | **FAIL — hard stop.** Do not score, do not draft. Quote the exact requirement line. |
| Requires a language you **do** list, but the posting's stated bar (as written — "fluent," "native," "C1+," "business-level") reads as plausibly **higher** than your declared level | **FLAG, then proceed.** Not a fail. Score and draft normally, but surface the gap explicitly in your report to the user (quote both the posting's requirement and your declared level) so they can judge it themselves — bars like "fluent" vary a lot by company and geography, and a recruiter may be flexible. Never silently drop the posting and never silently treat it as a clean pass. |
| Requires a language you list, at or below your declared level (or the posting doesn't specify a level at all — just names the language) | **PASS.** No note needed. |

Judge the level comparison the same way you judge everything else in this framework: read both sides as written and reason about it, don't force either into a rigid scale — CEFR letters, LinkedIn-style buckets ("professional working proficiency"), and plain-English words ("conversational," "fluent," "native") all appear in the wild and don't map onto each other precisely. When genuinely unsure whether a stated bar exceeds the candidate's level, prefer FLAG over a silent PASS — the human is meant to be the tiebreaker, not the gate.

**Worked example:** a candidate whose Languages table lists Spanish (Native) and English (B1/B2). A posting requiring "fluent Russian" → **FAIL**, Russian isn't declared at all. A posting requiring "fluent English" → **FLAG**, English is declared but "fluent" plausibly exceeds B1/B2 — score and draft the application, but tell the candidate this posting's bar may be a stretch and let them decide. A posting requiring "conversational English" or unspecified English → **PASS**, B1/B2 clears a "conversational" bar cleanly.

## Scoring Dimensions

Evaluate each job posting against these five dimensions:

### 1. Technical Skills Match (0-100)
How well do the required/preferred skills align with the candidate's capabilities?

| Score | Meaning |
|-------|---------|
| 80-100 | Core requirements are primary skills |
| 60-79 | Most requirements match, 1-2 gaps that are learnable |
| 40-59 | Partial match, significant upskilling needed |
| 0-39 | Fundamental mismatch |

**Strong match areas:** Product ownership / backlog management, epic & user story elaboration, acceptance criteria, agile delivery (Scrum, SAFe, PI Planning), digital payments domain (tokenisation, EMV, virtual cards, wallet integrations with Google Pay/Samsung Pay, issuer push provisioning), regulatory compliance delivery (RBI, PCI), stakeholder management, AI-augmented delivery workflows (Gemini)
**Moderate match areas:** Pre-sales / solution architecture, business case development, commercial modelling & bid management (RFP/RFI), Go-to-Market strategy, B2B integration specs, cross-functional dependency management at scale
**Weak match areas:** Hands-on software engineering/coding (last coded professionally 2010-2012, Java), data science / ML, languages beyond English/Bengali/Hindi (German is A0), UX/design

### 2. Experience Match (0-100)
Does work history align with what they're looking for?

| Score | Meaning |
|-------|---------|
| 80-100 | Direct experience in the same domain and role type |
| 60-79 | Related experience, transferable skills clear |
| 40-59 | Adjacent experience, would need to make the case |
| 0-39 | Unrelated experience |

**Strong:** Product Owner / Product Manager roles in digital payments, wallets, card networks, and fintech; Delivery Manager / Agile Delivery Lead roles in regulated environments
**Moderate:** Pre-Sales / Solutions Consultant roles in fintech or banking; Senior/Lead Product Owner or Product Manager roles (a step up in seniority from current IC-level PO)
**Entry-level:** Roles outside payments/fintech domain (banking, insurance, other regulated adjacent domains) — transferable delivery and product skills, but domain knowledge would need to be built

### 3. Behavioral/Culture Fit (0-100)
Does the role and company culture match the behavioral profile?

| Score | Meaning |
|-------|---------|
| 80-100 | Culture strongly matches behavioral preferences |
| 60-79 | Mixed signals but mostly compatible |
| 40-59 | Some friction areas |
| 0-39 | Significant culture mismatch |

**Red flags to research:** Department disorganization, work dominated by maintenance over development, poor chemistry with leadership, culture mismatches. Check reviews, media coverage, LinkedIn connections, and network contacts for insider perspective.

### 4. Location & Logistics (Pass/Fail + Notes)
- Within commute range: PASS
- Remote with occasional office: PASS
- Requires relocation: FAIL (deal-breaker)
- Frequent international travel: FLAG (discuss with user)

### 5. Career Alignment & Motivation (0-100)
Does this role advance career goals and contain tasks that energize?

| Score | Meaning |
|-------|---------|
| 80-100 | Strongly aligned with career direction, clear growth path |
| 60-79 | Good role but only partially aligned with long-term goals |
| 40-59 | Decent job but doesn't build toward career goals |
| 0-39 | Dead end or backwards step |

**Career goals:**
- Continue owning digital payments / wallet / card network products, ideally stepping up to Senior or Lead Product Owner / Product Manager level
- Stay close to regulated, high-complexity delivery environments where the payments and compliance domain expertise compounds
- Keep AI-augmented delivery (backlog drafting, requirements analysis) as a core part of the working style, not a side skill

**Motivation filter:** Evaluate not just whether you *can* do the tasks, but whether the tasks will *energize* you. Consider:
- Tasks that energize: End-to-end feature ownership from backlog to launch, complex B2B partner integrations (e.g. Google/Samsung wallets), managing high-impact delivery squads, navigating regulated technical compliance frameworks
- Tasks that drain: Repetitive manual status reporting, lack of delivery autonomy, unmapped/shifting product requirements without clear stakeholder consensus
- Non-task factors: leadership style, department culture, company values, degree of autonomy

**Life situation alignment:** Consider personal constraints:
- **Security**: Current UK Skilled Worker visa expires February 2027; current employer (Cognizant) cannot sponsor a transfer. UK opportunities are time-pressured and depend on landing an actively-sponsoring employer well before that deadline. Germany opportunities via the Chancenkarte are not sponsorship-dependent and offer an alternative path that isn't gated by the same clock.
- **Flexibility**: [YOUR_SCHEDULE_CONSTRAINTS] <!-- not yet captured - ask directly if relevant -->
- **Professional development**: Deepening product/PM seniority in payments and fintech; open to broadening into adjacent regulated domains if it accelerates career progression

### 6. Salary Benchmark (Optional)

If the salary lookup tool is configured (`salary_data.json` exists), look up the company:
```
python salary_lookup.py "<Company Name>" --json
```

If a city is known from the posting, add `--city "<City>"` to narrow results.

Present findings as:
```
### Salary Benchmark
| Metric | Value |
|--------|-------|
| [Category] index | XX.X (+/-X.X% vs baseline) |
| Overall index | XX.X (+/-X.X% vs baseline) |
```

Interpret results relative to the baseline defined in the data file's metadata. For index-based data, higher typically means above-market compensation.

If the salary tool is not configured, skip this section.

## Output Format

Present the evaluation as:

```
## Job Fit Evaluation: [Role] at [Company]

| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | XX/100 | [brief note] |
| Experience Match | XX/100 | [brief note] |
| Behavioral Fit | XX/100 | [brief note] |
| Location | PASS/FAIL | [brief note] |
| Career Alignment | XX/100 | [brief note] |

**Overall Score: XX/100** (weighted average of scored dimensions)

### Verdict: [Strong Fit / Good Fit / Moderate Fit / Weak Fit / Poor Fit]

### Key Strengths for This Role
- [bullet points]

### Gaps to Address
- [bullet points]

### Recommendation
[1-2 sentences: apply/skip/apply with caveats]

### Company Research Checklist
- [ ] Checked company website (mission, values, recent news)
- [ ] Checked review sites (Glassdoor, Jobindex, etc.)
- [ ] Checked LinkedIn for team size, recent hires, connections
- [ ] Checked media for restructuring, growth, or workplace issues
- [ ] Identified network contacts who may know the team/manager
```

## Weighting
- Technical Skills: 30%
- Experience Match: 25%
- Behavioral Fit: 15%
- Career Alignment: 30%

(Location is pass/fail, not weighted)

## Thresholds
- **Strong Fit** (75+): Definitely apply, tailor everything
- **Good Fit** (60-74): Apply, address gaps in cover letter
- **Moderate Fit** (45-59): Consider carefully, discuss with user
- **Weak Fit** (30-44): Probably skip unless strategic reasons
- **Poor Fit** (<30): Skip

**Germany/Ireland override (added 2026-08-20):** the thresholds above assume domain fit matters as much as the weighting implies. For Germany and Ireland specifically, the candidate has said landing a job (and the resulting visa/permit) takes priority over staying in payments/fintech — so a Moderate or even Weak Fit score driven by the domain-heavy dimensions (Technical Skills, Career Alignment) should still be actively surfaced and discussed, not defaulted to "probably skip," as long as Location and the relevant sponsorship/Eligibility gate are clean (Germany: PASS; Ireland: a genuine sponsor, not silence). Still flag genuine execution-risk gaps honestly (years-of-experience shortfalls, missing named hard requirements) — those aren't waived by this override, only the domain-fit penalty is. This override does not apply to UK postings.

## Persistence — write every evaluation back to seen_jobs.json

**Any time this framework is applied to a job that has an entry in `job_scraper/seen_jobs.json`** — via `/rank`'s batch triage, `/apply`'s Step 1, or an ad-hoc "evaluate X" / "fact check this" request outside either command — update that entry's `rank_score`, `rank_verdict`, and `rank_date` (today's date) to the result of *this* evaluation before presenting it to the user. If the Location or Language Gate verdict changed, update `location`/`language_gate` (and `language_note`) too.

This is not optional bookkeeping: the dashboard (`job_scraper/serve_dashboard.js`) reads these fields directly, and a deeper re-evaluation that only lives in chat leaves the dashboard silently showing the stale `/rank` triage score indefinitely — exactly the kind of gap a later session (or the user, mid-decision) can't detect without re-asking. `/rank`'s Step 4 already does this as part of its normal flow; this rule extends the same discipline to every other path that produces a score, including one-off requests that were never routed through `/rank` or `/apply` at all.

Locate the entry by matching the job's URL (or company+title key) against `seen_jobs.json`. If no entry exists yet (a posting evaluated directly from a pasted URL/text that `/scrape` never saw), skip this — there is nothing to update.

**If research corrects the company name** (a mis-scraped tag, a rebrand, a duplicate-listing consolidation — e.g. "Avarda UK" → "Avarda Group" after confirming the actual legal entity), update `seen_jobs.json`'s `company` field to match, not just the tracker row. The dashboard joins application status by `company + title`, both lowercased, so a corrected name in the tracker that isn't mirrored back into `seen_jobs.json` breaks the join silently — the entry keeps showing "Not applied" even after a CV is drafted or the role is applied to. This has recurred three times in one session (Awin/Awin Global, N26/N26 GmbH, Avarda UK/Avarda Group); treat any company-name correction as a two-file edit, always.

**The same join breaks on the role/title side too, and is easier to trigger by accident.** `normalizeRole()` in `dashboard_lib.js` only strips a trailing gender-marker suffix like "(m/w/d)" — it does NOT strip other parenthetical additions such as a seniority/team qualifier. When writing the tracker row's role column, copy the `seen_jobs.json` entry's `title` field verbatim (character-for-character) rather than re-typing or embellishing it — e.g. do not write "Manager, Product Manager (SME)" in the tracker if `seen_jobs.json` has `"title": "Manager, Product Manager"`, even if "(SME)" is an accurate descriptor from the posting. This exact mismatch happened once already (Mastercard "Manager, Product Manager" vs. tracker's "Manager, Product Manager (SME)"), silently leaving the role stuck on "Not applied" in the dashboard despite a completed, tracked application.

## Pre-Application: Call the Employer (Best Practice)

Before writing the application, consider whether the candidate should call the contact person listed in the posting. **Only call if there are substantive questions** - never call just to "be remembered."

### When to Suggest Calling
- The posting has unclear or ambiguous requirements
- It's unclear which competencies are essential vs. nice-to-have
- The role description is vague about day-to-day tasks
- There's a named contact person who invites questions

### Good Questions to Ask
- "What are the primary challenges in this role?"
- "How is time typically divided across the listed responsibilities?"
- "Which competencies are most critical for success in this position?"
- "What does success look like in the first 6-12 months?"

### Rules for the Call
- Prepare a 30-second "elevator pitch" about your background in case they ask
- The call's purpose is **gathering information**, not delivering a pitch
- Take notes - use what you learn to tailor the application
- Reference the conversation naturally in the cover letter ("After speaking with [name], I was especially drawn to...")
