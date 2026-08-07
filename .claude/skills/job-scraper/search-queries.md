# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary (Spain's largest general job boards - scaffold one with `/add-portal` for a CLI):
- **InfoJobs** (infojobs.net) - Spain's largest general job board
- **linkedin.com/jobs** - LinkedIn job listings (filter: Spain / EU); also covered by `linkedin-search` CLI
- **Tecnoempleo** (tecnoempleo.com) - Spain's main IT/tech-focused job board (optional)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above), and combine each query with your location terms where the site supports it. The candidate is open to **any AI/ML role**, so priority reflects search breadth, not preference strength.

### Priority 1: AI/ML Engineer (general)

Broadest match - any AI/ML engineering role satisfies.

```
site:infojobs.net "AI Engineer" OR "Machine Learning Engineer" España
site:linkedin.com/jobs "AI Engineer" OR "ML Engineer" Spain
site:tecnoempleo.com "inteligencia artificial" OR "machine learning" junior
```

### Priority 2: Computer Vision

```
site:infojobs.net "Computer Vision" OR "visión por computador" España
site:linkedin.com/jobs "Computer Vision Engineer" Spain
site:linkedin.com/jobs "YOLO" OR "PyTorch" "computer vision" Spain
```

### Priority 3: LLM / RAG / Agentic Systems

```
site:infojobs.net "LLM" OR "RAG" ingeniero España
site:linkedin.com/jobs "LLM Engineer" OR "RAG" Spain
site:linkedin.com/jobs "LangGraph" OR "agentic" Spain
```

### Priority 4: Broader Technical / Applied ML

Wider net for general technical roles that could still be a fit.

```
site:infojobs.net "Python" desarrollador España
site:linkedin.com/jobs "Python developer" OR "backend" "machine learning" Spain
site:tecnoempleo.com "Python" "FastAPI" OR "Docker" junior
```

## Location Filter

Candidate is fully open on location - prefers Ourense/Spain or remote, but willing to relocate anywhere in the EU. Define acceptable areas:
- Ourense and Galicia (ideal - home region)
- Rest of Spain, remote within Spain (acceptable)
- Anywhere in the EU, including relocation (acceptable)
- Outside the EU (too far, unless remote and visa-free)

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
