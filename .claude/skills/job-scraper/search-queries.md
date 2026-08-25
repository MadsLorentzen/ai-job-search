# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary (structured, via Lane A CLI):
- **linkedin.com/jobs** - searched with the `linkedin-search` CLI (`.agents/skills/linkedin-search/cli/src/cli.ts`), not via web search

Primary (web search lane, site-scoped Google queries):
- **naukri.com** - India's largest job board (detail pages often block WebFetch; use snippet fallback)
- **foundit.in** - broad tech and business roles
- **shine.com** - IT, engineering, and business roles
- **timesjobs.com** - large Indian job board
- **instahyre.com** - tech/product/startup roles

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by role family. Replace `[ROLE]` with a target job title from the family and `[SKILLS]` with your key skills.
Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

**Priority rule:** within every category, **Remote India queries are TOP PRIORITY — run them first and present remote matches at the top**. City-scoped queries rotate geography in this order: `"Bengaluru" OR "Bangalore"` → `"Hyderabad"` → `"Pune"` → `("Delhi" OR "Gurugram" OR "Gurgaon") / "Delhi NCR"`.

### Software Engineering

Suggested `[ROLE]`: software engineer, backend developer, full stack developer, SDET

```
site:naukri.com "[ROLE]" ("remote" OR "work from home") India
site:instahyre.com [ROLE] remote
site:linkedin.com/jobs "[ROLE]" remote India
site:naukri.com "[SKILLS]" ("Bengaluru" OR "Bangalore")
site:foundit.in "[ROLE]" ("Hyderabad")
site:shine.com "[SKILLS]" developer ("Pune")
site:timesjobs.com "[ROLE]" ("Delhi" OR "Gurgaon" OR "Gurugram" OR "Delhi NCR")
```

### Data Engineering

Suggested `[ROLE]`: data engineer, analytics engineer, ETL developer, big data engineer

```
site:naukri.com "[ROLE]" ("remote" OR "work from home") India
site:linkedin.com/jobs "[SKILLS]" remote India
site:naukri.com "[ROLE]" ("Bengaluru" OR "Bangalore")
site:foundit.in "[SKILLS]" ("Hyderabad" OR "Pune")
site:shine.com "[ROLE]" ("Delhi" OR "Gurgaon" OR "Gurugram" OR "Delhi NCR")
```

### Data Science & Analytics

Suggested `[ROLE]`: data scientist, data analyst, BI analyst, analytics consultant

```
site:naukri.com "[ROLE]" ("remote" OR "work from home") India
site:instahyre.com [ROLE] remote
site:naukri.com "[SKILLS]" ("Bengaluru" OR "Bangalore")
site:timesjobs.com "[ROLE]" ("Hyderabad" OR "Pune")
site:foundit.in "[SKILLS]" analyst ("Delhi" OR "Gurgaon" OR "Gurugram" OR "Delhi NCR")
```

### Machine Learning & AI

Suggested `[ROLE]`: machine learning engineer, AI engineer, MLOps engineer, applied scientist

```
site:naukri.com "[ROLE]" ("remote" OR "work from home") India
site:linkedin.com/jobs "[ROLE]" remote India
site:instahyre.com "[SKILLS]" ("Bengaluru" OR "Bangalore")
site:foundit.in "[ROLE]" ("Hyderabad" OR "Pune")
site:shine.com "[ROLE]" ("Delhi" OR "Gurgaon" OR "Gurugram" OR "Delhi NCR")
```

### DevOps & Cloud

Suggested `[ROLE]`: DevOps engineer, site reliability engineer, platform engineer, cloud engineer

```
site:naukri.com "[ROLE]" ("remote" OR "work from home") India
site:naukri.com "[SKILLS]" ("Bengaluru" OR "Bangalore")
site:foundit.in "[ROLE]" ("Hyderabad")
site:timesjobs.com "[SKILLS]" ("Pune" OR "Delhi" OR "Gurgaon" OR "Gurugram" OR "Delhi NCR")
```

### Product Management

Suggested `[ROLE]`: product manager, associate product manager, technical product manager

```
site:naukri.com "[ROLE]" ("remote" OR "work from home") India
site:instahyre.com "[ROLE]" product remote
site:linkedin.com/jobs "[ROLE]" ("Bengaluru" OR "Bangalore")
site:naukri.com "[ROLE]" ("Hyderabad" OR "Pune")
site:foundit.in "[ROLE]" ("Delhi" OR "Gurgaon" OR "Gurugram" OR "Delhi NCR")
```

### Business & Operations Analyst

Suggested `[ROLE]`: business analyst, operations analyst, program analyst, strategy analyst

```
site:naukri.com "[ROLE]" ("remote" OR "work from home") India
site:shine.com "[ROLE]" remote India
site:foundit.in "[SKILLS]" ("Bengaluru" OR "Bangalore" OR "Hyderabad")
site:naukri.com "[ROLE]" ("Pune")
site:timesjobs.com "[SKILLS]" ("Delhi" OR "Gurgaon" OR "Gurugram" OR "Delhi NCR")
```

## Geography & Priority Filter

Result ordering follows this priority - verify each job's location against it:

1. **Remote (India)** - TOP PRIORITY. Remote/work-from-home roles open to candidates anywhere in India. Always surfaced first.
2. **Bengaluru** (also indexed as Bangalore)
3. **Hyderabad**
4. **Pune**
5. **Delhi / Gurugram / Gurgaon** (the "Delhi NCR" cluster)

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown". For Naukri results recovered from snippets (blocked pages), rely on the snippet's stated posting age when available.

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
