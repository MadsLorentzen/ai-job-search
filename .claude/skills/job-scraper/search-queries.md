# Search Queries for Job Scraper

Market: **Canada**. Home base Richmond, BC; willing to relocate anywhere in Canada.

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first.

| Skill | Enabled | Note |
|---|---|---|
| `linkedin-search` | **yes** | Primary CLI for this market |
| `freehire-search` | **yes** | Country-agnostic |
| `jobbank-search`, `jobindex-search`, `jobdanmark-search`, `jobnet-search` | no | Danish demo portals. `jobbank-search` is the **Danish** Jobbank, **not** Canada's Job Bank — leave disabled. |

**No Canadian portal CLI ships with the framework.** The highest-value addition would be `/add-portal` for **Indeed.ca** and **Job Bank Canada** (jobbank.gc.ca), which between them carry most Canadian postings. Until then, those boards are covered only by the WebSearch `site:` fallback below, which is weaker.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** her Languages table lists Mandarin, English, Cantonese and French. In practice, Canadian postings for these role types are written in **English**, and in **French** in Quebec. So queries are written in English, with a French set for Quebec. Mandarin and Cantonese are more useful here as *keywords inside English queries* ("bilingual Mandarin", "Mandarin speaking") than as query languages — they are a real differentiator in Metro Vancouver and the GTA. Apply `04-job-evaluation.md`'s Language Gate to results: a posting requiring professional French is **FLAGGED** (her French is conversational and untested), never silently passed.

## Search Sites

Primary:
- **indeed.ca** — largest Canadian general board (no CLI yet; use `site:` fallback or `/add-portal`)
- **jobbank.gc.ca** — Government of Canada Job Bank (no CLI yet)
- **linkedin.com/jobs** — also covered by the `linkedin-search` CLI
- **glassdoor.ca** — postings plus company reviews, useful for the company-size check the Deal-breaker Gate needs

Secondary / regional:
- **bcjobs.ca** — BC-specific
- **t-net.ca** — BC technology sector
- **eluta.ca** — indexes employer career pages directly, good for roles that never reach the aggregators
- Direct `site:` searches against target company career pages

## Query Categories

Combine each query with location terms: `Vancouver`, `Richmond`, `Burnaby`, `Toronto`, `Calgary`, `Montreal`, or `Canada` / `remote Canada` for the wider net.

### Priority 1: AI enablement / AI implementation

Her stated destination, and her sharpest differentiator. Titles are wildly inconsistent across employers, so search the **work**, not one label.

```
site:linkedin.com/jobs "AI enablement" Canada
site:linkedin.com/jobs "AI adoption" OR "AI transformation" Vancouver OR Toronto
site:linkedin.com/jobs "AI operations" OR "AI program manager" Canada
site:indeed.ca "AI enablement specialist" OR "AI enablement manager"
site:indeed.ca "business systems analyst" AI Vancouver
site:indeed.ca "automation specialist" OR "workflow automation" business Vancouver OR Toronto
site:linkedin.com/jobs "AI implementation" OR "AI integration" business process Canada
site:linkedin.com/jobs "digital transformation" coordinator OR analyst Vancouver
site:jobbank.gc.ca "artificial intelligence" business process
```

Also worth watching: "AI Solutions Consultant", "Applied AI Specialist", "Productivity Engineer", "Internal Tools", "Knowledge Manager", "Enablement Manager".

### Priority 2: Project & program coordination — any sector, mid-to-large organizations

Direct continuation of her current work. **The Deal-breaker Gate excludes small construction firms** — screen company size before drafting. Large contractors, developers, owner-side teams and non-construction sectors all pass.

