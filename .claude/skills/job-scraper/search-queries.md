# Search Queries for Job Scraper

<!-- Configured for Joshua Cullinan via /setup. -->

> **Note on tooling:** The framework's built-in scraper CLI targets **Danish** job portals (Jobindex, Jobnet, etc.), which do **not** apply here. Joshua is based in South Africa and searches the **remote-global, UK, Ireland, EU, and South African** markets. This config therefore drives searches through **LinkedIn** and **Google `site:` searches** of company career pages and health-AI job boards. To add a dedicated local portal integration later, run `/add-portal`.

## Target markets (Joshua has the right to work in all of these)
- **Remote (global)** - highest priority; widest net for health-AI / ML roles
- **United Kingdom** (British passport) - London and remote-UK
- **Ireland** (EU/Irish citizen) - Dublin and remote-IE
- **EU** (Irish citizenship) - remote-EU and major hubs
- **South Africa** - Johannesburg and Cape Town (current base)

## Search Sites
- **linkedin.com/jobs** - primary. Filter by the markets above and by "Remote".
- **Google `site:` searches** - company career pages and aggregators (examples below).
- Health-AI job boards / aggregators: `builtin.com`, `wellfound.com` (AngelList Talent), `ycombinator.com/jobs`, `otta.com`, company career pages directly.

## Query Categories

Queries are grouped by priority. Combine each with a market term (`remote`, `United Kingdom`, `Ireland`, `EU`, `South Africa`, `Johannesburg`, `Cape Town`) where the site supports it.

### Priority 1: Health-AI / Clinical AI (primary direction)

Strongest and most desired direction: building AI/ML for healthcare.

```
site:linkedin.com/jobs "clinical AI" (remote OR "United Kingdom" OR Ireland)
site:linkedin.com/jobs "clinical data scientist" (remote OR UK OR EU)
site:linkedin.com/jobs "clinical machine learning" engineer remote
site:linkedin.com/jobs ("medical AI" OR "health AI" OR "digital health") "machine learning"
site:linkedin.com/jobs "clinical decision support" (ML OR "machine learning")
site:wellfound.com health AI machine learning
"health AI" "machine learning engineer" careers (remote OR London OR Dublin)
```

### Priority 2: Applied ML / AI Engineering (any domain)

Leans on Python, deep learning, and research-to-production skill.

```
site:linkedin.com/jobs "machine learning engineer" (remote OR "United Kingdom" OR Ireland)
site:linkedin.com/jobs "AI engineer" Python (remote OR EU)
site:linkedin.com/jobs "applied scientist" "deep learning" remote
site:linkedin.com/jobs "data scientist" Python TensorFlow (remote OR UK)
site:linkedin.com/jobs "LLM engineer" OR "GenAI engineer" remote
```

### Priority 3: Biomedical / Bioinformatics ML (domain expertise)

Direct match to his research background.

```
site:linkedin.com/jobs bioinformatics "machine learning" (remote OR UK OR EU)
site:linkedin.com/jobs "computational biology" "deep learning" remote
site:linkedin.com/jobs (genomics OR "medical imaging") "machine learning" engineer
site:linkedin.com/jobs "ML scientist" (healthcare OR biotech OR pharma) remote
```

### Priority 4: Broader technical / clinical-informatics (wider net)

```
site:linkedin.com/jobs "clinical informatics" (data OR AI OR analytics)
site:linkedin.com/jobs "physician" ("machine learning" OR AI OR "data science") remote
site:linkedin.com/jobs "medical advisor" health-tech (AI OR data)
site:linkedin.com/jobs Python developer (health OR medical OR bio) remote
```

## Role titles to search
Clinical AI Engineer, Clinical/Medical Machine Learning Engineer, Clinical Data Scientist, Machine Learning Engineer, AI Engineer, Applied Scientist, Data Scientist (health/biotech), Bioinformatics/Computational Biology ML Scientist, LLM/GenAI Engineer, Clinical Informatics Specialist, Physician Data Scientist / Clinical AI Advisor.

## Key skill search terms
Python, TensorFlow, scikit-learn, deep learning, machine learning, neural networks, ONNX, bioinformatics, genomics, medical imaging, LLM, Claude API, healthcare, clinical.

## Location filter (evaluation tiers)
- **Ideal:** Remote (global) roles open to South-Africa-based or EU/UK-based candidates.
- **Acceptable:** UK (London or remote-UK), Ireland (Dublin or remote-IE), remote-EU - Joshua has the right to work and is open to relocating.
- **Acceptable (local):** Johannesburg / Gauteng (on-site or hybrid); Cape Town (relocation within SA).
- **Borderline:** On-site EU roles requiring immediate relocation before the community-service year ends (end of 2026) - flag timing.
- **Too far / fail:** Roles requiring work authorization Joshua does not hold (e.g. US on-site with no sponsorship), or requiring relocation before he can leave his current post.

## Date Filter
Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Timing note
Joshua is completing a community-service year to the end of 2026 and is targeting a transition after it (into 2027), but is open to an exceptional opportunity sooner. Flag start-date expectations on strong matches.

## Adapting Queries
If the user specifies a focus area (e.g. `/scrape medical imaging`), select queries from the matching category and generate 2-3 custom queries for that focus.
