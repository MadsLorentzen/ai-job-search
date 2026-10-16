# Search Queries for Job Scraper

<!-- Configured by /setup on 2026-10-14 for Mohit Notani: Dublin, Ireland; English (C1) / Hindi (native). Re-run /setup --section search to change. -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search` (freehire is **disabled** in this fork - see Search Sites); Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary:
- **linkedin.com/jobs** - LinkedIn job listings (filter: Ireland / Dublin); covered by the `linkedin-search` CLI
- **Indeed (ie.indeed.com)** - covered by the `indeed-search` CLI (Apify actor `misceres/indeed-scraper`; needs `APIFY_API_TOKEN`; billed per job, capped per run; personal use only). The `site:ie.indeed.com` queries below are the fallback when it fails or the account is out of credit. See **Indeed handling** below.
- **Gmail job alerts** - LinkedIn and Indeed saved-search alert emails, read through the Gmail connector (`/scrape` Step 1d, `tools/parse_job_alerts.py`). Free, and the best way to widen coverage: add more saved-search alerts on LinkedIn/Indeed for the target titles and `/scrape` picks them up.
- **Other boards via Google for Jobs** - the `jsearch-search` CLI (needs `JSEARCH_API_TOKEN`; 200 requests/month on the free plan). In Ireland it adds Jobrapido, Jooble and similar boards. It carries no Indeed. Always pass `--exclude-publishers LinkedIn`.
- **irishjobs.ie** - largest Irish general job board (WebSearch fallback; no CLI installed - scaffold one with `/add-portal` if useful)
- **jobs.ie** - Irish general job board (WebSearch fallback)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

**Organize by function, not job title.** The same underlying work carries different titles across companies and markets (a "Data Scientist" role at one employer may be posted as "Insights Analyst" or "Data Consultant" at another). Name each priority category after the function it covers, and list several plausible job titles as query variants within that category rather than betting an entire priority tier on one exact title string.

All queries are written in English only. Hindi is declared, but the Irish market posts in English.

### Priority 1: Data Engineering & Analytics Engineering

The user's chosen career direction. Profile is moderate-to-strong here (production ETL validation at Accenture + pipeline projects), so expect to make the case in the cover letter.

```
site:linkedin.com/jobs "Data Engineer" Dublin Ireland
site:linkedin.com/jobs "Associate Data Engineer" Ireland
site:linkedin.com/jobs "Analytics Engineer" Dublin
site:irishjobs.ie "Data Engineer" Dublin
site:irishjobs.ie "Analytics Engineer" OR "dbt" Dublin
site:jobs.ie "Data Engineer" Dublin
site:ie.indeed.com "Data Engineer" Dublin
site:ie.indeed.com "Analytics Engineer" OR "Associate Data Engineer" Dublin
```

### Priority 2: Data Quality & ETL Testing

Strongest direct experience (2.5 years at Accenture). Highest expected interview hit-rate.

```
site:linkedin.com/jobs "Data Quality Engineer" Dublin
site:linkedin.com/jobs "Data Quality Analyst" Ireland
site:linkedin.com/jobs "ETL Tester" OR "Data Test Engineer" Ireland
site:irishjobs.ie "Data Quality" Dublin
site:irishjobs.ie "ETL" tester OR testing Dublin
site:ie.indeed.com "Data Quality" OR "ETL Tester" Dublin
```

### Priority 3: QA & Test Automation

Direct experience with Robot Framework, Selenium, Postman, Jira, CI gating.

```
site:linkedin.com/jobs "Test Automation Engineer" Dublin
site:linkedin.com/jobs "QA Engineer" OR "QA Analyst" Dublin
site:linkedin.com/jobs "Software Test Engineer" OR "Software Tester" Dublin
site:irishjobs.ie "Test Automation" Selenium OR "Robot Framework" Dublin
site:jobs.ie "QA Engineer" Dublin
site:ie.indeed.com "QA Engineer" OR "Test Automation Engineer" Dublin
```

### Priority 4: Data & BI Analysis

Wider net: SQL/Python/Power BI analyst roles.

```
site:linkedin.com/jobs "Data Analyst" Dublin
site:linkedin.com/jobs "Junior Data Analyst" Dublin
site:linkedin.com/jobs "BI Analyst" OR "Business Intelligence Analyst" Dublin
site:irishjobs.ie "Data Analyst" SQL Dublin
site:jobs.ie "Data Analyst" Dublin
site:ie.indeed.com "Data Analyst" OR "BI Analyst" Dublin
```

**Search terms to combine with titles:** SQL, Python, PySpark, dbt, AWS Glue, Robot Framework, data quality.

**Sponsorship check:** Candidate holds Stamp 1G until Dec 2027 and needs an employer open to Critical Skills Employment Permit sponsorship. Exclude postings stating "no sponsorship", "Stamp 4 required" or "EU citizens only".

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance from your home. Define acceptable areas:
- **Ideal:** Dublin city centre, Docklands, Dublin 1-8, Sandyford, Leopardstown, Ballsbridge, Cherrywood, hybrid Dublin roles
- **Acceptable:** Greater Dublin (Swords, Blanchardstown, Dun Laoghaire, Tallaght, Citywest); remote-in-Ireland roles
- **Borderline:** Maynooth, Bray, Naas, Drogheda (~45-60 min by transit), only if hybrid
- **Too far:** Cork, Galway, Limerick, Waterford and anywhere outside Ireland, unless fully remote

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

**Window: 7 days** (changed from the 14-day default on 2026-10-15 at the user's request). `/scrape` Step 1b reads this number: pass `--jobage 7` to `linkedin-search`, and drop any result whose posting date is older than 7 days. If a posting date cannot be determined, include it but flag as "date unknown".

### Indeed handling

**Primary: `indeed-search`, one run per `/scrape`.** Join every target title for this run with `;`:

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "<title>;<title>;..." -l "Dublin" --jobage 7 -n 20 --max-charge 1 --broad
```

