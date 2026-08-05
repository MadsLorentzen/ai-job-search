---
framework_version: 1.2.2
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

## Language Gate — run before scoring

No dimension or gate anywhere in this framework currently checks a posting's language requirements against what the candidate actually speaks - it is not one of the five Scoring Dimensions below, not a field `/scrape` or `/rank` track, and not something `/apply`'s language detection (Step 1, which already extracts a posting's required language generically) has anywhere to report to. This gate adds that check, structured the same way as the Eligibility Gate above: read the posting, classify against profile data, and treat a hard mismatch as FAIL before scoring.

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

**Strong match areas:** Go (50+ microservices, event-driven, GCP) · C#/.NET Core & .NET Framework, Entity Framework, ASP.NET MVC, Web APIs · Java/J2EE/Spring/Hibernate · distributed systems & microservices · REST API design · event-driven architecture · PostgreSQL / SQL Server / Oracle, schema design and query optimization · Microsoft Azure (DevOps, Application Insights, Blob Storage) · CI/CD pipelines · unit testing & TDD · technical mentorship and team leadership · AI-assisted engineering (Claude Code, Codex, custom skills, MCP servers)

**Moderate match areas:** Google Cloud Platform (1 year, at Moov) · OpenTelemetry / observability · TypeScript & Angular (real but secondary to backend) · Infrastructure as Code · geospatial/GIS (deep but dated — 2009-2010) · Docker & Kubernetes (**coursework only, no production evidence — do not claim as expertise**)

**Weak match areas:** Python · Rust · React/Vue · mobile (iOS/Android) · data engineering / ML / data science · AWS (Azure and GCP are the documented clouds) · Kafka (coursework only) · front-end-heavy or design-led roles

### 2. Experience Match (0-100)
Does work history align with what they're looking for?

| Score | Meaning |
|-------|---------|
| 80-100 | Direct experience in the same domain and role type |
| 60-79 | Related experience, transferable skills clear |
| 40-59 | Adjacent experience, would need to make the case |
| 0-39 | Unrelated experience |

**Strong:** Distributed backend systems at scale (26 years) · enterprise SaaS built 0-to-1 · senior/lead IC roles · leading small distributed engineering teams (7 engineers) · regulated domains where correctness is non-negotiable · **payments / fintech — ~4 years, recent and contiguous (Brightwell 2022–2025, Moov 2025–2026), plus 5 months at VGM in 2014-15**

<!-- ACCURACY GUARD: payments experience is FOUR years, not 26. Verizon Business (2000–2006) was
     telecom revenue management and billing audit — adjacent financial-data work, NOT fintech, and
     never to be counted toward payments tenure. When a posting rewards domain depth, the honest
     claim is "four years in payments, current through 2026" — lead with recency and the specific
     systems (ReadyRemit, cross-border, Visa/Mastercard), never with duration. -->

**Moderate:** Large-scale financial data *outside* payments (Verizon revenue management and billing audit, 2000–2006) · Government / public sector (DHS via Deloitte, Naval Oceanographic Office via Radiance — strong but 2009-2014 vintage) · DevOps / platform engineering (real ownership, not a dedicated title) · consulting and client-facing delivery (Far Reach, Deloitte, BearingPoint) · healthcare / DME systems (5 months at VGM)

**Entry-level:** Formal people-management titles (has *done* one-on-ones, performance feedback and hiring, but every title held is senior/lead IC — see Career Alignment note below) · data/ML engineering · developer-relations or product roles

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

Base: **Cedar Falls, IA 50613** (Waterloo–Cedar Falls area). Search is **remote-first, US-wide**;
relocation is not currently on the table.

- Fully remote, US-wide: **PASS**
- Remote, US with occasional travel to a hub (roughly quarterly or less): **PASS**
- Remote but restricted to states/timezones that exclude Iowa (US Central): **FAIL** — check the
  posting's state-eligibility list, which is frequently buried and often excludes IA
- Hybrid requiring regular on-site days outside the Waterloo–Cedar Falls area: **FAIL**
- On-site within commuting distance of Cedar Falls / Waterloo: **PASS**
- Requires relocation: **FAIL** (deal-breaker)
- Frequent international travel: **FLAG** (discuss with user)

**Watch for the remote-in-name-only pattern:** a posting titled "Remote" that later specifies
"must be located in <metro>" or lists approved states. Read the full location section before
scoring this dimension PASS.

### 5. Career Alignment & Motivation (0-100)
Does this role advance career goals and contain tasks that energize?

| Score | Meaning |
|-------|---------|
| 80-100 | Strongly aligned with career direction, clear growth path |
| 60-79 | Good role but only partially aligned with long-term goals |
| 40-59 | Decent job but doesn't build toward career goals |
| 0-39 | Dead end or backwards step |

**Career goals** (confirmed with candidate 2026-08-05 — three parallel tracks, all in play):

1. **Senior / Staff backend engineer (Go, .NET)** — the direct continuation and the strongest,
   most recent evidence base. Score these highest on Technical and Experience.
2. **Fintech / payments specifically** — a narrower target with a stronger match story
   (ReadyRemit cross-border platform, Visa/Mastercard integrations, Moov). A payments-domain
   posting should score *above* an equivalent generic backend role on Career Alignment — but the
   differentiator is **recency and system specifics, not duration**: ~4 contiguous years current
   through 2026, at two payments companies. Do not inflate this to career-length.
3. **Engineering management / tech lead** — has done the work (team of seven, one-on-ones,
   performance feedback, hiring, mentorship with a measured 25% onboarding gain) without holding
   a formal manager title. Score these on demonstrated responsibility, not job titles; a
   player-coach or tech-lead framing fits the evidence better than a pure people-management role.

Because all three are active, a posting only needs to satisfy **one** track to be worth scoring —
do not penalize a strong backend IC role for lacking a management path, or vice versa. Do flag
which track a posting serves in the evaluation notes so the CV can be framed accordingly.

**Motivation filter:** Evaluate not just whether you *can* do the tasks, but whether the tasks will *energize* you. Consider:
- **Tasks that energize** *(inferred from the pattern of roles taken, not yet confirmed —
  correct these)*: building systems 0-to-1; architecture and technical direction; hands-on coding
  retained alongside leadership; mentoring and code review; reliability/observability work;
  adopting new tooling deliberately (Go, Claude Code, OpenTelemetry).
- **Tasks that drain** *(NOT CONFIRMED — needs your input)*: unknown. Worth answering before
  `/apply` runs, since this is what separates a role you can do from one you'd want. A useful
  prompt: which parts of the Moov or Brightwell job did you find yourself avoiding?
- Non-task factors: leadership style, department culture, company values, degree of autonomy

**Life situation alignment:**
- **Security**: Between roles since 07/2026 and available immediately, which raises the value of a
  shorter interview loop and a firm start date. Do not let this weaken salary positioning — 26
  years of senior engineering experience, plus current payments-platform work, are the
  negotiating position.
  *(Financial runway / urgency not recorded — tell me if there's a timeline that should
  reprioritize speed over fit.)*
- **Flexibility**: US Central timezone. Remote-first. *(No other schedule constraints recorded.)*
- **Professional development**: Go depth is the newest and most marketable skill but has the
  shortest tenure (1 year) — roles that deepen it compound best. AZ-900 is the only formal
  certification; Docker/Kubernetes are coursework and are the most visible gap against modern
  backend postings. See `/upskill` for a gap analysis.

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
