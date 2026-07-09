# Search Queries for Job Scraper

## Search Sites

Primary:
- **linkedin.com/jobs** - LinkedIn job listings (filter: United Kingdom / remote)
- **impactpool.org** - UN system, international development, humanitarian, and NGO roles worldwide

Sector-specific (international development / global health):
- **devex.com** - global development jobs and funding news
- **unjobs.org** - UN system roles
- **bond.org.uk** - UK international development network jobs board
- **reliefweb.int** - humanitarian sector jobs

Mission-driven / startup boards (browse directly, no reliable `site:` search pattern):
- **otta.com** (now Welcome to the Jungle)
- **cord.co**
- **escapethecity.org**
- **80000hours.org/job-board**
- **wellfound.com** (formerly AngelList Talent) - startup/scaleup jobs; blocks automated access behind Cloudflare, browse manually only

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Combine with location terms ("United Kingdom", "Remote UK", "London") where the site supports it.

### Priority 1: Head of Data / Director-level data leadership

Strongest and most desired career direction - Head of Data or Director-level roles with strategic scope.

```
site:linkedin.com/jobs "Head of Data" United Kingdom
site:linkedin.com/jobs "Director of Data" OR "Director of Analytics" United Kingdom
site:linkedin.com/jobs "Head of Analytics and Insights" United Kingdom
"Head of Data" OR "Director of Data & Analytics" healthtech UK
```

### Priority 2: Health & social care / healthtech domain

Matches direct domain expertise in health economics and health/social care analytics.

```
site:linkedin.com/jobs "Head of Data" healthtech UK
"Head of Data" OR "Director of Data" domiciliary care OR "health and social care" UK
"Head of Data" NHS OR "digital health" UK
```

### Priority 3: Adjacent mission-driven sectors (international development, global health, EdTech, housing)

Adjacent roles matching the operational-tempo-over-sector filter - commercial, operationally paced organisations in mission-driven sectors.

```
site:impactpool.org "Head of Data" OR "Director"
site:devex.com data OR analytics director
site:linkedin.com/jobs "Head of Data" OR "Director of Analytics" EdTech OR PropTech UK
"Head of Data" housing association OR PropTech UK
```

### Priority 4: Director of Strategy & Transformation (broader pathway roles)

Wider net for the longer-term Director of Strategy & Transformation → CEO/MD pathway.

```
site:linkedin.com/jobs "Director of Strategy" transformation UK
site:linkedin.com/jobs "Director of Strategy and Transformation" mission-driven OR B-Corp UK
```

### Target Companies (illustrative, not exhaustive)

Check career pages directly and via Google `site:` search for company-specific openings:
- Healthtech / care platforms: Birdie, Perci Health
- Mission-driven consumer / EdTech: Twinkl
- International development: WaterAid UK
- Housing / PropTech: Bromford Housing Group, Plentific

```
site:birdie.care careers
site:jobs.lever.co OR site:jobs.ashbyhq.com OR site:apply.workable.com "Head of Data"
```

## Location Filter

Candidate is Sheffield-based, targeting remote-friendly roles given a planned ~6-month period abroad from around late 2026. Commute tolerance scales with required office frequency and the office's distance from Sheffield:
- Fully remote - ideal
- Sheffield office, up to 5 days/week - acceptable
- Leeds or similar-distance city, up to 3 days/week - acceptable
- Manchester or similar-distance city, up to 2 days/week - acceptable
- London or similar-distance city, up to 1 day/week - acceptable
- Any role requiring more in-person time than the above for its distance, full relocation outside the UK, or with no remote flexibility at all - too far / deal-breaker

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
