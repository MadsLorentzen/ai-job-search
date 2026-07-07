# Search Queries for Job Scraper

## Search Sites

**Note:** The original scraper skill is wired against Danish job portals (jobindex, jobnet, etc.). Those are not relevant for a US-based search out of Brooklyn. The queries below are written for sites and patterns that actually fit the search profile. The scraper code itself may need updating to fetch from these sources rather than the Danish portals.

Primary (US growth job market):
- **linkedin.com/jobs** - largest signal for growth and PM roles
- **wellfound.com** (formerly AngelList) - startup-heavy, often surfaces seed/Series A roles not posted elsewhere
- **rippling.com/careers** style company-direct pages for target companies (OpenAI, Anthropic, etc.)

Secondary (Google site-searches):
- Direct Google searches with `site:` filters for target company career pages
- Greenhouse and Lever ATS searches via `site:boards.greenhouse.io` and `site:jobs.lever.co`

## Query Categories

Queries are grouped by priority. Each query should be combined with location terms (Remote, Brooklyn, New York City) where the site supports it.

### Priority 1: Senior Growth Leadership

These match the strongest and most desired career direction.

```
site:linkedin.com/jobs "VP of Growth" remote OR "New York"
site:linkedin.com/jobs "Head of Growth" remote OR "New York"
site:linkedin.com/jobs "Director of Growth" remote OR "New York"
site:wellfound.com "VP of Growth" OR "Head of Growth"
```

### Priority 2: Senior Growth IC at Frontier AI Labs

Specifically targeting OpenAI, Anthropic, and adjacent frontier AI companies. IC growth roles are explicitly in scope at these companies (validated via the OpenAI Growth final-round process Jan-mid-May 2026).

```
site:openai.com/careers growth
site:anthropic.com/careers growth
site:boards.greenhouse.io openai growth
site:boards.greenhouse.io anthropic growth
site:job-boards.greenhouse.io openai growth
site:linkedin.com/jobs OpenAI growth
site:linkedin.com/jobs Anthropic growth
site:linkedin.com/jobs "Growth Product Manager" "OpenAI" OR "Anthropic" OR "Cohere" OR "Mistral" OR "Inflection"
```

### Priority 3: Lifecycle, Messaging, Email Leadership

Lifecycle and email is a depth area, not a side skill. These queries treat it as a primary lane.

```
site:linkedin.com/jobs "Head of Lifecycle" remote OR "New York"
site:linkedin.com/jobs "Director of Lifecycle Marketing" remote OR "New York"
site:linkedin.com/jobs "Head of Email Marketing" remote OR "New York"
site:linkedin.com/jobs "Lifecycle Marketing Lead" PLG
site:wellfound.com "lifecycle" OR "email" growth
```

### Priority 4: Sr. Product Manager (Growth) at AI / PLG Companies

```
site:linkedin.com/jobs "Senior Product Manager, Growth" remote OR "New York"
site:linkedin.com/jobs "Sr. Product Manager, Growth" remote OR "New York"
site:linkedin.com/jobs "Growth Product Manager" AI remote
site:linkedin.com/jobs "Growth PM" PLG remote
site:wellfound.com "Growth PM" AI
```

### Priority 4b: AI Product Manager (building AI products)

PM roles where AI IS the product, not a bolt-on. Two angles: (a) AI-in-title PM roles anywhere; (b) ANY PM role at an AI-core company (caught by the ATS Sweep 1C, which runs broad PM titles across every `ai`/`ai-work`/`frontier-ai`/`agentic-platform`-tagged company in companies.json). Referral-covered AI companies (OpenAI, Anthropic, Cohere, Sierra, Perplexity, Cursor, Notion, etc.) route to the referral track, not cold apply.

```
site:linkedin.com/jobs "Product Manager, AI" remote OR "New York"
site:linkedin.com/jobs "AI Product Manager" remote OR "New York"
site:linkedin.com/jobs "Product Manager, Agents" OR "Agent Product Manager" remote OR "New York"
site:linkedin.com/jobs "Product Manager, Generative AI" remote OR "New York"
site:linkedin.com/jobs "Founding Product Manager" AI remote OR "New York"
```

### Priority 5: Growth Engineering and Adjacent Builder Roles

Builder-operator roles where the engineering background is the differentiator.

```
site:linkedin.com/jobs "Growth Engineer" remote OR "New York"
site:linkedin.com/jobs "Founding Growth" remote OR "New York"
site:wellfound.com "Founding Growth" OR "Founding Engineer"
```

### Priority 6: Fractional / Advisory (Omega Point pipeline)

Used to feed the parallel Omega Point fractional pipeline, not the full-time search.

```
site:linkedin.com/jobs "Fractional Head of Growth"
site:wellfound.com fractional growth advisor
```

## Target Companies for Monitoring

Direct career-page pings when ATS / RSS / scraping permits:
- **OpenAI** (kept on active pipeline as of mid-May 2026 - check carefully for new Growth roles)
- **Anthropic**
- **Cohere**
- **Mistral**
- **Inflection**
- **Perplexity**
- **Adept**
- (extend this list as the AI-lab landscape evolves)

## Location Filter

When evaluating results, verify the role fits the location profile:

- **Ideal:** Remote (US)
- **Acceptable:** Hybrid or on-site in NYC (commute from Brooklyn)
- **Borderline:** Other US metros with a strong remote-friendly culture or compelling relocation package
- **Skip:** On-site only outside NYC unless the role is otherwise stellar in mission, role, or comp

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. Examples:
- `/scrape lifecycle` -> Priority 3 queries + 2-3 lifecycle-specific custom queries
- `/scrape openai` -> Priority 2 queries narrowed to OpenAI plus a direct career-page check
- `/scrape fractional` -> Priority 6 queries
