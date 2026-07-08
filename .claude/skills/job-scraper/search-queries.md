# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Search Sites

**Note:** This repo's built-in job-scraper CLI tools (`jobbank-search`, `jobdanmark-search`, `jobindex-search`, `jobnet-search`) are Denmark-specific job portals and are not relevant for a Costa Rica-based search. Only `linkedin-search` applies directly. Until a Costa Rica-specific portal integration is added (see `/add-portal`), rely on LinkedIn and Google `site:` searches against Costa Rican job boards below.

Primary:
- **linkedin.com/jobs** - LinkedIn job listings (filter: Costa Rica / remote)
- **elempleo.com** - major Costa Rica/Central America job board
- **computrabajo.co.cr** - Costa Rica job board
- **tecoloco.com** - Costa Rica job board
- **remoteok.com / weworkremotely.com** - remote-first international listings

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Each query should be combined with your location terms ("San Jose", "Costa Rica", "Remote") where the site supports it.

### Priority 1: Full-Stack Developer / Software Engineer

These match your strongest and most desired career direction.

```
site:linkedin.com/jobs "Full-Stack Developer" Costa Rica
site:linkedin.com/jobs "Software Engineer" Costa Rica OR Remote
site:computrabajo.co.cr "desarrollador full stack"
site:elempleo.com "full stack developer" Costa Rica
```

### Priority 2: Power Platform Developer / Automation

These match your domain expertise (Power Platform, business process automation).

```
site:linkedin.com/jobs "Power Platform Developer" Costa Rica OR Remote
site:linkedin.com/jobs "Power Automate" OR "Power Apps" Costa Rica
site:computrabajo.co.cr "power apps" OR "power automate"
```

### Priority 3: IT Support Specialist / Junior Developer

Adjacent roles you could pivot into or use as a stepping stone.

```
site:linkedin.com/jobs "IT Support Specialist" Costa Rica
site:linkedin.com/jobs "Junior Developer" Costa Rica OR Remote
site:computrabajo.co.cr "soporte tecnico" OR "junior developer"
```

### Priority 4: Broader Technical / AI Integration

Wider net for general technical roles, including AI/LLM-adjacent postings.

```
site:linkedin.com/jobs "React developer" OR "Next.js developer" Remote
site:linkedin.com/jobs "AI" "chatbot" developer Remote
site:elempleo.com "desarrollador" Costa Rica
```

## Location Filter

When evaluating results, verify the job location fits the constraints below. Define acceptable areas:
- San Jose, Costa Rica and surrounding metro area
- Remote roles anywhere in Costa Rica
- Fully remote international roles (no relocation required)
- Roles requiring relocation (too far - deal-breaker, exclude)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
