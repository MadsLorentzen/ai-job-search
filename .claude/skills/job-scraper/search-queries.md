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

### ⚠️ Route by stack — the two halves of this profile need different portals

Measured 2026-08-05. The same query returns wildly different results by portal:

| Query | Greenhouse (91 boards) | The Muse | LinkedIn |
|-------|------------------------|----------|----------|
| `.net` / `c#` | **0** | **0** | 10+ (page-capped) |
| `backend` | 43 | 9 | — |
| `golang` | 1 | — | 10+ (page-capped) |

**Greenhouse and Lever sell to modern startups, which are Go/Python/TypeScript
shops.** The .NET-heavy employers are enterprise: of 53 probed (TransUnion,
Equifax, Workiva, Principal, Procore, athenahealth, Oscar Health, Rocket
Mortgage...), **41 were not on Greenhouse** — they use Workday, iCIMS, Taleo or
SmartRecruiters, none of which have a usable public API.

**Therefore, every run must cover BOTH channels:**

- **Go / backend / payments / staff-level** → `greenhouse-search --registry --us-remote`
  and `lever-search --registry`. Highest signal, hits employers directly.
- **.NET / C# / enterprise** → `linkedin-search` with explicit `.NET`/`C#` queries,
  plus the `site:` WebSearch fallbacks below. **The ATS registry will return zero
  for these — that is expected, not a broken portal.** Do not conclude ".NET roles
  don't exist" from an empty ATS sweep.

Skipping the second channel hides roughly half of this candidate's marketable
experience (20+ years .NET vs 1 year Go).

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

### Priority 1a: Senior / Staff Backend — Go & general (ATS registry channel)

Most *recent* evidence. Run against the ATS registry, which is where these live.

Portals: `greenhouse-search --registry --us-remote`, `lever-search --registry`, `themuse-search`
CLI terms: `senior software engineer`, `staff engineer`, `backend`, `platform engineer`,
`distributed systems`, `microservices`
(Not `golang` — see the role-nouns rule above; it returns 1 match vs 110.)

### Priority 1b: Senior .NET / C# (LinkedIn + WebSearch channel)

**Deepest** evidence — 20+ years vs 1 year of Go. Invisible to the ATS registry;
must be searched separately or it is silently dropped from every run.

Portals: `linkedin-search` (primary), WebSearch `site:` fallbacks
CLI terms: `.NET developer`, `senior .NET engineer`, `C# engineer`, `.NET/C#`,
`dotnet developer`, `ASP.NET`, `.NET Core`, `Azure .NET`

```
site:indeed.com "senior .NET developer" remote
site:dice.com ".NET Core" remote
site:builtin.com "c#" engineer remote
```

**Market note (observed 2026-08-05):** the remote .NET market skews heavily to
staffing agencies — of 20 results, 10 were agencies (Kforce, Talener, Optomi,
Vernovis, Kavaliro, Fixity, Precision, Rapid Eagle, EmergenceTek, Lucid). Direct
employers found: TransUnion, Bitdefender, Hone Health, Airrosti, Q-Lab, VetsEZ.
Flag agency listings so the user can judge contract-vs-permanent themselves;
do not filter them out silently.

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

### Priority 3: Engineering Manager / Tech Lead

Third confirmed track, and the one most easily forgotten because every other
query is IC-flavoured. **Run it every time.**

Portals: `greenhouse-search --registry --us-remote` (66 EM matches at last run),
`linkedin-search`

CLI terms: `engineering manager`, `software engineering manager`, `manager, software`,
`manager, engineering`, `team lead`, `lead engineer`, `engineering lead`
(`tech lead manager` returns 0 — the title exists at Google, almost nowhere else.)

**"Entry-level engineering manager" is not a posted title.** A first-time manager
role is posted as plain "Engineering Manager" / "Manager, Software Engineering";
seniority is implied by team size and scope. Filter by what the title does NOT say:

- **Right rung:** "Engineering Manager", "Manager, Software Engineering", "Team Lead"
- **Wrong rung (wants existing manager tenure):** anything with Senior / Sr. /
  Group / Director / Head of / Principal / VP / second-line

At the last run that split 66 matches into ~42 first-time-rung and ~24 requiring
prior EM experience.

**Two filters this search needs that the others do not:**
1. **"Engineering Manager" is not a software title outside tech.** Manufacturing
   and hardware firms (PRISM Plastics, Novelis, Hiab, Zurn Elkay, Mitsubishi
   Electric, Teledyne) post mechanical-engineering managers under the identical
   title. 11 of 53 results were these. Exclude by employer industry, not title.
2. **Exclude sales/solutions/customer engineering managers** — "Regional Manager,
   Sales Engineering" is a quota-carrying role, not an engineering one.

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
