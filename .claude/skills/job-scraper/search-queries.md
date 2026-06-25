# Search Queries for Job Scraper — Thomas Adair

<!-- PRE-POPULATED 2026-06-24: US/California focus, replacing Danish defaults -->
<!-- Target: North County San Diego / remote-from-CA / in-office SoCal/Bay Area/LA only -->
<!-- DO NOT include: relocation, in-office non-CA -->

## Search Sites

Primary (US job market — Phase B CLIs to build):
- **USAJOBS (data.usajobs.gov)** — federal/government roles; real public API; highest priority for clearance-eligible roles
- **ClearanceJobs.com** — defense, intel, cleared roles; highest signal for Secret clearance + USMC background
- **LinkedIn Jobs** — largest volume; filter: California, remote; use Claude in Chrome or LinkedIn Jobs API
- **Indeed.com** — broad coverage with GovTech mix
- **Built In** (builtin.com) — tech-specific with location filters

Secondary (direct company career pages):
- Google `site:` searches for Granicus, Palantir, Leidos, SAIC, Booz Allen Hamilton, MITRE, Microsoft Federal, AWS Public Sector, ServiceNow, Salesforce Government, Veeva, Tyler Technologies

## Query Categories

Queries are grouped by priority aligned with Thomas's target role types.
Location: combine with `"San Diego" OR "Oceanside" OR "remote" OR "California"` where site supports it.

### Priority 1: AI Implementation & Quality

Thomas's strongest differentiator — production AI quality infrastructure + regulated-environment ops background.

```
"AI implementation" quality analyst San Diego OR remote
"AI quality" lead California OR remote
"LLM quality" evaluation California OR remote
"AI governance" compliance California
"AI implementation specialist" government OR GovTech
site:usajobs.gov "artificial intelligence" quality
site:clearancejobs.com "AI" quality analyst
site:linkedin.com/jobs "AI implementation" quality California
```

### Priority 2: GovTech Program Manager / Compliance Lead

Second-strongest fit — clearance + USMC compliance track record.

```
"GovTech" program manager California OR remote
"government technology" program manager San Diego OR remote
compliance lead California "AI" OR "technology"
"risk and compliance" manager California remote
site:usajobs.gov "program manager" "AI" California
site:usajobs.gov "compliance" "quality assurance" California
site:clearancejobs.com "program manager" "Secret" California
site:linkedin.com/jobs "compliance lead" GovTech California
```

### Priority 3: Senior Operations Manager (SaaS / Fintech / RegTech)

Lateral move — strong leadership track record, adaptable to SaaS operations role.

```
"senior operations manager" SaaS California OR remote
"director of operations" fintech California OR remote
"head of operations" "AI" California OR remote
"VP operations" startup California remote
site:linkedin.com/jobs "senior operations manager" "AI" California remote
```

### Priority 4: Cleared AI/ML Roles (Defense / Intel)

Secret clearance hard differentiator for this category.

```
site:clearancejobs.com "machine learning" "Secret" California
site:clearancejobs.com "AI" "Secret clearance" California
site:clearancejobs.com "NLP" OR "LLM" "Secret" California
site:usajobs.gov "machine learning" California "Secret"
"cleared" "AI" "machine learning" California OR remote
```

### Priority 5: SkillBridge Programs

For final 180 days of service (projected 2028) — plant seeds now.

```
"SkillBridge" "AI" California
"SkillBridge" "technology" California "Secret"
"DoD SkillBridge" "program manager" OR "operations" California
site:usajobs.gov "SkillBridge" California
```

## Location Filter

When evaluating results, verify job location is within acceptable range:
- **Preferred:** Oceanside, North County San Diego — remote or hybrid (commute ≤45 min)
- **Acceptable remote:** Remote from California
- **Acceptable in-office:** San Diego County, Los Angeles, Bay Area (for right role)
- **EXCLUDE:** In-office outside California, relocation required, no visa sponsorship needed (he's a citizen)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline not yet passed.
Flag as "date unknown" if posting date cannot be determined — include but note.

## Salary Baseline (research before applying)

Estimated target range per profile (research via Levels.fyi / Glassdoor before any salary conversation):
- AI Implementation / Quality roles: $110–$150K base (GovTech tends lower ceiling; tech sector higher)
- Cleared defense/intel AI roles: $130–$180K base (clearance premium)
- Senior Ops Manager (SaaS): $120–$160K base

## Adapting Queries

When user specifies `/scrape [focus_area]`:
- Select queries from the matching priority category above
- Generate 2-3 custom queries for that focus using Thomas's specific skills
- Examples: `/scrape clearance` → Priority 4 queries + custom "Secret clearance AI California"; `/scrape govtech` → Priority 2 + custom Granicus/Leidos/SAIC queries

## Phase B Build Priority (US Portal CLIs)

CLIs to build (in priority order per reference-ai-job-search):
1. **USAJOBS** — public API at data.usajobs.gov, no auth required for basic search
2. **ClearanceJobs** — auth-required, may need scraper approach
3. **LinkedIn Jobs** — Claude in Chrome MCP approach
4. **Indeed** — scraper approach
5. **Built In** — scraper approach
