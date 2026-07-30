# Search Queries for Job Scraper

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

## Search Sites

Primary:
- **linkedin.com/jobs** - LinkedIn job listings (filter: UK, remote); also covered by `linkedin-search` CLI
- Also covered by `freehire-search` CLI

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters, WebSearch fallback for UK boards without a CLI (Indeed, CWJobs, Reed, Otta) - `/add-portal` can scaffold a dedicated one later if needed

## Query Categories

Queries are grouped by priority. Every query should be filtered to remote / UK-wide - this candidate is not commuting to an office.

### Priority 1: PHP Developer roles

These match the strongest and most desired career direction.

```
site:linkedin.com/jobs "PHP Developer" remote UK
site:linkedin.com/jobs "Full Stack Developer" PHP remote UK
site:linkedin.com/jobs "Laravel Developer" remote UK
```

### Priority 2: Domain expertise (fintech / e-commerce / SME SaaS)

```
site:linkedin.com/jobs "Backend Developer" PHP remote UK
site:linkedin.com/jobs PHP fintech remote UK
site:linkedin.com/jobs PHP e-commerce remote UK
```

### Priority 3: Lead Developer (career-direction stretch)

Adjacent role the candidate is growing toward - technical leadership, not people management.

```
site:linkedin.com/jobs "Lead Developer" PHP remote UK
site:linkedin.com/jobs "Senior PHP Developer" remote UK
```

### Priority 4: Broader Web Developer

Wider net for general PHP/web roles.

```
site:linkedin.com/jobs "Web Developer" PHP remote UK
site:linkedin.com/jobs PHP developer remote UK
```

## Location Filter

Candidate is based in Poulton-le-Fylde, UK, and is searching remote-only for now.
- Remote (UK-wide): PASS
- Hybrid with a mandatory office presence: FLAG (discuss with user - not remote-only)
- On-site only: FAIL (does not match current search constraint)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
