---
name: job-scraper
description: >
  Scrapes job sources for new positions matching your profile. Combines direct ATS API queries
  (Greenhouse, Lever, Ashby via the `ats-search` skill) for monitored AI labs with broader
  WebSearch sweeps for LinkedIn, Wellfound, and unknown companies. Deduplicates across runs.
  Triggers on: job scrape, find jobs, search jobs, new jobs, job search, scrape jobs, /scrape
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch, Agent, AskUserQuestion
---

# Job Scraper

---

## How It Works

This skill runs five parallel scans:

1. **Direct ATS sweep** (high signal, low noise) — uses the `ats-search` CLI to query the public JSON APIs of every configured target company (47 monitored, including OpenAI, Anthropic, Cohere, Perplexity, Mistral, xAI, Stripe, Klaviyo, etc.). Edit `.agents/skills/ats-search/cli/companies.json` to manage the monitored list. Runs as a dual sweep: title-OR plus body-search.
2. **HN Who's Hiring** — uses `hn-search` to pull and filter the latest monthly "Ask HN: Who is hiring?" thread.
3. **YC discovery** (on `broad` or `yc` focus) — uses `yc-search` to list recently-funded YC companies, then probes each one's ATS.
4. **LinkedIn via WebSearch** — uses `WebSearch` with `site:linkedin.com/jobs/view` queries plus `WebFetch` for promising hits.
5. **Wellfound** — skipped (DataDome anti-bot blocks public scraping).

All feed into the same deduplication and presentation pipeline. New matches are presented with a quick fit assessment.

## Invocation

The user triggers this skill by saying things like:
- "Find new jobs"
- "Scrape for jobs"
- "Any new positions?"
- "/scrape"

Optional arguments:
- A focus area, e.g. "/scrape growth" or "/scrape lifecycle" or "/scrape openai"
- "broad" to also run the broad discovery sweep across all queries, e.g. "/scrape broad"

If no focus is given, default to the Priority 1-3 queries from `search-queries.md` plus a full `search-all` against the monitored ATS list.

---

## Execution Steps

### Step 0: Load State

1. Read `job_scraper/seen_jobs.json` (create if missing - start with `{"seen": {}}`)
2. Read `job_search_tracker.csv` to extract already-applied companies+roles (if it exists)
3. Read `search-queries.md` (this directory) for the search strategy
4. Read `.claude/skills/job-application-assistant/04-job-evaluation.md` for the match-area context

### Step 1: ATS Sweep (Always Run)

Run two parallel sweeps against the monitored ATS list and dedupe by URL. The dual sweep catches roles that a single-pass title filter would miss.

**Sweep 1A — title-OR.** Catches anything with growth-flavored terms in the title:

```bash
bun run skills/ats-search/cli/src/cli.ts search-all \
  --queries "growth,lifecycle,plg,product-led,product led,self-serve,self serve,freemium,monetization,activation,retention marketing,demand gen,demand engine,performance marketing,growth marketing,product marketing,crm,gtm,head of growth,vp of growth,founding,head of product,vp of product,founder in residence,entrepreneur in residence" \
  --since <YYYY-MM-DD> --format json
```

**Sweep 1B — body search.** Catches roles whose title doesn't say "growth" but whose body describes the work.

**Matching is plain case-insensitive substring** (`cli.ts:120`) — no stemming, no punctuation normalization. Two consequences, both measured on the 2026-08-03 run:

1. **Hyphenated and unhyphenated spellings are different queries.** `product-led growth` does not match "product led growth". Always ship both variants of every compound term or the role silently never matches.
2. **Keep body terms to multi-word phrases only.** Short/weak tokens (`product led`, `self-serve`, `freemium`, `retention` on their own) match boilerplate in job-post footers and blow up the result set — adding them took one run from 13 extra hits to 130, nearly all junk. Roles with descriptive titles (`Head of Demand Engine`, `Performance Marketing Lead`) belong in the **title** sweep, where matching is precise. Body search is for roles whose *title hides the work*.

