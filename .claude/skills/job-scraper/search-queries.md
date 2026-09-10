---
framework_version: 1.1.0
---

# Remote AI / Data search queries

Read ../job-application-assistant/10-remote-brazil.md for eligibility and salary policy.
Default: top three priorities; /scrape automotive adds priority four without making
industry a hard exclusion. Prefer postings from the last 14 days; unknown dates are flagged.

## Priority 1: AI Engineering

AI Engineer; Machine Learning Engineer; Applied AI Engineer; LLM Engineer.
Search each title with Brazil, LATAM, Latin America and worldwide remote separately.

## Priority 2: Data Science

Data Scientist; Applied Scientist; Machine Learning Scientist.
Use Python, predictive modeling, time series and experimentation as query variants.

## Priority 3: Data Engineering

Data Engineer; Analytics Engineer; ML Platform Engineer.
Use Python, SQL, pipelines, Airflow and cloud data as query variants.

## Priority 4: Automotive and industrial data

Combine data scientist / machine learning / data engineer with automotive,
telematics, fleet, mobility, battery, EV, predictive maintenance or industrial.
Keep the same Brazil-remote and USD gates. Do not silently broaden to relocation.

## Enabled CLI source

Use freehire-search with separate LATAM/global and Brazil passes. Example:
`bun run .agents/skills/freehire-search/cli/src/cli.ts search --query "data engineer" --region latam,global --remote remote --jobage 14 --limit 20 --format json`
Use a separate `--country BR` pass; never assume a source's location facet proves eligibility.
Danish demo CLIs and linkedin-search stay disabled unless explicitly reconfigured.

## Read-only Python sources

Run `python tools/remote_sources.py wwr --query "data" --limit 20` and separate
"AI" / "machine learning" queries. For company watchlists, use:
`python tools/remote_sources.py greenhouse --board COMPANY_SLUG --query "data"`
`python tools/remote_sources.py lever --board COMPANY_SLUG --query "engineer"`
Read board slugs from config/company-boards.json. Empty lists mean no companies
configured: say so; do not guess slugs. Merge the JSON results into the usual pool.
Keep WWR attribution links and source IDs. Parse exact role terms from full postings.

## Web search sources

Use these queries as templates, replacing ROLE with each target title:
- site:wellfound.com/jobs "ROLE" "remote" "Brazil"
- site:wellfound.com/jobs "ROLE" "Latin America"
- site:weworkremotely.com "ROLE" "Anywhere in the World"
- site:jobs.lever.co "ROLE" "Brazil"
- site:job-boards.greenhouse.io "ROLE" "Latin America"
- site:jobs.ashbyhq.com "ROLE" "LATAM"
- "ROLE" "remote" "Brazil" "USD"

Wellfound is search/manual handoff only; no login scraping. Always check employer
posting for restrictions. Supplement with public LinkedIn search results only;
do not invoke disabled linkedin-search via a fallback. No site is presumed accessible.

## Result columns

Company, role, source URL, role track, posted date, Brazil gate, USD-payment gate,
monthly base/range, salary evidence (listed/estimated/unknown), timezone overlap,
fit strengths, gaps, next action. Shortlist confirmed matches separately from FLAGs.
If none pass, report none; do not populate the confirmed list with US-only roles.
