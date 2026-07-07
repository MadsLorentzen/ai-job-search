# Job Evaluation Framework

<!-- SETUP: Skill match areas and career goals are personalized by running /setup -->

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

**Strong match areas:**
- Product-Led Growth (PLG) across B2C / B2B / B2B2C
- **Lifecycle, messaging, and email marketing (depth area, not a side skill)** - Iterable, Segment, Amplitude; 0-to-1 AI Email Marketing at Beacons; DailyPay lifecycle stack
- Experimentation engines (10x velocity track record)
- Pricing & packaging (Beacons 120% revenue lift)
- Growth engineering, full-stack development
- KPI & analytics frameworks, revenue intelligence
- 0-to-1 product launches (Beacons AI Emails, DailyPay WorkLife, Checkmate Enrichment)

**Moderate match areas:**
- AI-driven personalization (built it, but at startup scale not lab scale)
- ML-driven recommendation systems
- Direct-to-consumer / D2C commerce (PitchTop)
- Enterprise PLG hybrid motions (DailyPay, Checkmate)

**Weak match areas:**
- Pure enterprise-sales-led growth (no PLG component)
- Pure-IC roles inside 1000+ person orgs (track record is mostly leadership)
- Pure data science / causal inference ownership (partners with DS, doesn't own)

### 2. Experience Match (0-100)
Does work history align with what they're looking for?

| Score | Meaning |
|-------|---------|
| 80-100 | Direct experience in the same domain and role type |
| 60-79 | Related experience, transferable skills clear |
| 40-59 | Adjacent experience, would need to make the case |
| 0-39 | Unrelated experience |

**Strong:** B2C / B2B / B2B2C SaaS, vertical SaaS for creators, fintech (employee pay), D2C commerce, social/audio, consumer at scale (RockYou 100M+ MAU)
**Moderate:** AI-lab Growth orgs (validated via OpenAI Growth final-round, but not yet inside), enterprise PLG hybrids
**Entry-level:** Frontier AI lab IC roles (pivot from leadership track), pure enterprise-sales-led environments

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

**Career direction:**
- Round out leadership track with senior IC growth work at a frontier AI lab (OpenAI, Anthropic). IC at later-stage AI orgs is explicitly in scope, not just senior/VP roles.
- Keep operating in growth roles where lifecycle/messaging/email and experimentation are the central problem, not bolt-ons.
- Continue fractional growth advisory (Omega Point) in parallel until a stellar full-time role lands.

**Motivation filter:** Evaluate not just whether AJ *can* do the tasks, but whether the tasks will *energize* him. Consider:
- **Tasks that energize:** 0-to-1 product launches with AI as core capability, experiment design end-to-end, growth-loop architecture, pricing/packaging strategy, building data and experimentation infra, lifecycle/personalization systems at scale
- **Tasks that drain:** Pure maintenance, status-meeting-heavy cultures, approval-gated execution, work with no experimentation latitude
- **Non-task factors:** Mission of the company (frontier AI mission is a major draw), degree of autonomy, co-design culture with engineering, quality of the data/experimentation stack

**Life situation alignment:**
- **Location:** Brooklyn-based. Prefers remote. Hybrid/on-site in NYC is fine. Relocation only for a stellar role or comp package.
- **Stage:** Founder of Omega Point in parallel, so fractional opportunities are also viable. Full-time roles are weighted against opportunity cost.
- **Professional development priority:** Time inside a frontier AI lab is a stated growth target, even at IC.

## Confirmed Strong-Fit Signals (Calibration)

- **OpenAI Growth (final round, Jan-mid-May 2026, kept on active pipeline):** AI-lab Growth orgs are a real fit, not aspirational. Use this as evidence when evaluating similar roles (Anthropic, Cohere, Mistral, frontier AI startups with Growth functions).

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
