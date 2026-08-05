# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. You do **not** need a matching `site:` line below for those CLIs to run.

**This fork is configured for the US market.** Active portals:

| Portal | Role |
|--------|------|
| `themuse-search` | **Primary** cross-company US discovery (~400k postings) |
| `linkedin-search` | Country-agnostic, pass a US location |
| `greenhouse-search` | **ATS, role-first via `--registry`** (79 boards, ~10.8k postings, ~5s) or by `--company` |
| `lever-search` | ATS, role-first via `--registry` (15 sites) or by `--company` |
| `weworkremotely-search` | Remote-only; per-category RSS feeds |
| `remotive-search` | Remote-only; small supplementary feed (~32 jobs) |
| `freehire-search` | Country-agnostic tech aggregator |
| `usajobs-search` | Federal jobs — **`enabled: false`** until `USAJOBS_API_KEY`/`USAJOBS_EMAIL` are set |
| `jobindex` / `jobnet` / `jobdanmark` / `jobbank` | Danish — **`enabled: false`**, skipped by `/scrape` |

The two ATS portals have no cross-company search *API*, but `--registry` works
around it by sweeping every known board concurrently. **`/scrape` should call them
with `--registry --us-remote`** — this is the highest-signal channel, since it hits
employers directly rather than through an aggregator.

Two usage rules for them:
- **Search role nouns, not languages.** `--query` matches the job TITLE only.
  `-q "senior software engineer"` returns 179 remote matches; `-q "golang"` returns 1,
  because titles say "Backend Engineer" and name Go only in the description.
- **Use `--us-remote`, not `-l "Remote"`.** US remote is spelled four different ways,
  and plain "Remote" wrongly admits Remote Canada/Poland/Spain.
- Grow coverage with `discover "<Company>"`. A company on neither ATS is likely on
  Ashby (Ramp, Deel, Rippling).

**Deliberately absent:** Indeed, ZipRecruiter and SimplyHired block automated access
(HTTP 401/403), and Dice's `robots.txt` disallows its job paths. Cover those through
the WebSearch fallback below, not a CLI.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary — covered by installed CLIs, no `site:` line needed:
- **themuse.com** — `themuse-search` (main cross-company US discovery)
- **linkedin.com/jobs** — `linkedin-search` (pass `-l "Remote"` or a US metro)
- **weworkremotely.com** — `weworkremotely-search` (remote-only, category feeds)
- **remotive.com** — `remotive-search` (small remote feed)
- **usajobs.gov** — `usajobs-search` (federal)
- **freehire.me** — `freehire-search` (tech aggregator)

Secondary — WebSearch fallback, since these block CLI access:
- `site:indeed.com`, `site:ziprecruiter.com`, `site:dice.com`, `site:builtin.com`, `site:wellfound.com`
- Direct `site:` searches against target-company career pages

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

All queries are **remote-first, US-wide**. Where a portal takes a location flag,
use `Remote` / `United States`; see the Location Gate in `04-job-evaluation.md`
for the remote-in-name-only trap.

### Priority 1: Senior / Staff Backend Engineer (Go, .NET)

Strongest and most recent evidence base. Run these first.

CLI terms: `senior software engineer`, `staff software engineer`, `backend engineer`,
`golang`, `go engineer`, `.net`, `c#`, `distributed systems`, `microservices`, `platform engineer`

```
site:builtin.com "senior software engineer" golang remote
site:wellfound.com "backend engineer" go remote
site:indeed.com "staff software engineer" (golang OR ".net") remote
```

### Priority 2: Payments / Fintech

Narrower, stronger match story. ~4 years recent domain experience — lead with the
specific systems (cross-border settlement, Visa/Mastercard integration), not duration.

CLI terms: `payments engineer`, `fintech backend`, `payments platform`, `transaction processing`,
`card processing`, `money movement`, `ledger`, `settlement`, `payments infrastructure`

```
site:builtin.com payments engineer remote
site:indeed.com "payments platform" (engineer OR developer) remote
site:wellfound.com fintech backend engineer remote
```

### Priority 3: Engineering Lead / Tech Lead

Player-coach roles that keep technical ownership. Score on demonstrated
responsibility (team of 7, hiring, mentorship), not on job titles held.

CLI terms: `tech lead`, `technical lead`, `lead engineer`, `lead software engineer`,
`engineering manager`, `staff engineer`

```
site:builtin.com "tech lead" backend remote
site:indeed.com "engineering manager" (golang OR ".net" OR backend) remote
```

### Priority 4: Broader Technical / Consulting

Wider net when the first three run thin.

CLI terms: `software engineer`, `senior developer`, `api engineer`, `cloud engineer`,
`solutions architect`, `azure`, `gcp`

```
site:indeed.com "senior software engineer" azure remote
site:dice.com golang developer remote
site:builtin.com "solutions architect" remote
```

### Priority 5: Federal (usajobs-search only)

Different vocabulary — federal postings use series codes and plain titles.

CLI terms: `software engineer`, `IT specialist`, `computer scientist`, `application developer`
(job category `2210` is the IT series). Use `--remote`, but note federal remote
inventory is genuinely thin (~13 open remote postings at last check).

## Location Filter

This search is **remote-first**, so the filter is about remote *eligibility*, not commute distance.

**PASS:**
- Fully remote, US-wide
- Remote, US, with occasional travel to a hub (quarterly or less)
- On-site or hybrid within **Cedar Falls / Waterloo, IA** and surrounding areas

**FAIL:**
- Remote but restricted to states or timezones that exclude **Iowa (US Central)** — check the
  posting's state-eligibility list, which is often buried and frequently omits IA
- Hybrid requiring regular on-site days anywhere outside the Waterloo–Cedar Falls area
- Requires relocation
- Non-US / requires work authorization outside the US

**The trap to watch:** a posting titled "Remote" that later says "must be located in <metro>"
or lists approved states. Read the full location section before marking a result PASS.

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
