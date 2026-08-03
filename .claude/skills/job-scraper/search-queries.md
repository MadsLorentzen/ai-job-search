# Search Queries for Job Scraper

<!-- Customized for Chan San Kit Samuel by /setup (Aug 2026): AI/ML Engineer Intern + AI/LLM Evaluation & QA Intern, Hong Kong only -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

## Search Sites

Primary (Hong Kong job boards):
- **hk.jobsdb.com** - JobsDB Hong Kong, the market's largest board; covered by the `jobsdb-hk-search` CLI, with `site:hk.jobsdb.com` as a WebSearch fallback
- **linkedin.com/jobs** - LinkedIn job listings (filter: Hong Kong); also covered by `linkedin-search` CLI
- **freehire** - country-agnostic aggregator; covered by `freehire-search` CLI

Manual-only (cannot be automated):
- **CUHK career portal** - requires CUHK login + Duo MFA, so no CLI can reach it. Check manually about once a week; valuable for on-campus research-assistant / student-helper roles and CUHK-partner internships.

Optional future additions (run `/add-portal` to build a CLI): CTgoodjobs, cpjobs.

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies, and the HKSTP / Cyberport startup directories (stated dream employers)

## Query Categories

Queries are grouped by priority. Each query should be combined with your location terms (Hong Kong) where the site supports it. Internship synonym keywords to mix in: `intern`, `internship`, `trainee`, `placement`, `student helper`, `part-time intern`, plus `penultimate` and `summer 2027` for program-based recruiting.

### Priority 1: AI/LLM Evaluation & QA Intern

Samuel's strongest and most distinctive direction (two internships in exactly this domain).

```
site:hk.jobsdb.com "AI intern" Hong Kong
site:hk.jobsdb.com "AI testing intern" Hong Kong
site:hk.jobsdb.com "LLM" intern Hong Kong
site:hk.jobsdb.com "RAG" Hong Kong
site:linkedin.com/jobs "AI intern" Hong Kong
site:linkedin.com/jobs "QA intern" AI Hong Kong
```

### Priority 2: AI/ML Engineer Intern

Matches the degree and long-term career direction.

```
site:hk.jobsdb.com "machine learning intern" Hong Kong
site:hk.jobsdb.com "AI engineer intern" Hong Kong
site:hk.jobsdb.com "deep learning" intern Hong Kong
site:linkedin.com/jobs "machine learning intern" Hong Kong
site:linkedin.com/jobs "NLP intern" Hong Kong
```

### Priority 3: Adjacent Data Roles

Adjacent roles that still build toward an AI career.

```
site:hk.jobsdb.com "data science intern" Hong Kong
site:hk.jobsdb.com "data analyst intern" python Hong Kong
site:linkedin.com/jobs "data science intern" Hong Kong
```

### Priority 4: Broader Tech Internships & Programs

Wider net, including program-based recruiting and startup-hub directories.

```
site:hk.jobsdb.com "software engineer intern" Hong Kong
site:hk.jobsdb.com "summer internship 2027" technology Hong Kong
site:hk.jobsdb.com "penultimate" internship Hong Kong
site:linkedin.com/jobs "summer internship 2027" Hong Kong technology
"HKSTP" OR "Hong Kong Science Park" "AI intern"
"Cyberport" startup "AI intern" OR "machine learning intern"
```

**Timing note:** Samuel graduates July 2028, so summer 2027 is his penultimate summer - he is eligible for "penultimate-year" internship programs. Large HK programs (banks, conglomerates, MNC tech) typically recruit for summer internships between September and March; startup internships appear year-round.

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance from Tseung Kwan O:
- **Ideal:** Tseung Kwan O (incl. TKO Industrial Estate); Kwun Tong / Kowloon East; HK Island East (North Point, Quarry Bay, Taikoo Shing)
- **Acceptable:** rest of Kowloon; HK Island (Central, Admiralty, Wan Chai, Causeway Bay); Shatin / HK Science Park (HKSTP - target startup hub, worth the commute); Cyberport (target startup hub, ~60-75 min); Tsuen Wan / Kwai Fong
- **Borderline:** Tsing Yi, Tung Chung / Airport (>60 min by transit)
- **Too far:** Tuen Mun, Yuen Long, Tin Shui Wai (>75 min); anywhere outside Hong Kong (deal-breaker)

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
