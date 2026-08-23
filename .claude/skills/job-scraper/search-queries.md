# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary (this fork's US boards - add another with `/add-portal`):
- **linkedin.com/jobs** - LinkedIn job listings (filter: United States / [YOUR_CITY]); also covered by `linkedin-search` CLI
- **indeed.com** - Indeed (WebSearch fallback; the site blocks automated fetch)
- **dice.com** - Dice tech listings (WebSearch fallback)
- **builtin.com** - Built In (tech metros and remote)
- **wellfound.com** - Wellfound / AngelList startups
- **clearancejobs.com** - cleared roles (only if relevant)
- **usajobs.gov** - federal roles (only if relevant)
- **boards.greenhouse.io / jobs.lever.co / jobs.ashbyhq.com** - employer ATS boards

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

**Organize by function, not job title.** The same underlying work carries different titles across companies and markets (a "Data Scientist" role at one employer may be posted as "Insights Analyst" or "Data Consultant" at another). Name each priority category after the function it covers, and list several plausible job titles as query variants within that category rather than betting an entire priority tier on one exact title string.

### Priority 1: [YOUR_PRIMARY_ROLE_TYPE]

These match your strongest and most desired career direction.

```
site:indeed.com "[YOUR_PRIMARY_JOB_TITLE_1]" [YOUR_CITY] remote
site:dice.com "[YOUR_PRIMARY_JOB_TITLE_2]" [YOUR_CITY]
site:builtin.com "[YOUR_KEY_SKILL]" remote
site:linkedin.com/jobs "[YOUR_PRIMARY_JOB_TITLE_1]" "United States"
```

### Priority 2: [YOUR_DOMAIN_EXPERTISE]

These match your domain expertise.

```
site:indeed.com [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] OR remote
site:dice.com [YOUR_DOMAIN_KEYWORD_2] "United States"
site:linkedin.com/jobs [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] "United States"
```

### Priority 3: [YOUR_ADJACENT_ROLE_TYPE]

Adjacent roles you could pivot into.

```
site:indeed.com "[YOUR_ADJACENT_TITLE_1]" [YOUR_KEY_SKILL] [YOUR_CITY]
site:wellfound.com "[YOUR_ADJACENT_TITLE_2]" [YOUR_KEY_SKILL] remote
```

### Priority 4: Broader Technical / Consulting

Wider net for general technical roles.

```
site:indeed.com [YOUR_KEY_SKILL] developer [YOUR_CITY] remote
site:linkedin.com/jobs "[YOUR_KEY_SKILL] developer" [YOUR_CITY] "United States"
site:builtin.com "technical consultant" [YOUR_DOMAIN] [YOUR_CITY]
```

## Location Filter

When evaluating results, verify the job location matches the US search:
- Remote (United States) — preferred unless the user said otherwise
- [YOUR_CITY] and surrounding metro
- Hybrid in [ACCEPTABLE_AREA_1]
- Relocation outside the user's stated area is a deal-breaker unless they said otherwise

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
