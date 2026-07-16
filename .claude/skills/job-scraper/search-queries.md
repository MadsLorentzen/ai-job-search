# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

## Search Sites

Primary (India job boards):
- **linkedin.com/jobs** - LinkedIn job listings (India / Delhi NCR / Remote); also covered by `linkedin-search` CLI
- **naukri.com** - India's largest job board; covered by `naukri-search` CLI
- **instahyre.com** - Tech-focused India job board; covered by `instahyre-search` CLI
- **wellfound.com** - Startup jobs globally; covered by `wellfound-search` CLI
- **freehire.dev** - Tech job aggregator (covered by `freehire-search` CLI)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Each query should be combined with your location terms (e.g. your city, region, or metro area) where the site supports it.

### Priority 1: AI/ML Engineer & Full-Stack SDE with AI

These match Harsh's strongest and most desired career direction.

```
site:naukri.com "AI engineer" "Noida" OR "Delhi" OR "Ghaziabad" OR "remote"
site:naukri.com "machine learning engineer" "Noida" OR "Delhi" OR "remote"
site:linkedin.com/jobs "AI engineer" "Delhi NCR" OR "Noida" OR "remote India"
site:linkedin.com/jobs "full stack developer" "AI" "Noida" OR "Delhi" OR "remote"
site:instahyre.com "AI engineer" "Delhi NCR"
```

### Priority 2: SaaS Product Engineering (Full-Stack)

These match Harsh's SaaS and full-stack product experience.

```
site:naukri.com "software development engineer" "React" OR "Node.js" OR "Laravel" "Noida" OR "Delhi"
site:naukri.com "full stack developer" "SaaS" "Noida" OR "Delhi" OR "remote"
site:linkedin.com/jobs "software engineer" "React.js" "Node.js" "Delhi NCR" OR "remote India"
site:wellfound.com "full stack engineer" "AI" India
```

### Priority 3: LLM / Generative AI / Computer Vision

Emerging roles matching Harsh's LLM and CV experience.

```
site:naukri.com "LLM" OR "generative AI" engineer "Noida" OR "Delhi" OR "remote"
site:naukri.com "computer vision" engineer "Noida" OR "Delhi" OR "remote"
site:linkedin.com/jobs "prompt engineer" OR "LLM engineer" India remote
site:linkedin.com/jobs "computer vision" "Python" "Noida" OR "Delhi" OR "remote India"
```

### Priority 4: Backend / Node.js / Laravel SDE

Wider net for strong backend roles.

```
site:naukri.com "Node.js developer" "Noida" OR "Delhi" OR "remote"
site:naukri.com "Laravel developer" "Noida" OR "Delhi" OR "remote"
site:linkedin.com/jobs "backend engineer" "Node.js" "Delhi NCR" OR "remote India"
```

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance:
- Noida, Ghaziabad, Delhi, Greater Noida — all acceptable
- Remote (India) — acceptable
- Gurugram / Faridabad — borderline (~60-90 min commute), flag for user
- Outside India (on-site relocation required) — FAIL (deal-breaker unless explicitly remote)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
