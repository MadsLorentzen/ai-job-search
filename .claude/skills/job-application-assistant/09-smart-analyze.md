---
framework_version: 1.0.0
---

# Smart Job Description Analyzer

<!-- INVOCATION: Triggered by /smart-analyze or keywords: smart analyze, analyze job, business problems, interview pitch, SMART goals -->

## Purpose

Analyze a job description through the lens of **what business problems the employer actually needs solved**. Rather than matching skills to requirements, this skill reverse-engineers the posting to surface the underlying business pain points, then builds SMART-goal-driven interview pitches that demonstrate you understand those problems and have a plan to solve them.

## When to Use

- The user invokes `/smart-analyze` (with or without a job description in context)
- The user asks to "analyze this job" or "what problems does this role solve"
- The user wants interview pitches tailored to a specific posting
- As a complement to the standard job evaluation (`04-job-evaluation.md`) — evaluation scores fit; smart-analyze builds the narrative for the interview

## Input Requirements

This skill requires a job description. If no job description is present in the current context:

1. Ask the user to paste the job description or provide a URL
2. If a URL is provided, fetch it with `WebFetch`
3. If the description is in a language other than English, work in that language — the output language should match the job posting language
4. Proceed only once a job description is available

## Analysis Framework

### Step 1: Extract the Role's Core Mandate

Read the job description and identify:
- **Stated responsibilities** — what the role does day-to-day
- **Implicit expectations** — what's between the lines (e.g., "stakeholder management" often means navigating conflicting priorities)
- **Reporting line & team context** — who this role reports to and what that implies about pressure points
- **Listed requirements vs. nice-to-haves** — the gap between "must have" and "preferred" often reveals the real problem

### Step 2: Identify the Top 3 Business Problems

For each problem, determine:
1. **What the employer actually cares about** — the pain point behind the req. Speak in business-outcome language, not skill-matching language.
2. **Why it matters to the business** — connect to revenue, cost, risk, compliance, speed, quality, or retention. Be specific about the consequence of NOT solving it.
3. **Rank by importance** — from the employer's perspective, which problem costs the most if unsolved? Rank #1 is the most critical.

**Guidance for ranking:**
- Problems tied to revenue or regulatory risk typically rank highest
- Problems tied to team scalability or technical debt come next
- Problems tied to nice-to-have improvements rank lowest
- If the posting emphasizes one area with unusual detail, that's likely #1

### Step 3: Build SMART Goals for Each Problem

For each of the 3 problems, define 3 goals (9 goals total). Each goal must be **SMART**:

| Element | Question to Answer |
|---------|-------------------|
| **Specific** | What exactly will be accomplished? Name the system, process, team, or metric. |
| **Measurable** | How will success be quantified? Use numbers, percentages, timelines. |
| **Achievable** | Why is this realistic given the candidate's background? Reference specific experience from `01-candidate-profile.md`. |
| **Relevant** | How does this directly address the business problem? Tie back to the problem statement. |
| **Time-bound** | By when? Use concrete timeframes (30/60/90 days, Q1, first 6 months). |

### Step 4: Craft Interview Pitches

For each goal, write an **interview pitch** — a 2-4 sentence statement the candidate can deliver in an interview that:

1. **Acknowledges the business problem** — shows you understand what keeps them up at night
2. **References specific experience** — names a real project, tool, or outcome from the candidate's profile
3. **Proposes a concrete approach** — the SMART goal in conversational form
4. **Ends with a measurable outcome** — what success looks like

**Pitch formula:**
> "From what I understand, [business problem]. In my current role at [Company], I [specific experience with measurable outcome]. Here, I'd [proposed approach], with the goal of [SMART target] within [timeframe]."

### Step 5: Map Required Skills

For each goal, list the specific skills from the candidate's profile that support it. Reference `01-candidate-profile.md` and `02-behavioral-profile.md`. Be honest — if a skill is a learning area, frame it as "building on foundational knowledge of X" rather than claiming depth.

## Output Format

Present results in this exact structure (Markdown). Language matches the job posting language.

