# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary:
- **linkedin.com/jobs** - LinkedIn job listings (filter: Germany / remote); also covered by `linkedin-search` CLI
- **freehire-search** CLI - general country-agnostic coverage
- **arbeitsagentur-search** CLI - Bundesagentur für Arbeit (Germany's official employment agency job board), added via `/add-portal`. Has a `--remote` flag (filters on each posting's own home-office flag) and a `--radius` flag for distance-based search around a city - useful for the remote-first, then Fulda/Frankfurt/Munich location preference. StepStone.de and Indeed Germany remain ruled out: each explicitly disallows automated search access in its own `robots.txt`.
- **xing-search** CLI - Xing (xing.com), the DACH-market professional network, added via `/add-portal`. Xing's own job-search page and GraphQL API are `robots.txt`-disallowed for every crawler, so this works differently from every other portal here: it caches Xing's public job-URL sitemap and verifies keyword matches against each candidate's server-rendered detail page rather than hitting a real search endpoint. See `.agents/skills/xing-search/url-reference.md` for the full access-rules writeup. Because the sitemap mixes years-old expired postings with current ones, a search can return fewer results than requested - that's expected, not a bug.

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies (none specified yet - candidate is open to any non-automotive sector)

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

**Organize by function, not job title.** The same underlying work carries different titles across companies and markets (a "Data Scientist" role at one employer may be posted as "Insights Analyst" or "Data Consultant" at another). Name each priority category after the function it covers, and list several plausible job titles as query variants within that category rather than betting an entire priority tier on one exact title string.

### Priority 1: Project / Technical Leadership

These match the strongest and most desired career direction: a full Project Lead role, owning delivery end-to-end (not just Scrum facilitation).

```
site:linkedin.com/jobs "Project Lead" Germany
site:linkedin.com/jobs "Technical Project Lead" Germany
site:linkedin.com/jobs "Projektleiter" Deutschland
"Project Lead" remote Germany
"Projektleiter" Softwareentwicklung remote
```

### Priority 2: Senior Embedded / C Engineering

These match deep technical domain expertise - the alternative target lane to Priority 1.

```
site:linkedin.com/jobs "Senior Embedded Engineer" Germany
site:linkedin.com/jobs "Senior C Engineer" OR "Senior C Developer" Germany
"embedded" "bare-metal" OR "low-level" C engineer remote
"Embedded Software Engineer" bare-metal Germany
"Eingebettete Systeme" Entwickler C remote
```

### Priority 3: Non-Automotive Sector Pivot (semiconductor, industrial, medtech, energy)

Sector-first queries rather than title-first, aimed squarely at the "leave automotive" goal - semiconductor (echoing the AMD/AIXTRON/Arm candidates found this session), industrial automation, medical devices, and energy are the sectors that have surfaced the strongest non-automotive matches so far.

```
site:linkedin.com/jobs "embedded" OR "firmware" semiconductor Germany
site:linkedin.com/jobs C engineer "medical device" OR "medizintechnik" Germany
"Embedded Software" Halbleiter OR semiconductor remote Germany
"Firmware Engineer" Germany -automotive
```

**Note:** this replaced a former "Agile / Scrum Leadership" category. The candidate does not want to work as a Scrum Master - see the Deal-breakers note below and `04-job-evaluation.md`'s Career goals. Scrum/SAFe remains a genuine skill worth mentioning in a cover letter for a Technical Lead role, but is no longer a search target on its own.

### Priority 4: Broader Technical / Consulting

Wider net for general technical roles, explicitly outside the automotive sector (see career goal in `01-candidate-profile.md` / `04-job-evaluation.md`).

```
"C developer" remote Germany -automotive
"technical consultant" embedded OR "low-level" Germany
site:linkedin.com/jobs "software engineer" C bare-metal -automotive
```

**Sector note:** the candidate has an explicit goal to leave the automotive industry after 8+ years in it. Deprioritize postings at automotive OEMs/Tier-1 suppliers unless the role is fully remote or otherwise a clearly strong match; a non-automotive sector is itself a positive signal in `04-job-evaluation.md`'s Career Alignment dimension.

**Skill note - C, not C++:** the candidate is expert-level in C but a self-assessed beginner in C++. Do not add "C++" as a search term on its own - a posting whose title or core requirement is C++ (e.g. "C++ Developer", "modern C++", "C++14/17/20") is a real skill gap, not a synonym for C. A posting listing "C or C++" or "C/C++" as an either/or requirement is fine to include, since C alone covers it; one requiring strong, independent C++ ownership is not, even if C also appears on the CV.

## Location Filter

When evaluating results, verify the job location matches the candidate's preference. Define acceptable areas:
- **Fully remote** - top preference, any location in Germany (or EU with compatible time zone)
- Fulda and surrounding area
- Frankfurt am Main
- Munich (acceptable, implies relocation)
- Any other location requiring relocation, without remote/hybrid flexibility (too far - deal-breaker, see `04-job-evaluation.md`)

Also treat a **hard-required 5 days/week in-office policy** and a **significant/frequent travel requirement** as deal-breakers regardless of city - see `04-job-evaluation.md`'s Location & Logistics dimension.

**Role-type note - not a Scrum Master.** The candidate does not want to work as a Scrum Master or Agile Coach, even though it is part of his current job title and a genuine skill. Do not search for or score up "Scrum Master" / "Agile Coach" as a target role on its own - see `04-job-evaluation.md`'s Career goals and Motivation filter.

**Sector exclusion - not defense.** The candidate does not want to work in the defense/military sector, even at a company that also has acceptable civilian divisions. Deprioritize and flag roles involving secure/military communications, cryptographic devices for government/military use, avionics/airborne defense, or weapons systems - and companies whose core business is defense (Rheinmetall, HENSOLDT, Helsing, Diehl, etc.) outright. See `04-job-evaluation.md`'s Motivation filter.

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
