# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails. They are **not** sent to portal CLIs; `SKILL.md` Step 1c uses them only for the WebSearch fallback. Portal CLI search terms (plain, one per call) are listed separately under each priority section; `SKILL.md` Step 1b translates those into each portal's flags with the per-portal quoting rule.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary (your market's job boards - scaffold one with `/add-portal`):
- **[YOUR_JOB_BOARD]** - your market's largest general job board
- **linkedin.com/jobs** - LinkedIn job listings (filter: [YOUR_COUNTRY] / [YOUR_CITY]); also covered by `linkedin-search` CLI
- **[YOUR_INDUSTRY_JOB_BOARD]** - a niche/industry board for your field (optional)
- **[YOUR_ADDITIONAL_JOB_BOARD]** - another major board for your market (optional)

Secondary (company career pages via WebSearch fallback):
- WebSearch fallback queries with `site:` filters for known target companies (see "WebSearch fallback queries" in each Priority section below)

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

> **Two tracks from one template.** Each priority section below lists **Portal CLI search terms** (plain keyword phrases for Step 1b) and a separate **WebSearch fallback query** block (`site:` strings for Step 1c). Keep `site:` strings for the WebSearch fallback only — no portal CLI interprets `site:`, and `OR` is not an operator on any portal. Run one plain CLI term per call (no `OR`, no combined strings); `SKILL.md` Step 1b gives the per-portal quoting rule.

**Organize by function, not job title.** The same underlying work carries different titles across companies and markets (a "Data Scientist" role at one employer may be posted as "Insights Analyst" or "Data Consultant" at another). Name each priority category after the function it covers, and list several plausible job titles as query variants within that category rather than betting an entire priority tier on one exact title string.

### Priority 1: [YOUR_PRIMARY_ROLE_TYPE]

These match your strongest and most desired career direction.

**Portal CLI search terms** — run each as a separate call (one term per call). See `SKILL.md` Step 1b for the per-portal quoting rule (quote multi-word terms on jobindex, jobbank, and freehire; omit quotes on jobnet and LinkedIn). Append your `[YOUR_CITY]` / `[YOUR_COUNTRY]` / `[YOUR_REGION]` location terms per the portal's convention.

```
"[YOUR_PRIMARY_JOB_TITLE_1]"
"[YOUR_PRIMARY_JOB_TITLE_2]"
"[YOUR_KEY_SKILL]"
"[YOUR_PRIMARY_JOB_TITLE_1]"
```

**WebSearch fallback queries** (`site:` strings — Step 1c only):

```
site:[YOUR_JOB_BOARD] "[YOUR_PRIMARY_JOB_TITLE_1]" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_PRIMARY_JOB_TITLE_2]" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_KEY_SKILL]" [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_PRIMARY_JOB_TITLE_1]" [YOUR_COUNTRY]
```

### Priority 2: [YOUR_DOMAIN_EXPERTISE]

These match your domain expertise.

**Portal CLI search terms** — run each as a separate call (one term per call). See `SKILL.md` Step 1b for the per-portal quoting rule. Append your location terms per the portal's convention.

```
"[YOUR_DOMAIN_KEYWORD_1]"
"[YOUR_DOMAIN_KEYWORD_2]"
"[YOUR_DOMAIN_KEYWORD_1]"
```

**WebSearch fallback queries** (`site:` strings — Step 1c only):

```
site:[YOUR_JOB_BOARD] "[YOUR_DOMAIN_KEYWORD_1]" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_DOMAIN_KEYWORD_1]" [YOUR_REGION]
site:[YOUR_JOB_BOARD] "[YOUR_DOMAIN_KEYWORD_2]" [YOUR_COUNTRY]
site:linkedin.com/jobs "[YOUR_DOMAIN_KEYWORD_1]" [YOUR_CITY] [YOUR_COUNTRY]
```

### Priority 3: [YOUR_ADJACENT_ROLE_TYPE]

Adjacent roles you could pivot into.

**Portal CLI search terms** — run each as a separate call (one term per call). See `SKILL.md` Step 1b for the per-portal quoting rule. Append your location terms per the portal's convention.

```
"[YOUR_ADJACENT_TITLE_1]"
"[YOUR_ADJACENT_TITLE_2]"
```

**WebSearch fallback queries** (`site:` strings — Step 1c only):

```
site:[YOUR_JOB_BOARD] "[YOUR_ADJACENT_TITLE_1]" [YOUR_KEY_SKILL] [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_ADJACENT_TITLE_2]" [YOUR_KEY_SKILL] [YOUR_CITY]
```

### Priority 4: Broader Technical / Consulting

Wider net for general technical roles.

**Portal CLI search terms** — run each as a separate call (one term per call). See `SKILL.md` Step 1b for the per-portal quoting rule. Append your location terms per the portal's convention.

```
"[YOUR_KEY_SKILL]"
"[YOUR_KEY_SKILL] developer"
"technical consultant"
```

**WebSearch fallback queries** (`site:` strings — Step 1c only):

```
site:[YOUR_JOB_BOARD] [YOUR_KEY_SKILL] developer [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_KEY_SKILL] developer" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "technical consultant" [YOUR_DOMAIN] [YOUR_CITY]
```

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance from your home. Define acceptable areas:
- [YOUR_CITY] and surrounding areas
- [ACCEPTABLE_AREA_1]
- [ACCEPTABLE_AREA_2]
- [BORDERLINE_AREA] (borderline - ~X min by transit)
- [TOO_FAR_AREA] (too far)

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
