# Search Queries for Job Scraper

<!-- Configured for Usama Ramzan; adjust priorities as the search evolves. -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary (installed portal skills):
- **LinkedIn** - covered by the `linkedin-search` CLI; prioritize Lahore and remote listings.
- **Rozee.pk** - covered by the `rozee-search` CLI; prioritize Lahore and use low-volume personal searches.
- **Freehire.me** - covered by the `freehire-search` CLI for international and remote technology roles.

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

**Organize by function, not job title.** The same underlying work carries different titles across companies and markets (a "Data Scientist" role at one employer may be posted as "Insights Analyst" or "Data Consultant" at another). Name each priority category after the function it covers, and list several plausible job titles as query variants within that category rather than betting an entire priority tier on one exact title string.

### Priority 1: AI and machine learning internships

These match your strongest and most desired career direction.

```
site:rozee.pk "AI ML Intern" Lahore
site:rozee.pk "Machine Learning Intern" Lahore
site:rozee.pk "Artificial Intelligence Intern" Lahore
site:linkedin.com/jobs "AI/ML Intern" Lahore Pakistan
site:linkedin.com/jobs "Machine Learning Intern" remote Pakistan
site:rozee.pk "مشین لرننگ انٹرن" لاہور
```

### Priority 2: Data science and analytics

These match your data and business-analysis skills.

```
site:rozee.pk "Data Science Intern" Lahore
site:rozee.pk "Data Analyst" "Part Time" Lahore
site:linkedin.com/jobs "Data Science Intern" Lahore Pakistan
site:linkedin.com/jobs "Junior Data Analyst" Lahore
site:linkedin.com/jobs "Data Analyst" remote Pakistan
site:rozee.pk "ڈیٹا تجزیہ کار" لاہور
```

### Priority 3: Junior machine learning and applied AI

Adjacent roles you could pivot into.

```
site:rozee.pk "Junior Machine Learning Engineer" Lahore Python
site:rozee.pk "AI Engineer Intern" Lahore Python
site:linkedin.com/jobs "Junior ML Engineer" Lahore
site:linkedin.com/jobs "AI Engineer Intern" remote Pakistan Python
site:rozee.pk "ڈیٹا سائنس انٹرن" لاہور
```

### Priority 4: Broader Technical / Consulting

Wider net for general technical roles.

```
site:rozee.pk Python data analyst Lahore intern
site:linkedin.com/jobs Python data intern Lahore Pakistan
site:linkedin.com/jobs "Business Intelligence Intern" Lahore
site:rozee.pk "Excel SQL" data analyst Lahore part time
site:rozee.pk "ڈیٹا اینالسٹ" لاہور پارٹ ٹائم
```

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance from your home. Define acceptable areas:
- Lahore, Punjab, Pakistan: preferred for on-site/hybrid roles.
- Remote roles: acceptable.
- Other cities or relocation: not specified; flag and confirm before treating as a match.

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
