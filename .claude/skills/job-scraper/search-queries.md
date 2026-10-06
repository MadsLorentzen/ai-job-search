# Search Queries for Job Scraper

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

## Search Sites

Primary:
- **linkedin.com/jobs** - LinkedIn job listings, target filter: Worldwide (Remote)
- **naukri.com** - Naukri listings (India/Global remote)
- **indeed.com** - Indeed remote job listings

## Query Categories

### Priority 1: .NET Developer & Backend
These match your strongest and most desired career direction.
```
site:linkedin.com/jobs ".NET Developer" (Remote)
site:naukri.com ".NET Core" AND "Microservices" OR "Azure"
site:indeed.com/jobs "C# Developer" remote
```

### Priority 2: Full-Stack Engineer (Angular/React)
```
site:linkedin.com/jobs "Full Stack Developer" AND "Angular" OR "React" AND ".NET"
site:naukri.com "Full Stack Engineer" ".NET Core"
```

### Priority 3: AI-Augmented / Emerging Roles
```
site:linkedin.com/jobs "Software Engineer" AND ("Cursor" OR "GitHub Copilot" OR "Claude")
site:indeed.com/jobs "Generative AI" AND ".NET" remote
```

## Location Filter
- Target matching: **Remote** (Worldwide, and other countries globally)
- Acceptable areas: Open to global remote positions, especially US, UK, and Europe based companies hiring remote workers.
- Work arrangements: Hybrid/On-site in India is acceptable, but primary focus is remote.

## Language Filter
Your working languages and levels are in CLAUDE.md's Languages table. In this case, English (Professional).

## Date Filter
**CRITICAL**: Only include jobs posted within the **last 12 hours**. If using an API or scraping tool, enforce standard filtering `time_posted=past_12_hours` or equivalent on the portal to get only freshly posted opportunities. If using a WebSearch fallback, apply `when:12h` or similar search operators if supported.
