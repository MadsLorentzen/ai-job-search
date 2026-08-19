# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Dual-market search: **UK** (commutable from Reading, Berkshire) and **Germany** (English-speaking roles only — relocation planned independently via the Chancenkarte, not employer-sponsorship-dependent). See `04-job-evaluation.md`'s candidate-specific timing gate — UK roles are time-critical (current Skilled Worker visa expires February 2027, current employer cannot sponsor a transfer), so UK results should be checked for active sponsor status before scoring.

Primary:
- **linkedin.com/jobs** - LinkedIn job listings (filter: United Kingdom / Germany); also covered by `linkedin-search` CLI
- `freehire-search` CLI - country-agnostic, covers both markets
- `stepstone-search` CLI - StepStone.de, Germany-specific; searches by job title + optional city (e.g. `-q "Product Owner" -l "Berlin"`). No `--jobage`/`--page` support (robots.txt constraint - see `.agents/skills/stepstone-search/url-reference.md`), so treat it as a single best-page-of-results source per query rather than an exhaustive crawl
- `arbeitnow-search` CLI - Arbeitnow, Germany-focused aggregator skewing toward English-speaking/remote-friendly listings; supports `--query`, `--location`, `--jobage`, and `--page`, but all filtering is client-side against one page at a time (the API itself has no server-side search - see `.agents/skills/arbeitnow-search/url-reference.md`), so a combined query+location+jobage filter can legitimately return nothing on a given page even when matches exist further back - call again with a higher `--page` rather than assuming zero results means no matches

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies (card networks, digital banks, wallet providers)

## Query Categories

Queries are grouped by priority. All queries are in English only — the candidate's German is A0, and the Germany search targets English-speaking roles specifically, so no German-language query variants are needed (see Language scope above). Combine each query with UK or Germany location terms depending on which market it targets.

### Priority 1: Product Owner / Product Manager - Digital Payments

These match the strongest and most desired career direction.

```
site:linkedin.com/jobs "Product Owner" payments Reading OR London OR UK
site:linkedin.com/jobs "Product Manager" wallet OR tokenisation OR "card network" UK
site:linkedin.com/jobs "Product Owner" payments Germany
site:linkedin.com/jobs "Product Manager" fintech Germany English-speaking
```

### Priority 2: Payments & Fintech Domain Expertise

These match deep domain expertise in digital payments, wallets, and card networks.

```
site:linkedin.com/jobs "digital payments" "product owner" UK
site:linkedin.com/jobs tokenisation OR "virtual card" OR "wallet integration" product UK OR Germany
site:linkedin.com/jobs "card network" OR "issuer processor" product owner Germany
```

### Priority 3: Senior/Lead Product roles & Delivery Management

Adjacent roles - a step up in seniority, or leaning into the delivery-management side of the current dual role.

```
site:linkedin.com/jobs "Senior Product Owner" OR "Lead Product Owner" payments UK OR Germany
site:linkedin.com/jobs "Delivery Manager" OR "Agile Delivery Lead" payments OR fintech UK OR Germany
```

### Priority 4: Pre-Sales / Solutions Consulting (fintech)

Wider net, leaning into the pre-sales/commercial background instead.

```
site:linkedin.com/jobs "Pre-Sales" OR "Solutions Consultant" fintech OR banking UK OR Germany
site:linkedin.com/jobs "Solution Architect" payments banking UK OR Germany
```

## Location Filter

Two independent markets, evaluated differently:

**UK** (commute-based, from Reading, Berkshire):
- Reading, Berkshire and the Thames Valley (ideal)
- London (acceptable - commutable via rail)
- Elsewhere in the UK (borderline - only for an exceptional fit, given the Feb 2027 visa deadline makes speed more important than location flexibility)

**Germany** (relocation-based, not commute-based):
- Any German city is in scope, since relocation is planned independently via the Chancenkarte
- Hard filter: the role itself must be English-speaking (see Language Filter below) - this matters more than which city it's in

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
