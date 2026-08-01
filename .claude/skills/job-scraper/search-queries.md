# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search`, `freehire-search`, `remoteok-search`, and `weworkremotely-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

## Search Sites

Primary (your market's job boards - scaffold one with `/add-portal`):
- **linkedin.com/jobs** - LinkedIn job listings (filter: Remote / US / Europe / Denmark / India); also covered by `linkedin-search` CLI
- **RemoteOK** - fully remote roles worldwide; covered by `remoteok-search` CLI (public JSON API, robots.txt explicitly permits Claude agents)
- **We Work Remotely** - fully remote roles, categorized (programming/back-end/devops/etc.); covered by `weworkremotely-search` CLI (public RSS feeds, fully open robots.txt)
- **Danish portals** (Jobindex, Jobbank, Jobdanmark, Jobnet) - covered by installed CLI skills; kept active for the Denmark/Europe search track
- **freehire-search** - covered by installed CLI skill (country-agnostic)
- No India-specific board installed - Naukri's robots.txt explicitly disallows Claude/AI-agent user-agents (declined on request); Instahyre, Glassdoor, and Himalayas are all behind an active Cloudflare bot-challenge; Built In disallows crawling its payments/financial-services categories specifically; CutShort and web3.career/cryptocurrencyjobs.co render listings client-side (no data in the raw HTML) or gate their API behind email signup. Use `site:naukri.com` WebSearch as the India fallback, or `/add-portal` if a workable board turns up later.

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Geographic priority order: **Remote (any) > US market (USD comp preferred) > Europe/Denmark > India (Indore, Bengaluru, Ahmedabad, or elsewhere)**.

### Priority 1: Senior Backend Engineer (Node.js/TypeScript)

Strongest and most desired career direction.

```
site:linkedin.com/jobs "Node.js Engineer" remote OR "United States"
site:linkedin.com/jobs "Backend Engineer" NestJS remote
site:linkedin.com/jobs "Software Engineer" TypeScript backend remote OR "United States"
```

### Priority 2: Domain Expertise (Fintech, iGaming, SaaS, Crypto, Payments)

Match domain expertise and target sectors. **This is a bonus tier, not an exclusion filter** - Priority 1, 3, and 4 already cover skills-matched roles regardless of sector, so a strong Node.js/NestJS/TypeScript backend role outside these sectors is just as valid a hit.

```
site:linkedin.com/jobs "Backend Engineer" fintech OR payments remote OR "United States"
site:linkedin.com/jobs "Backend Engineer" iGaming OR "real money gaming" remote OR Europe
site:linkedin.com/jobs "Backend Engineer" crypto OR blockchain remote OR "United States"
site:linkedin.com/jobs "Backend Engineer" SaaS remote
site:remoteok.com backend fintech OR payments OR crypto
site:weworkremotely.com backend fintech OR payments OR crypto
```

### Priority 3: Adjacent Roles

Adjacent titles worth casting a wider net on.

```
site:linkedin.com/jobs "Full Stack Engineer" NestJS OR "Node.js" remote
site:linkedin.com/jobs "Staff Engineer" OR "Principal Engineer" Node.js OR TypeScript remote OR "United States"
```

### Priority 4: Broader Technical

Wider net for general Node.js/TypeScript backend roles.

```
site:linkedin.com/jobs "Node.js developer" remote
site:linkedin.com/jobs "Software Engineer" Redis OR Kafka OR Kubernetes remote OR India
```

## Location Filter

When evaluating results, classify by geographic tier rather than commute distance (remote-first search):
- **Ideal:** Remote (any country); US market roles (USD-denominated comp preferred)
- **Acceptable:** Europe / Denmark (remote or relocation, subject to visa sponsorship)
- **Borderline:** Relocation within India outside Indore - Bengaluru, Ahmedabad (discuss before applying)
- **Too far:** On-site-only roles requiring relocation with no sponsorship path and no remote option, outside India

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