```
site:linkedin.com/jobs "project coordinator" Vancouver OR Richmond OR Burnaby
site:linkedin.com/jobs "associate project manager" OR "assistant project manager" Canada
site:indeed.ca "project coordinator" -construction Vancouver
site:indeed.ca "program coordinator" OR "project administrator" Toronto OR Calgary
site:linkedin.com/jobs "project coordinator" technology OR healthcare OR "professional services" Canada
site:indeed.ca "PMO analyst" OR "PMO coordinator" Canada
site:jobbank.gc.ca project coordinator British Columbia
```

### Priority 3: Operations / supply chain

Matches the BCom specialization and the Haier internship; the procurement and RFQ work reinforces it.

```
site:linkedin.com/jobs "operations coordinator" OR "operations analyst" Vancouver OR Richmond
site:linkedin.com/jobs "supply chain analyst" OR "supply chain coordinator" Canada
site:indeed.ca "procurement coordinator" OR "purchasing coordinator" Vancouver OR Toronto
site:indeed.ca "logistics coordinator" Richmond OR Delta OR Surrey
site:linkedin.com/jobs "inventory analyst" OR "demand planner" Canada
site:indeed.ca "vendor management" OR "supplier coordinator" Vancouver
site:jobbank.gc.ca supply chain coordinator British Columbia
```

### Priority 4: Business / data analyst — wider net

Weakest evidence of the four. Include it, but expect a lower hit rate, and do not tighten her SQL or Tableau claims to match a posting.

```
site:linkedin.com/jobs "business analyst" entry OR junior OR associate Vancouver
site:indeed.ca "operations analyst" OR "reporting analyst" Vancouver OR Toronto
site:indeed.ca "data analyst" Excel SQL junior Vancouver
site:linkedin.com/jobs "business operations" analyst Canada
```

### Cross-cutting: bilingual advantage

Run alongside any priority tier — these are a genuine edge in Metro Vancouver and the GTA, not filler.

```
site:linkedin.com/jobs Mandarin bilingual coordinator OR analyst Vancouver OR Richmond OR Toronto
site:indeed.ca "Mandarin speaking" operations OR project OR business Vancouver
site:linkedin.com/jobs "Cantonese" OR "Mandarin" business development Vancouver
```

### French-language set (Quebec)

Every result here must go through the Language Gate — her French is **conversational and untested**, so a posting requiring professional or bilingual French is FLAGGED for her own judgment, not auto-passed.

```
site:linkedin.com/jobs "coordonnateur de projet" Montréal
site:linkedin.com/jobs "analyste des opérations" Montréal
site:indeed.ca "chaîne d'approvisionnement" coordonnateur Montréal
```

## Location Filter

- **Ideal:** Richmond, Vancouver, Burnaby, Surrey, Delta, New Westminster, Coquitlam — Metro Vancouver, home base, no relocation
- **Priority relocation metros:** Greater Toronto Area, Calgary, Montreal
- **Acceptable:** anywhere else in Canada — she will relocate. Note whether the posting offers relocation support.
- **Remote / hybrid anywhere in Canada:** acceptable
- **Fail:** any role based outside Canada — her work permit is Canadian

## Language Filter

Apply `04-job-evaluation.md`'s Language Gate. For this profile specifically:
- A posting requiring **professional or bilingual French** → **FLAG** (declared conversational, untested)
- A posting requiring Mandarin or Cantonese → **PASS**, and treat it as a positive differentiator
- A posting requiring any language not in her table (Spanish, Punjabi, Korean, Japanese, Tagalog and so on) → **FAIL**

## Eligibility Filter

Run the Eligibility Gate before scoring. She holds a Canadian work permit to 2029-07-08 but is **not** a citizen or PR — so any posting requiring **Canadian citizenship, permanent residency, or a security clearance** is a hard FAIL. This is common in federal government, defence, and some financial and critical-infrastructure roles, and it is worth checking early rather than after drafting.

## Deal-breaker Filter

**Small construction companies are a hard exclusion.** When a posting comes from a contractor, subcontractor, design-build or renovation firm, check headcount (LinkedIn or Glassdoor) before drafting. Under roughly 50 staff → drop it and say why.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus.
