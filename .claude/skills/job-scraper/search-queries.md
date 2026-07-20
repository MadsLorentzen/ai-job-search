# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

## Search Sites

Primary (US job boards):
- **indeed.com** - largest general US job board
- **linkedin.com/jobs** - LinkedIn job listings (filter: United States, nationwide); also covered by `linkedin-search` CLI
- **rasmussen.io / clinicaltrialjobs.com** - niche clinical trials / biostatistics job boards (optional)
- **glassdoor.com** - another major US board (optional)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies (pharma, CRO, academic medical centers, biotech)

## Query Categories

Queries are grouped by priority. Each query should be combined with your location terms (e.g. your city, region, or metro area) where the site supports it.

### Priority 1: Biostatistics / Clinical Trial Programming

These match the strongest and most desired career direction.

```
site:indeed.com "Biostatistician" United States
site:indeed.com "Clinical Research Data Analyst" United States
site:linkedin.com/jobs "Biostatistician" United States
site:linkedin.com/jobs "Statistical Programmer" United States
```

### Priority 2: Clinical/Healthcare Data Analytics

These match domain expertise in EHR-derived and real-world clinical data.

```
site:indeed.com "Clinical Data Analyst" R OR SAS United States
site:indeed.com "Research Data Analyst" clinical trials United States
site:linkedin.com/jobs "Healthcare Data Scientist" United States
```

### Priority 3: Adjacent Roles

Adjacent roles to pivot into.

```
site:indeed.com "Statistical Programmer" SAS United States
site:indeed.com "Data Analyst" clinical trials United States
```

### Priority 4: Broader Data / Consulting

Wider net for general data roles that value clinical trial or statistical modeling experience.

```
site:indeed.com "Data Scientist" clinical OR healthcare United States
site:linkedin.com/jobs "Data Analyst" R SAS United States
```

## Location Filter

Open to relocation anywhere in the US and to any work arrangement (remote/hybrid/onsite) - no location filter needed. When evaluating results:
- **Ideal:** Remote roles, or roles in major biostatistics/pharma/CRO hubs (Boston, NJ/Philadelphia, RTP/NC, SF Bay Area)
- **Acceptable:** Any US location with relocation support or reasonable relocation feasibility
- **Borderline:** Roles requiring extensive international travel
- **Too far / exclude:** Postings explicitly outside the US, or postings that explicitly state they do not offer visa sponsorship (hard deal-breaker - see `04-job-evaluation.md`)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
