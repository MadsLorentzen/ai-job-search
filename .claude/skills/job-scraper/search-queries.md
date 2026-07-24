# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. You do **not** need a matching `site:` line below for those CLIs to run.

**This fork targets the French market.** Enabled portals:

| Skill | Covers | Notes |
|---|---|---|
| `wttj-search` | Welcome to the Jungle — the main French board, ~95k postings | Personal use only; WAF-throttled on detail fetches |
| `stationf-search` | STATION F job board — ~650 postings from Paris campus startups | Small, high-signal supplement |
| `linkedin-search` | LinkedIn, country-agnostic | Use `--location "Paris, Île-de-France, France"` |
| `freehire-search` | Multi-market tech aggregator | Use `--country FR --city Paris` |

The four Danish demo portals (`jobindex`, `jobbank`, `jobnet`, `jobdanmark`) ship with the
framework but are `enabled: false` here — `/scrape` skips them and reports them on its
`skipped (disabled):` line. Re-enable one by flipping the flag in its `SKILL.md`.

**Useful French flags** the two French CLIs share: `--contract cdi|cdd|stage|alternance|freelance`,
`--remote full|partial|punctual|no`, `--location <city>`, `--region Ile-de-France`
(unaccented, hyphenated), `--department Tech|Business|Sales|…`, `--language fr|en`.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

## Search Sites

Primary (French market):
- **welcometothejungle.com** - the largest French job board; covered by the `wttj-search` CLI
- **jobs.stationf.co** - Paris startup-campus board; covered by the `stationf-search` CLI
- **linkedin.com/jobs** - LinkedIn job listings (filter: France / Paris); also covered by `linkedin-search` CLI
- **[YOUR_INDUSTRY_JOB_BOARD]** - a niche/industry board for your field (optional; e.g. APEC for cadre roles, Choose Your Boost, HelloWork, Indeed.fr)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Each query should be combined with your location terms (e.g. your city, region, or metro area) where the site supports it.

### Priority 1: [YOUR_PRIMARY_ROLE_TYPE]

These match your strongest and most desired career direction.

```
site:welcometothejungle.com "[YOUR_PRIMARY_JOB_TITLE]" [YOUR_CITY]
site:welcometothejungle.com "[YOUR_KEY_SKILL]" [YOUR_CITY]
site:jobs.stationf.co "[YOUR_PRIMARY_JOB_TITLE]"
site:linkedin.com/jobs "[YOUR_PRIMARY_JOB_TITLE]" France
```

### Priority 2: [YOUR_DOMAIN_EXPERTISE]

These match your domain expertise.

```
site:welcometothejungle.com [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] OR [YOUR_REGION]
site:welcometothejungle.com [YOUR_DOMAIN_KEYWORD_2] France
site:linkedin.com/jobs [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] France
```

### Priority 3: [YOUR_ADJACENT_ROLE_TYPE]

Adjacent roles you could pivot into.

```
site:welcometothejungle.com "[YOUR_ADJACENT_TITLE_1]" [YOUR_KEY_SKILL] [YOUR_CITY]
site:welcometothejungle.com "[YOUR_ADJACENT_TITLE_2]" [YOUR_KEY_SKILL] [YOUR_CITY]
```

### Priority 4: Broader Technical / Consulting

Wider net for general technical roles.

```
site:welcometothejungle.com [YOUR_KEY_SKILL] developer [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_KEY_SKILL] developer" [YOUR_CITY]
site:welcometothejungle.com "technical consultant" [YOUR_DOMAIN] [YOUR_CITY]
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
