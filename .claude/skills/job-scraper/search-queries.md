# Search Queries for Job Scraper

## Search Sites

Search across all of these. **Applications are submitted via LinkedIn** — when presenting results, always include the LinkedIn job URL where available (or note if only found on another board).

- **linkedin.com/jobs** — primary; most international Berlin companies post here
- **stepstone.de** — large German job board; good for established companies
- **de.indeed.com** — broad coverage; catches postings not on LinkedIn
- **berlinstartupjobs.com** — Berlin startup and scale-up specific
- **wellfound.com** — startup/tech roles; good for seed–Series C
- **otta.com** — curated tech roles, good Berlin coverage
- **Company career pages** — direct Google `site:` searches for known target companies

> **Note:** This setup is for the **Berlin, Germany** job market. The built-in Danish portal tools (.agents/skills/) are not relevant. Use WebSearch + WebFetch instead.

## Query Categories

Queries are grouped by priority. Location terms: "Berlin" (primary), "Germany" (broader net).

### Priority 1: Data Engineer

Strongest and most frequently targeted direction — 2 hires, multiple interviews in past applications.

```
site:linkedin.com/jobs "Data Engineer" Berlin
site:stepstone.de "Data Engineer" Berlin
site:de.indeed.com "Data Engineer" Berlin
site:berlinstartupjobs.com "Data Engineer"
site:wellfound.com "Data Engineer" Berlin
```

### Priority 2: Software Engineer / Backend Engineer

Python-focused backend roles; matches current Aignostics role.

```
site:linkedin.com/jobs "Software Engineer" Python Berlin
site:linkedin.com/jobs "Backend Engineer" Python Berlin
site:stepstone.de "Software Engineer" Python Berlin
site:berlinstartupjobs.com "Backend Engineer"
site:wellfound.com "Backend Engineer" Python Berlin
```

### Priority 3: ML Engineer / ML Platform Engineer

Adjacent to MSc background (Logic Tensor Networks, computer vision) and MLOps certification.

```
site:linkedin.com/jobs "ML Engineer" Berlin
site:linkedin.com/jobs "Machine Learning Engineer" Berlin
site:linkedin.com/jobs "ML Platform Engineer" Berlin
site:wellfound.com "ML Engineer" Berlin
site:berlinstartupjobs.com "Machine Learning"
```

### Priority 4: Data Platform / Analytics Engineer / Founding Engineer

Wider net — roles that fit well but may not be top-of-mind.

```
site:linkedin.com/jobs "Data Platform Engineer" Berlin
site:linkedin.com/jobs "Analytics Engineer" Berlin
site:linkedin.com/jobs "Founding Engineer" Berlin
site:wellfound.com "Data Platform" Berlin
site:otta.com "Data Engineer" Berlin
site:berlinstartupjobs.com "Founding Engineer"
```

## Suggested Adjacent Role Types to Include

Based on Silvia's skill profile — consider adding these to searches if standard queries return thin results:

- **"Data Platform Engineer"** — Silvia collaborated with Data Platform Engineering teams at Veeva; companies like Delivery Hero, Zalando, HelloFresh have dedicated teams here
- **"ML Platform Engineer"** — bridges MLOps certification, Python, GCP/AWS skills; growing role type at Berlin health-tech and AI companies
- **"Founding Engineer" / "First Data Engineer"** — past co-founder applications signal interest in startup ownership; these roles match her independent working style and broad-scope experience

## Location Filter

When evaluating results, verify the job location:
- **Ideal:** Berlin (any district, reasonable commute by S/U-Bahn)
- **Acceptable:** Berlin outskirts / Brandenburg with good transit connection to Berlin
- **OK with caveats:** Remote Germany if explicitly hybrid with regular Berlin office time
- **Skip:** Fully remote-only (wants in-person/hybrid), non-Berlin Germany without hybrid option

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Salary Filter

Skip roles that explicitly advertise below €70k. Flag any that specify a salary range so Silvia can decide.

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries. Examples:
- `/scrape data engineer` → Priority 1 queries + custom Airflow/PySpark/GCP variant searches
- `/scrape startup` → Priority 4 "Founding Engineer" queries + wellfound/berlinstartupjobs
- `/scrape ml` → Priority 3 queries + "ML Platform", "Applied ML", "AI Engineer" variants
- `/scrape broad` → all four priority categories