- **Broad search (user's choice, 2026-10-15):** `--broad` uses Indeed's ordinary keyword search, which returns loosely matching jobs (for example, data-centre construction roles for "data engineer"). Drop non-matching titles in the Step 3 fit check instead of presenting them.
- **Cost:** about $3 per 1,000 jobs. The default run (top 3 categories, about 9 titles × 20) is at most about $0.55, and `--max-charge` caps it. On `QUOTA_EXCEEDED`, use the fallback below for the rest of the run.
- **Verification:** `applyUrl` is usually the employer's own posting. Fetch it to confirm the role is live and store **that** URL. If there is none, find the role on the employer's careers site independently. Agency ads have no employer site to check, so label them as agency ads. A role you can't confirm is dropped and reported as unverified.
- Results include the full description, so run contact extraction on it directly. There is no `detail` call.
- Store `portal: "indeed-search"` and `source: "cli"`. Never fetch `ie.indeed.com` URLs yourself; only the actor touches Indeed.

### Other boards: `jsearch-search`

One search per target title (one request each), skipping LinkedIn:

```bash
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "<title>" -l "Dublin, Ireland" --country ie --jobage 7 --exclude-publishers LinkedIn
```

Verify through `applyOptions` the same way (an `isDirect` link, or one on the employer's domain). Store `portal: "jsearch-search"`. On `QUOTA_EXCEEDED`, skip it for the rest of the run.

**Fallback (CLI failed or quota spent): WebSearch leads.** Use the `site:ie.indeed.com` queries above.
1. Read title, company and location from the search result. Never fetch `ie.indeed.com` pages: they return a Cloudflare 403 to scripted requests, and the challenge is never worked around.
2. Verify on the employer's own careers site, found independently, the same as above.
3. Store the employer's URL with `portal: "indeed (websearch)"` and `source: "websearch"`.
4. A lead you can't confirm is dropped and noted as unverified. Search-index snippets can be weeks stale.

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
