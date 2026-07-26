---
name: company-research
description: >
  Deep-research a company before applying or interviewing. Covers mission, culture, tech stack,
  recent news, red flags, and insider signals. Triggered by: research company, company info,
  tell me about [company], before I apply to [company], company background, company culture,
  is [company] a good place to work, glassdoor [company], what does [company] do
allowed-tools: Read, WebFetch, WebSearch, Glob, Grep
---

# Company Research Skill

---

## Overview

Produces a structured briefing on any company before an application or interview.
Sources: company website, LinkedIn, review sites, news, and the existing application archive.

Invoked directly ("research Acme") or called by `/apply` and `/interview` when they need
company context. Never fabricates — every claim traces to a fetched source.

---

## Step 0: Identify the Company

Extract the company name from the user's message or `$ARGUMENTS`.
If multiple companies or ambiguous names appear, ask for clarification before proceeding.

---

## Step 1: Load Existing Context

Check whether an application archive already exists:

```
documents/applications/<company_slug>/
```

If `job_posting.md` or previous research files are present, read them first — avoids
re-fetching what is already known and surfaces what the user already committed to in
their CV and cover letter.

---

## Step 2: Website & Mission

1. Search `"<Company Name>" site:linkedin.com OR "[company name].com"` to locate the
   official domain.
2. Fetch the homepage and /about page.
3. Extract:
   - **What they do** — one sentence, jargon-free
   - **Mission / values** — direct quotes where available
   - **Size** — headcount or revenue band if visible
   - **Stage** — startup / scale-up / enterprise / public
   - **HQ + key offices** — relevant for remote/hybrid decisions

---

## Step 3: Recent News & Strategic Signals

Search: `"<Company Name>" news 2025 OR 2026`

Flag any of the following if found:
- Recent funding rounds (Series, IPO)
- Layoffs or hiring freezes
- Leadership changes (CEO, CTO turnover)
- M&A activity (acquirer or target)
- Product launches or major pivots
- Press coverage of culture or workplace issues

Mark items as **positive signal**, **neutral**, or **⚠ red flag** with a brief explanation.

---

## Step 4: Culture & Workplace

Search: `"<Company Name>" glassdoor OR "blind" OR "levels.fyi" OR reviews work`

Fetch and summarise:
- **Overall rating** (if available)
- **Pros** mentioned repeatedly
- **Cons** mentioned repeatedly  
- **Management / leadership** signals
- **Work-life balance** signals
- **Pay & benefits** signals
- Any recurring complaints that could conflict with the candidate's behavioral profile
  (read from `02-behavioral-profile.md` if available)

**Important:** Treat review-site content as unverified individual opinions, not facts.
Flag patterns, not individual anecdotes.

---

## Step 5: Tech Stack & Engineering Culture (if relevant role)

Search: `"<Company Name>" tech stack OR engineering blog OR github`

Check:
- GitHub org (if public) — languages, repos, activity
- Engineering or tech blog
- Job postings on their site (often reveal stack even if not the target role)

Output: bullet list of confirmed technologies, frameworks, and practices.

---

## Step 6: LinkedIn Signals

Build (do not fetch programmatically) these LinkedIn search links for the user to check:

- **Team size / recent hires:**
  `https://www.linkedin.com/search/results/people/?keywords=<encoded company name>&origin=GLOBAL_SEARCH_HEADER`
- **Hiring manager / decision-maker:**
  `https://www.linkedin.com/search/results/people/?keywords=<encoded "[company] [hiring manager OR engineering manager OR VP]">&origin=GLOBAL_SEARCH_HEADER`
- **Mutual connections:**
  `https://www.linkedin.com/search/results/people/?keywords=<encoded company name>&network=["F","S"]&origin=GLOBAL_SEARCH_HEADER`

Present links as clickable; note that the user needs to be logged in.

---

## Step 7: Compile Briefing

Present in this format:

```
## Company Briefing: <Company Name>
Researched: YYYY-MM-DD

### What They Do
[1-2 sentences, plain language]

### Stage & Size
[Funding stage / headcount / revenue band]

### Mission & Values
> "[direct quote if available]"

### Recent News
| Signal | Type | Source |
|--------|------|--------|
| ... | positive / neutral / ⚠ red flag | [link] |

### Culture Signals
- **Pros:** [patterns from reviews]
- **Cons:** [patterns from reviews]  
- **⚠ Red flags:** [if any]

### Tech Stack
[bullet list — confirmed only]

### LinkedIn Research Links
- Team: [link]
- Hiring manager: [link]
- Mutual connections: [link]

### Fit Notes
[2-3 sentences connecting company signals to the candidate's profile and goals.
Read from CLAUDE.md if available.]
```

---

## Important Rules

1. **Never fabricate.** Every claim must come from a fetched URL. If a source is
   unavailable, say so rather than guessing.
2. **Distinguish opinions from facts.** Review-site claims are individual opinions;
   news articles are reported facts — label them differently.
3. **Flag conflicts with candidate profile.** If a red flag (e.g. "management
   micromanages") conflicts with what `02-behavioral-profile.md` says the candidate
   needs, surface it explicitly.
4. **Save to archive if application exists.** If `documents/applications/<company_slug>/`
   already exists, offer to save the briefing as `company_research.md` in that folder.
5. **Do not leak the briefing into the posting.** Company research findings inform the
   application — they are never pasted into the CV or stated as facts the candidate
   independently knows unless they are public record.
