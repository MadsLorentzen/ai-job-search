# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. This fork targets **Spain**. Each portal below states its own flags in its `SKILL.md`; the table is only what you need to translate a query into the right call.

| Portal skill | Location argument | Recency (`--jobage`) | Detail | Notes |
|---|---|---|---|---|
| `infoempleo-search` | `-l Toledo` (province or city, plain Spanish) | 1 / 7 / 15 days | yes (exact date, deadline, salary) | General board, strong in industry and engineering. Keyword matching is loose, so pre-filter by title |
| `indeed-search` | `-l Toledo` (plain Spanish) | 1 / 3 / 7 / 14 days | **none** (robots.txt) - judge from the card's `snippet` | Highest volume. Max 10 pages. Space requests out; `BLOCKED` means wait |
| `linkedin-search` | `-l "Toledo, Castilla-La Mancha, Spain"` (**English** place names, with the region) | 1 / 7 / 14 / 30 days | yes | `-l "Toledo, Spain"` alone resolves to Madrid and `-l "España"` returns US results - always use the English region form. Also `-l "Spain"` for national, `--remote remote` for remote |
| `ingenieros-search` | `-l Valencia` (substring of the offer's place) | client-side | yes | Small engineering board: one page of the latest offers, usually under ten |
| `infojobs-search` | `-l Toledo` (province) or `--city Illescas` | 24 h / 7 / 15 days | yes | Official API, needs `INFOJOBS_API_TOKEN`; ships **disabled** until you set it up |
| `freehire-search` | per its SKILL.md | per its SKILL.md | yes | Tech-focused aggregator; mostly relevant for software roles |

You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** - for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (for a Spanish market that is normally Spanish first, plus English for multinational employers). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded - see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word. Spanish job titles vary a lot by employer and carry gender markers, so list several variants per category (e.g. "Responsable de producción", "Jefe de producción", "Jefe/a de planta"; "Ingeniero/a de procesos", "Ingeniero de mejora continua").

## Search Sites

Primary (job boards, each covered by a CLI above):
- **infoempleo.com**, **es.indeed.com**, **ingenieros.es**, **infojobs.net** (via API) and **linkedin.com/jobs** (filter: Spain / your province).

Secondary (WebSearch fallback, for company career pages and boards without a CLI):
- Direct Google searches with `site:` filters for known target companies (their `careers` / `empleo` / `trabaja-con-nosotros` pages).
- Other Spanish boards worth a `site:` query when the CLIs come up thin: `site:tecnoempleo.com` (IT; its robots.txt blocks AI agents, so use it for search-result snippets only, never fetch it), `site:jooble.org`, `site:trabajos.com`, `site:empleate.gob.es` (SEPE public service).

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

**Organize by function, not job title.** The same underlying work carries different titles across companies and markets (a "Data Scientist" role at one employer may be posted as "Insights Analyst" or "Data Consultant" at another). Name each priority category after the function it covers, and list several plausible job titles as query variants within that category rather than betting an entire priority tier on one exact title string.

### Priority 1: [YOUR_PRIMARY_ROLE_TYPE]

These match your strongest and most desired career direction.

```
site:[YOUR_JOB_BOARD] "[YOUR_PRIMARY_JOB_TITLE_1]" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_PRIMARY_JOB_TITLE_2]" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_KEY_SKILL]" [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_PRIMARY_JOB_TITLE_1]" [YOUR_COUNTRY]
```

### Priority 2: [YOUR_DOMAIN_EXPERTISE]

These match your domain expertise.

```
site:[YOUR_JOB_BOARD] [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] OR [YOUR_REGION]
site:[YOUR_JOB_BOARD] [YOUR_DOMAIN_KEYWORD_2] [YOUR_COUNTRY]
site:linkedin.com/jobs [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] [YOUR_COUNTRY]
```

### Priority 3: [YOUR_ADJACENT_ROLE_TYPE]

Adjacent roles you could pivot into.

```
site:[YOUR_JOB_BOARD] "[YOUR_ADJACENT_TITLE_1]" [YOUR_KEY_SKILL] [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_ADJACENT_TITLE_2]" [YOUR_KEY_SKILL] [YOUR_CITY]
```

### Priority 4: Broader Technical / Consulting

Wider net for general technical roles.

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
