# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

## Search Sites

Primary (German market - arbeitsagentur.de is covered by the `arbeitsagentur-search` CLI):
- **stepstone.de** - Germany's largest private general job board (WebSearch fallback, blocks direct scraping)
- **de.indeed.com** - job aggregator for Germany (WebSearch fallback, blocks direct scraping)
- **linkedin.com/jobs** - LinkedIn job listings (filter: Deutschland / [YOUR_CITY]); also covered by `linkedin-search` CLI
- **xing.com/jobs** - DACH-focused professional network job board (optional)
- **[YOUR_INDUSTRY_JOB_BOARD]** - a niche/industry board for your field (optional)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Each query should be combined with your location terms (e.g. your city, region, or metro area) where the site supports it.

### Priority 1: [YOUR_PRIMARY_ROLE_TYPE]

These match your strongest and most desired career direction.

```
site:stepstone.de OR site:de.indeed.com "[YOUR_PRIMARY_JOB_TITLE]" [YOUR_CITY]
site:stepstone.de OR site:de.indeed.com "[YOUR_KEY_SKILL]" [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_PRIMARY_JOB_TITLE]" Deutschland
```

### Priority 2: [YOUR_DOMAIN_EXPERTISE]

These match your domain expertise.

```
site:stepstone.de OR site:de.indeed.com [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] OR [YOUR_REGION]
site:stepstone.de OR site:de.indeed.com [YOUR_DOMAIN_KEYWORD_2] Deutschland
site:linkedin.com/jobs [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] Deutschland
```

### Priority 3: [YOUR_ADJACENT_ROLE_TYPE]

Adjacent roles you could pivot into.

```
site:stepstone.de OR site:de.indeed.com "[YOUR_ADJACENT_TITLE_1]" [YOUR_KEY_SKILL] [YOUR_CITY]
site:stepstone.de OR site:de.indeed.com "[YOUR_ADJACENT_TITLE_2]" [YOUR_KEY_SKILL] [YOUR_CITY]
```

### Priority 4: Broader Technical / Consulting

Wider net for general technical roles.

```
site:stepstone.de OR site:de.indeed.com [YOUR_KEY_SKILL] developer [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_KEY_SKILL] developer" [YOUR_CITY]
site:stepstone.de OR site:de.indeed.com "technical consultant" [YOUR_DOMAIN] [YOUR_CITY]
```

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance from your home. Define acceptable areas:
- [YOUR_CITY] and surrounding areas
- [ACCEPTABLE_AREA_1]
- [ACCEPTABLE_AREA_2]
- [BORDERLINE_AREA] (borderline - ~X min by transit)
- [TOO_FAR_AREA] (too far)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
