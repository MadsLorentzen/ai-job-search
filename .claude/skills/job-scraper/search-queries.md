# Search Queries for Job Scraper

<!-- Configured for Michael J. Marrujo: US-primary + English-speaking Europe, relocation-friendly. -->

## Search Sites

**Primary — country-agnostic:**
- **linkedin.com/jobs** — the built-in `linkedin-search` CLI skill (takes an explicit `-l "<location>"` flag; works for any US/EU market). This is the main portal for this profile.

**Secondary — US/global boards via Google `site:` searches:**
- **wellfound.com** (formerly AngelList Talent) — startup / founder's-associate / early-stage roles
- **ycombinator.com/jobs** (Work at a Startup) — YC-backed startups, many AI-native
- **greenhouse.io** / **lever.co** / **ashbyhq.com** — ATS domains where AI startups post directly (`site:jobs.lever.co "AI"`, `site:boards.greenhouse.io "forward deployed"`)
- **builtin.com** — US tech hubs
- Company career pages directly (Anthropic, OpenAI, and other AI labs/startups)

**Note on the shipped Danish CLIs (Jobindex, Jobbank, Jobdanmark, Jobnet):** these are secondary for this profile — only relevant if targeting Denmark specifically. LinkedIn covers the US and European English-speaking markets. To add a dedicated board for another market, run `/add-portal`.

## Query Categories

Queries are grouped by priority. Combine each with a location term (e.g. `"Remote"`, `"United States"`, `"San Francisco"`, `"New York"`, `"London"`, `"Dublin"`, `"Amsterdam"`, `"Berlin"`) where the site supports it. Michael is relocation-friendly, so run the top priorities across several locations.

### Priority 1: AI Strategy / AI Enablement (primary)

Strongest and most-desired direction.

```
linkedin-search -q "AI Strategist" -l "United States"
linkedin-search -q "AI Consultant" -l "Remote"
linkedin-search -q "AI enablement" -l "United States"
linkedin-search -q "AI adoption" -l "London, United Kingdom"
site:jobs.lever.co "AI Strategy"
site:boards.greenhouse.io "AI enablement"
```

### Priority 2: Founder's Associate / Generalist Operator

Rewards Michael's 0-to-1 range across ops, build, and GTM.

```
linkedin-search -q "Founder's Associate" -l "United States"
linkedin-search -q "Chief of Staff" -l "Remote"
linkedin-search -q "Business Operations" -l "United States"
site:wellfound.com "founder's associate"
site:ycombinator.com/jobs "generalist"
```

### Priority 3: Forward-Deployed / Solutions Engineer (stretch, backed by shipped apps)

Client-facing technical roles at AI/software companies.

```
linkedin-search -q "Forward Deployed Engineer" -l "United States"
linkedin-search -q "Solutions Engineer" -l "Remote"
linkedin-search -q "Solutions Architect AI" -l "United States"
site:boards.greenhouse.io "forward deployed"
site:jobs.ashbyhq.com "solutions engineer"
```

### Priority 4: Technical / Product PM & Business Operations Analyst (wider net)

Adjacent roles that leverage the build + cross-functional experience.

```
linkedin-search -q "Technical Product Manager" -l "United States"
linkedin-search -q "Associate Product Manager AI" -l "Remote"
linkedin-search -q "Business Operations Analyst" -l "United States"
linkedin-search -q "Revenue Operations" -l "United States"
```

### Priority 5: Boutique / Small Consulting Firms

Added 2026-07-10 per Michael's request to keep an eye on consulting and boutique-consulting roles alongside the AI-strategy search. Prefer boutique/mid-size shops over MBB/Big4-tier firms — those typically require 8+ years and a name-brand consulting pedigree Michael doesn't have (see DISCO AI Transformation Lead as an example of this gap).

```
linkedin-search -q "AI Consultant" -l "New York, NY"
linkedin-search -q "Business Consultant" -l "New York, NY"
linkedin-search -q "Associate Consultant" -l "United States"
site:jobs.lever.co "boutique consulting"
site:boards.greenhouse.io "boutique consulting"
```

## Location Filter

Michael has flagged a current preference for **New York, NY** — weight NY-based postings favorably when presenting results, but continue surfacing strong matches elsewhere too (this is a preference signal, not a hard filter).

Michael is **relocation-friendly** — geography is a wide net, not a hard filter.
- **Remote (US):** ideal
- **US tech hubs (SF Bay Area, NYC, Austin, LA/SoCal, Seattle):** ideal — open to relocating
- **Orange County / Greater LA:** current base (no relocation needed)
- **English-speaking Europe (London, Dublin, Amsterdam, Berlin), remote or relocation:** acceptable — FLAG visa/work-authorization (US citizen, needs sponsorship for EU) and timezone overlap for remote
- **Nordic countries (Copenhagen, Stockholm, Oslo, Helsinki):** acceptable in principle, but FLAG heavily — Michael has noted these markets frequently require local-language fluency even when the workplace language is English, on top of the same US-citizen visa/sponsorship barrier as the rest of the EU. Surface roles here only if the posting explicitly doesn't require the local language.
- **Non-English-primary work environments:** borderline — Spanish is fine, other languages a barrier

## Salary Filter

Flag roles advertising below ~$100K USD base as under-market. Don't auto-reject — surface with the flag.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape founder's associate" -> Priority 2 queries + custom focus-specific queries
- "/scrape europe" -> run Priority 1-3 with European location flags (London, Dublin, Amsterdam, Berlin)
