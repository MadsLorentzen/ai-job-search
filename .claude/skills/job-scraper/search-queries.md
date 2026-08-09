# Search Queries for Job Scraper

<!-- Personalized for Song LIN - Frankfurt am Main, German IT market -->
<!-- Working languages: German (fluent/verhandlungssicher), English (fluent/verhandlungssicher), Chinese (native) -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** - for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (here: German and English - Chinese is native but the German market posts in German/English, so queries stay in those two languages). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded - see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule.

## Search Sites

Primary (your market's job boards - scaffold one with `/add-portal`):
- **stepstone.de** - one of Germany's largest general job boards
- **xing.com / kununu.com** - DACH professional network and employer reviews (Xing jobs)
- **linkedin.com/jobs** - LinkedIn job listings (filter: Germany / Frankfurt); also covered by `linkedin-search` CLI
- **jobvector.de** - engineering/IT specialist board for the German market (optional)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies (Continental, Aumovio, and other large German enterprises with SAP BW/AI functions)

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (German and English - see Language scope above). Combine each query with your location terms (Frankfurt / Rhein-Main / Hessen) where the site supports it.

### Priority 1: SAP BW / SAP Analytics Cloud Specialist (Primary direction)

These match your strongest and most desired career direction - SAP BW/HANA analytics technical specialist + sub-project lead, the direction confirmed by the Frankfurt IT Specialist Project/System role.

```
site:stepstone.de "SAP BW" "ABAP OO" Frankfurt
site:stepstone.de "SAP Analytics Cloud" Frankfurt OR Rhein-Main
site:stepstone.de "SAP Business Warehouse" Frankfurt OR Hessen
site:jobvector.de "SAP HANA" "SAP UI5" Frankfurt
site:linkedin.com/jobs "SAP BW" Frankfurt Germany
site:linkedin.com/jobs "SAP Analytics Cloud" "ABAP" Frankfurt
site:stepstone.de "IT Specialist" "SAP BW" Frankfurt
site:linkedin.com/jobs "SAP BW" "Rollout" OR "Migration" Frankfurt
```

### Priority 2: Data Engineering / MLOps Lead (Domain expertise - Aumovio direction)

These match your Data Engineering / MLOps competency-area lead work at Aumovio.

```
site:stepstone.de "Data Engineering" Lead Frankfurt OR Rhein-Main
site:stepstone.de "MLOps" "AWS" Frankfurt
site:jobvector.de "GenAI" "Cloud" Frankfurt OR Hessen
site:linkedin.com/jobs "Data Engineering" "MLOps" Frankfurt Germany
site:linkedin.com/jobs "ML Engineer" "SAP HANA" Frankfurt
site:stepstone.de "Infrastructure-as-Code" "AI" Frankfurt
```

### Priority 3: SAP HANA Consultant / Advisory (Adjacent role type)

Adjacent roles you could pivot into - SAP HANA consulting/advisory, leveraging the Accenture and multiple-client track record.

```
site:stepstone.de "SAP HANA" Berater Frankfurt
site:stepstone.de "SAP HANA Consultant" Frankfurt OR Rhein-Main
site:linkedin.com/jobs "SAP HANA" Consultant Frankfurt Germany
site:stepstone.de "SAP HANA" "Digital Transformation" Frankfurt
```

### Priority 4: Broader Technical / Analytics (Wider net)

Wider net for general technical analytics and data-engineering roles.

```
site:stepstone.de "Data Scientist" Python Frankfurt
site:stepstone.de "Data Analyst" "SAP" Frankfurt
site:linkedin.com/jobs "Data Engineer" Python Frankfurt Germany
site:stepstone.de "Technical Lead" Analytics Frankfurt
site:linkedin.com/jobs "Technical Consultant" SAP Frankfurt
```

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance from Frankfurt am Main.
- **Ideal**: Frankfurt am Main and immediate Rhein-Main (Eschborn, Neu-Isenburg, Bad Homburg, Darmstadt, Wiesbaden, Mainz, Offenbach)
- **Acceptable**: Kassel, Mannheim, Heidelberg, Kaiserslautern, Koblenz, Limburg (~1-1.5h commute / hybrid)
- **Borderline**: Stuttgart, Cologne (Koeln), Nuremberg (Nuernberg) (~2h; hybrid or occasional on-site only)
- **Too far**: Anything requiring full relocation outside Rhein-Main without a remote option (discuss case-by-case - deal-breaker if fully on-site)

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table: German (fluent/verhandlungssicher), English (fluent/verhandlungssicher), Chinese (native). When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine. Chinese-native is a bonus, not a search dimension for the German market.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries

### Suggested adjacent role types to consider (proactive)
Based on the skill profile (SAP depth + Python/ML + GenAI/MLOps + sub-project leadership), worth also watching:
- **Technical Consultant / Solution Architect (SAP HANA)** - bridges technical and business, matches the behavioral bridging strength.
- **SAP BW/BI Team Lead** - small-team lead + hands-on, the preferred operating mode.
- **AI GenAI Engineer (enterprise)** - Aumovio direction; growing in German large enterprise.