```
## Smart Analysis: [Role Title] at [Company]

### Business Context
[2-3 sentences synthesizing what this role is really about from a business-problem perspective. What's the organizational context? What's at stake?]

---

### Problem 1
**Rank #1: [Problem Title — a concise, business-outcome statement]**

**What the employer actually cares about:**
[1-2 sentences describing the real pain point behind the job posting requirements.]

**Why it matters to the business:**
[1-2 sentences connecting to revenue, cost, risk, compliance, speed, quality, or retention. Include the consequence of inaction.]

#### Goal 1: [Goal Title]
- **Specific:** [What exactly will be accomplished]
- **Measurable:** [How success is quantified]
- **Achievable:** [Why realistic given candidate's background — reference specific experience]
- **Relevant:** [How this directly addresses Problem 1]
- **Time-bound:** [Concrete timeframe]
- **Key actions:**
  - [Action 1]
  - [Action 2]
  - [Action 3]
- **Skill required:** [Specific skill(s) from candidate profile]
- **Interview pitch:**
  > "[Conversational pitch following the formula — ready to deliver in an interview]"

#### Goal 2: [Goal Title]
- **Specific:** ...
- **Measurable:** ...
- **Achievable:** ...
- **Relevant:** ...
- **Time-bound:** ...
- **Key actions:**
  - ...
- **Skill required:** ...
- **Interview pitch:**
  > "..."

#### Goal 3: [Goal Title]
- **Specific:** ...
- **Measurable:** ...
- **Achievable:** ...
- **Relevant:** ...
- **Time-bound:** ...
- **Key actions:**
  - ...
- **Skill required:** ...
- **Interview pitch:**
  > "..."

---

### Problem 2
**Rank #2: [Problem Title]**

**What the employer actually cares about:**
[...]

**Why it matters to the business:**
[...]

#### Goal 1: [Goal Title]
[...same structure as above...]

#### Goal 2: [Goal Title]
[...]

#### Goal 3: [Goal Title]
[...]

---

### Problem 3
**Rank #3: [Problem Title]**

**What the employer actually cares about:**
[...]

**Why it matters to the business:**
[...]

#### Goal 1: [Goal Title]
[...same structure...]

#### Goal 2: [Goal Title]
[...]

#### Goal 3: [Goal Title]
[...]

---

### Interview Cheat Sheet

#### If You Only Have 5 Minutes
- **Lead with Problem 1, Goal 1** — it's the highest-impact answer
- **Pitch:** [Condensed version of the #1 pitch — 2 sentences max]

#### Questions to Ask That Reinforce This Analysis
- [Question that shows you've thought about Problem 1]
- [Question that shows you've thought about Problem 2]
- [Question that shows you've thought about Problem 3]

#### Red Flags to Probe
- [Something about the role context that could undermine these goals — ask about it diplomatically]
```

## Quality Rules

1. **Problems must be real business problems**, not restated requirements. "Need 5 years of SAP HANA" is a requirement. "Legacy SAP BW reporting is too slow for real-time quality decisions" is a business problem.
2. **Every interview pitch must reference the candidate's actual experience.** Never fabricate experience. If there's no direct match, pivot to adjacent experience honestly: "While my background is in X rather than Y, the pattern of [transferable approach] applies directly..."
3. **Goals must be concrete enough to execute.** "Improve reporting" is too vague. "Migrate top 3 Quality reports from batch BW to real-time HANA native models" is concrete.
4. **Rankings must be defensible.** If asked "why is this #1?", the reasoning should be obvious from the business impact.
5. **Output in the job posting's language.** German posting → German output. English posting → English output.
6. **Honest about gaps.** If a goal requires a skill the candidate is learning (e.g., Webdynpro, SAP Analytics Cloud), the pitch should say so and pivot to the proven learning track record (10 openSAP certs, SAP expert L1+L2).

## Integration with Other Skills

- **Before `/smart-analyze`:** Consider running the job evaluation (`04-job-evaluation.md`) first if fit hasn't been assessed yet. Smart-analyze assumes the candidate is interested in the role.
- **After `/smart-analyze`:** The interview pitches feed directly into interview prep (`07-interview-prep.md`). The business problems identified here become the STAR example selection criteria.
- **With `/apply`:** The business-problem lens improves cover letter targeting — reference the #1 problem in the opening paragraph.
