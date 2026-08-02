# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos, `stepstone-search` (Germany), and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

## Search Sites

Primary (your market's job boards - scaffold one with `/add-portal`):
- **stepstone.de** - major German general job board; now covered by the `stepstone-search` CLI (search + detail). The `site:` line below remains as a fallback for when the CLI is disabled/unavailable.
- **linkedin.com/jobs** - LinkedIn job listings (filter: Germany / Sweden / Denmark / Austria / Switzerland / Netherlands); also covered by `linkedin-search` CLI
- **indeed.com** (indeed.de, indeed.se, etc.) - broad coverage across all target countries
- **monster.de** - additional German board
- **arbeitsagentur.de** (Arbeitsamt Jobbörse) - official German federal job board

Country-specific boards worth scaffolding via `/add-portal` if search volume in that market grows:
- Sweden: arbetsformedlingen.se
- Denmark: jobindex.dk, jobnet.dk
- Austria: karriere.at
- Switzerland: jobs.ch
- Netherlands: indeed.nl, nationalevacaturebank.nl

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies (e.g. Porsche, Bosch, Siemens, ZF, Dürr, STIHL, Trumpf, and other IG Metall-covered employers)

## Query Categories

Queries are grouped by priority. Each query should be combined with your location terms (e.g. your city, region, or metro area) where the site supports it.

### Priority 1: Machine Learning / Data Science

These match your strongest and most desired career direction.

```
site:stepstone.de "Machine Learning Engineer" Germany
site:stepstone.de "Data Scientist" Germany
site:linkedin.com/jobs "Machine Learning Engineer" Germany
site:linkedin.com/jobs "Data Scientist" Sweden
site:indeed.com "Computer Vision" OR "NLP" Germany
```

### Priority 2: Domain Expertise (Computer Vision / NLP / Industrial ML)

These match your domain expertise.

```
site:stepstone.de "Computer Vision" Germany OR Sweden
site:stepstone.de "Natural Language Processing" Germany
site:linkedin.com/jobs "industrial AI" OR "industrial machine learning" Germany
```

### Priority 3: Adjacent Roles (IT / Systems Analytics)

Adjacent roles you could pivot into, drawing on the ERP/EDI and BI background.

```
site:stepstone.de "Data Analyst" Machine Learning Germany
site:stepstone.de "IT Consultant" Data Science Germany
site:linkedin.com/jobs "Business Intelligence" Python Germany
```

### Priority 4: Broader Technical (wider net)

Wider net for general ML/software roles - excludes pure consulting (deal-breaker).

```
site:indeed.com "Python developer" Machine Learning Germany
site:linkedin.com/jobs "Python developer" Germany -consulting
site:arbeitsagentur.de Machine Learning
```

## Location Filter

When evaluating results, verify the job location is within a 30-minute commute of a livable city (hard constraint). Define acceptable areas:
- Germany - focus on IG Metall-covered industrial hubs: Stuttgart region, Munich, Nuremberg, Frankfurt, and other automotive/aerospace/engineering centers
- Sweden - Linköping, Stockholm, Gothenburg
- Denmark - Copenhagen and surrounding commutable areas
- Austria - Vienna, Graz
- Switzerland - Zurich, Basel (note: EU-citizen registration required, not a hard eligibility gate)
- Netherlands - Amsterdam, Eindhoven
- South Tyrol / Northern Italy (borderline - confirm commute/livability case by case)
- Locations requiring a commute over 30 minutes from a livable city (too far)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
