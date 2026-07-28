# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Note:** The Danish portal demos (`jobindex-search`, `jobnet-search`, `jobdanmark-search`, `jobbank-search`) are disabled (`enabled: false`) for this profile since the target market is London, UK, not Denmark. `linkedin-search` and `freehire-search` remain enabled. Consider running `/add-portal` to scaffold a UK-specific board (e.g. Indeed, Reed, CWJobs) when convenient.

## Search Sites

Primary:
- **linkedin.com/jobs** - LinkedIn job listings (filter: United Kingdom / London); covered by the `linkedin-search` CLI
- **indeed.co.uk** - UK's largest general job board (WebSearch fallback until a CLI is scaffolded via `/add-portal`)
- **reed.co.uk** - major UK job board (WebSearch fallback)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Each query should be combined with location terms (London, UK, or "remote UK") where the site supports it.

### Priority 1: AI Engineer / Agentic AI

These match the strongest and most desired career direction: production RAG pipelines, agentic AI workflows, LLM engineering.

```
site:indeed.co.uk "AI Engineer" London
site:indeed.co.uk "RAG" OR "LLM engineer" London OR remote
site:linkedin.com/jobs "AI Engineer" United Kingdom
site:linkedin.com/jobs "Agentic AI" OR "AI Agents" United Kingdom
site:reed.co.uk "AI Engineer" London
```

### Priority 2: Cloud / DevOps Engineer

Roles leaning on GCP/AWS/Kubernetes/Terraform and cloud-native AI deployment.

```
site:indeed.co.uk "Cloud Engineer" London OR remote
site:indeed.co.uk "MLOps Engineer" London OR "United Kingdom"
site:linkedin.com/jobs "Cloud Engineer" AI OR ML United Kingdom
site:reed.co.uk "DevOps Engineer" London
```

### Priority 3: ML Engineer / Robotics-Adjacent

Adjacent roles drawing on the MSc in Robotics, AI & Autonomous Systems and applied ML background.

```
site:indeed.co.uk "Machine Learning Engineer" London
site:linkedin.com/jobs "ML Engineer" Python United Kingdom
site:indeed.co.uk "Computer Vision Engineer" London OR remote
```

### Priority 4: Broader Technical / AI-Adjacent

Wider net for general AI/cloud-adjacent technical roles.

```
site:indeed.co.uk Python developer AI London
site:linkedin.com/jobs "Python developer" RAG OR LangChain United Kingdom
site:indeed.co.uk "AI solutions" consultant London
```

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance or is remote-eligible:
- London and Greater London - ideal
- Remote (UK-wide) - ideal
- Other UK cities (Manchester, Birmingham, Cambridge, etc.) - acceptable if hybrid/remote-friendly or the role is strong enough to justify relocation
- Outside the UK - only if the posting explicitly welcomes international applicants or offers visa sponsorship (see the eligibility gate in `04-job-evaluation.md` - Srija is on a UK Graduate visa and needs future sponsorship)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