```bash
bun run skills/ats-search/cli/src/cli.ts search-all \
  --query-body "product-led growth,product led growth,plg motion,plg funnel,self-serve funnel,self-serve growth,self serve growth,self-service funnel,freemium funnel,freemium conversion,bottom-up adoption,bottoms-up adoption,lifecycle marketing,growth experimentation,experimentation velocity,activation funnel,onboarding funnel,pricing and packaging,growth loop,answer engine optimization,generative engine optimization" \
  --since <YYYY-MM-DD> --format json
```

**Sweep 1C — broad PM/PMM/leadership at AI companies (ALWAYS RUN).** This is how "PM roles focused on AI" get caught: run broad PM titles across every AI-tagged company so AI-product PM roles (which don't say "growth") land in the pipeline (e.g. Decagon "Agent Product Manager", OpenAI "PM, API Agents", Sierra agent PMs, Perplexity "PM, Builder"). Bounded by `--tag` (incl. `ai` — most AI companies carry it) so noise stays low. Referral-covered AI companies (OpenAI, Anthropic, Cohere, Sierra, Perplexity, Cursor, Notion…) route to the referral track, not cold apply.

```bash
bun run skills/ats-search/cli/src/cli.ts search-all \
  --tag "ai,ai-work,frontier-ai,agentic-platform" \
  --queries "product manager,senior product manager,staff product manager,principal product manager,group product manager,product lead,head of product,vp of product,director of product,founding product,product marketing manager,head of marketing,director of marketing" \
  --since <YYYY-MM-DD> --format json
```

Combine both result sets, deduplicate by `url`, and pass the union into Step 4 (fit assessment).

**Adjust based on focus argument:**
- `/scrape growth` → keep both sweeps as-is.
- `/scrape lifecycle` → swap queries to `"lifecycle,email,messaging,crm"` and query-body to `"lifecycle marketing,email marketing,customer engagement,cdp"`.
- `/scrape openai` (or any company name that matches `companies.json`) → use `search --company <Name>` instead of `search-all`, on both sweeps.
- `/scrape <free-text>` → use the free-text as both `--query` and `--query-body`.

Both sweeps are fast (parallel calls to public APIs) and high signal. Always run both.

### Step 2: Auxiliary Sources (Always Run)

In addition to the ATS sweep, hit four auxiliary sources in parallel. Each catches roles the ATS sweep misses.

**Sweep 2A — HN Who's Hiring (monthly thread).** High-density startup roles, often founding-level. Pull the latest monthly thread, filter for the candidate's keywords:

```bash
bun run skills/hn-search/cli/src/cli.ts postings \
  --queries "growth,lifecycle,plg,monetization,activation,gtm,founding growth,head of growth,head of product,vp of growth,vp of product" \
  --format json
```

For broader recall, swap to `postings-multi --months 3`. Use `--remote` to filter for remote-friendly only.

**Sweep 2B — YC company discovery + ATS probe.** Find newly-funded YC companies in the candidate's target sectors and probe each one's ATS:

```bash
bun run skills/yc-search/cli/src/cli.ts slugs --queries "ai,agent,llm,plg,growth" --limit 80 \
  | while read slug; do
      for ats_url in \
        "https://boards-api.greenhouse.io/v1/boards/$slug/jobs?content=false" \
        "https://api.lever.co/v0/postings/$slug?mode=json" \
        "https://api.ashbyhq.com/posting-api/job-board/$slug"; do
        code=$(curl -sf --max-time 4 -o /dev/null -w "%{http_code}" "$ats_url" 2>/dev/null)
        if [ "$code" = "200" ]; then echo "$slug | $ats_url"; fi
      done
    done
```

For each newly-discovered (slug, ATS) pair, run `ats-search search --site <ats> --slug <slug> --name "<Display>" --queries growth,lifecycle,plg,gtm` to fetch open roles.

**Sweep 2C — LinkedIn via WebSearch.** No direct LinkedIn API. Use `WebSearch` with `site:linkedin.com/jobs/view` queries built from the candidate profile:

```
WebSearch: site:linkedin.com/jobs/view (Head of Growth OR VP Growth OR Founding Growth) (AI OR LLM) (remote OR "New York")
WebSearch: site:linkedin.com/jobs/view "lifecycle marketing" OR "lifecycle PM" (remote OR "New York")
WebSearch: site:linkedin.com/jobs/view "product manager growth" (frontier AI OR OpenAI OR Anthropic)
```

For each promising result, `WebFetch` the LinkedIn page to extract title, company, location, and snippet.

**Sweep 2D — Wellfound (skipped).** DataDome anti-bot blocks public scraping. Re-evaluate in Phase 3 if a different access path opens up.

Run if the user said `/scrape broad`, or by default include 2A and 2C always. Skip 2B unless the user said `broad` or a YC-flavored focus (`/scrape yc`).

### Step 3: Fetch & Parse

For each promising result from Step 2 (Step 1 results already include structured data):

- If the URL is a Greenhouse, Lever, or Ashby URL, **prefer** the `ats-search detail` command for clean JSON over `WebFetch`:
  ```bash
  bun run skills/ats-search/cli/src/cli.ts detail --site <ats> --slug <slug> --id <id>
  ```
- Otherwise, use `WebFetch` to retrieve the job posting page
- Extract: **job title**, **company**, **location**, **posting date** (or "recent"), **URL**, **key requirements** (brief), **application deadline** (if listed)
- Skip if the URL or company+title combo already exists in `seen_jobs.json`
- Skip if the company+role already appears in `job_search_tracker.csv`

### Step 4: Quick Fit Assessment

For each new job, do a rapid fit check (NOT the full evaluation from `04-job-evaluation.md` - just a quick signal):

Score on two axes — **role fit** and **company weight** — then combine.

**Role fit (the base score):**

- **High match**: Role directly involves the candidate's core skills (PLG, growth engineering, lifecycle/email, experimentation), is at a target sector (frontier AI lab, growth-stage AI), and is in the acceptable location set (remote, NYC, hybrid NYC, or otherwise compelling enough to consider relocation)
- **Medium match**: Role is adjacent to the candidate's experience (e.g. Sr PM at an AI company without "growth" in the title; lifecycle role at a non-AI consumer co)
- **Low match**: Role requires significant skills the candidate lacks (e.g. pure data science ownership, pure enterprise sales)

**Company weight (the modifier).** Two classes of company get promoted, because both the mission fit and the brand equity on the CV justify more friction than a generic posting:

| Tier | Tag in `companies.json` | Effect |
|---|---|---|
| **Marquee** | `marquee` — Google, Anthropic, OpenAI, Apple, Netflix, NVIDIA, Stripe, Figma, Spotify, Amazon, Salesforce, Adobe, Reddit, Pinterest, Duolingo, Robinhood | **Promote one level.** Also relax the geographic filter: an on-site-only role outside NYC is *borderline*, not *skip* — surface it and flag the location rather than dropping it. |
| **AI-native** | `frontier-ai`, `agentic-platform`, `ai`, `ai-work` | **Promote one level** when the role is growth/PLG/lifecycle/product. AI-as-core-capability is an explicit "what excites you" item in `CLAUDE.md`. |

Rules:
- A company in **both** classes (Anthropic, OpenAI, Google DeepMind, NVIDIA) promotes **medium → very high**, not just high. These are the top of the funnel.
- Promotion **never rescues a genuine skills mismatch**. A marquee tag does not lift enterprise-sales quota roles, GTM *finance* roles, recruiting/HR, or pure DS/DE roles above low. Weighting boosts adjacency, not wrong function.
- Beware the `gtm` token: at large companies it matches GTM Finance, GTM Enablement, GTM Recruiting, and Compensation-Business-Partner-GTM roles. These are low regardless of brand.
- When a marquee or AI-native role is surfaced, check `job_scraper/referral_paths_2hop.json` and note whether a referral path exists — these companies should route to the referral track before a cold apply.

**Marquee companies not on an ATS the CLI can read** (Google, Apple, Netflix, and the rest of `_phase3_queue` in `companies.json`) will never appear in the Step 1 sweep. Cover them explicitly in Step 2C with targeted WebSearch each run:

```
WebSearch: site:google.com/about/careers "growth" OR "product-led" New York
WebSearch: Google careers "Product Manager, Growth" New York 2026
WebSearch: Netflix jobs "growth" OR "lifecycle" product manager remote
```

### Step 5: Deduplicate & Store

1. Add ALL fetched jobs (new and skipped) to `seen_jobs.json` with structure:
```json
{
  "seen": {
    "<url_or_company_title_key>": {
      "title": "...",
      "company": "...",
      "url": "...",
      "location": "...",
      "first_seen": "YYYY-MM-DD",
      "fit": "very high/high/medium/low",
      "fit_basis": "why this score (weighting tier applied, demotions)",
      "status": "new/skipped/evaluated",
      "source": "ats|websearch"
    }
  }
}
```
2. Only present jobs NOT already in the seen list or tracker.

**Always store `location`.** It was missing from the schema until 2026-08-03, which made the geo filter unenforceable on re-scoring passes — international postings (Luxembourg, Tel Aviv, Singapore) survived as high-fit purely on brand. Without `location` on the row, a later weighting pass cannot tell a Remote-US role from a Ljubljana one.

**Apply the geo filter *after* the weighting promotion, never before.** Marquee status relaxes the geo tier only inside the US/Canada — it does not make a London or Singapore posting relevant. Demote any promoted row whose location is non-US and lacks a US/remote-US option. Likewise demote junior titles (`Specialist`, `Associate`, `Coordinator`, `Intern`) that a brand promotion lifted above their level.

### Step 6: Present Results

Present new jobs in a table sorted by fit (high first):

```
## New Job Matches - YYYY-MM-DD

Found X new positions (Y high, Z medium, W low match).

| # | Fit | Title | Company | Location | Date | Source | URL |
|---|-----|-------|---------|----------|------|--------|-----|
| 1 | High | ... | ... | ... | ... | ats | [Link](...) |

### High-Match Highlights
For each high-match job, add 2-3 bullet points:
- Why it matches the candidate's profile
- Key requirements to check
- Any red flags
```

After presenting, ask:
> "Want me to evaluate any of these in detail? Just give me the number(s)."

If the user picks a number, invoke the **job-application-assistant** skill workflow (fit evaluation first, then CV + cover letter if approved).

### Step 7: Update Tracker (Optional)

If the user decides to apply to any job, add a row to `job_search_tracker.csv`.

---

## Geographic Filter

Apply these tiers from the candidate's profile:
- **Ideal:** Remote (US)
- **Acceptable:** Hybrid or on-site in NYC (commute from Brooklyn)
- **Borderline:** Other US metros with a strong remote-friendly culture or compelling relocation package
- **Skip:** On-site only outside NYC unless the role is otherwise stellar in mission, role, or comp

---

## Important Rules

1. **Never fabricate job postings.** Only present jobs found via actual ATS calls or WebSearch/WebFetch results.
2. **Respect deduplication.** Always check `seen_jobs.json` AND `job_search_tracker.csv` before presenting.
3. **Focus on the configured location tiers.** Skip on-site-only roles outside NYC unless the role is otherwise stellar.
4. **Only open positions.** Skip postings with expired deadlines or those marked as closed.
5. **Be efficient with WebFetch.** The ATS sweep covers the highest-signal sources reliably. Use WebFetch only for non-ATS URLs.
6. **Prefer `ats-search detail` over WebFetch for ATS URLs.** It's faster, cleaner, and doesn't require HTML parsing.
7. **Parallel scans.** Step 1 (`search-all`) is already parallel. Step 2 (broad discovery) should use parallel WebSearch calls or the Agent tool.
