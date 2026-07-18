# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Taiwan portals not yet scaffolded:** 104, Cake (CakeResume), and Yourator have no shipped CLI. They run via the `site:` fallback below; scaffold dedicated skills with `/add-portal` when you want first-class scraping.

## Search Sites

Primary (your market's job boards):
- **104.com.tw** - Taiwan's largest general job board (scaffold with `/add-portal`)
- **cake.me** - Cake (CakeResume) - tech / startup roles in Taiwan and remote
- **yourator.co** - Yourator - startup / tech job board in Taiwan
- **linkedin.com/jobs** - LinkedIn job listings (filter: Taiwan / Remote); also covered by `linkedin-search` CLI

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Emphasis is on **remote / hybrid** roles (location-flexible), with Greater Taipei acceptable for on-site.

### Priority 1: Product Management (PM / Senior PM / AI PM)

These match your strongest and most desired career direction.

```
site:104.com.tw "Product Manager" AI remote
site:cake.me "Product Manager" AI
site:yourator.co "產品經理" AI
site:linkedin.com/jobs "Senior Product Manager" (Taiwan OR Remote)
site:linkedin.com/jobs "AI Product Manager" remote
```

### Priority 2: AI / ML Product & Industrial AI (domain)

These match your domain expertise.

```
site:104.com.tw ("AI 產品" OR "MLOps" OR "no-code AI") remote
site:cake.me ("ML Product Manager" OR "AI platform") 
site:linkedin.com/jobs ("machine learning product" OR "industrial AI") (Taiwan OR Remote)
site:linkedin.com/jobs "MLOps product" remote
```

### Priority 3: Head of Product / Director & Technical PM / Solutions

Adjacent roles (leadership up, or technical/solutions sideways).

```
site:linkedin.com/jobs ("Head of Product" OR "Director of Product") (Taiwan OR Remote)
site:cake.me ("Head of Product" OR "產品總監")
site:104.com.tw "Technical Product Manager" remote
site:linkedin.com/jobs "Solutions Consultant" AI remote
```

### Priority 4: Broader Product / Data Product

Wider net for general product and data-product roles.

```
site:104.com.tw ("data product" OR "product-led growth") remote
site:linkedin.com/jobs "product manager" (SaaS OR platform) remote
site:cake.me "product manager" data
```

## Location Filter

Preferred mode is **remote / hybrid** (location-flexible). For on-site roles, verify the location is within reasonable commute distance from Taipei:
- Remote / hybrid (anywhere): preferred
- Taipei City: ideal for on-site
- New Taipei City (Greater Taipei): acceptable
- Taoyuan / Hsinchu: borderline (long commute; prefer hybrid)
- Outside northern Taiwan with no remote option: too far (unless relocation is offered)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
