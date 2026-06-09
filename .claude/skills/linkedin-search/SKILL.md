# LinkedIn Search

**name:** linkedin-search
**description:** Searches and reads LinkedIn job postings (any country). Reads a specific LinkedIn job URL, or searches LinkedIn jobs by keyword + location. Deduplicates across runs. Triggers on: linkedin job, read this linkedin post, linkedin search, search linkedin, find linkedin jobs, "read this <linkedin.com/jobs/view/...> URL".
**allowed-tools:** Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent, AskUserQuestion

---

## How It Works

LinkedIn has no public job API, but individual job postings are public at
`linkedin.com/jobs/view/<id>` and are readable with **WebFetch**. Listings are
discovered with **WebSearch** scoped to `linkedin.com/jobs/view` rather than
scraped from LinkedIn's JS-heavy search pages.

This skill therefore uses two primitives only — the same ones `job-scraper`
relies on, so there is no fragile external dependency:

- **WebSearch** to *discover* job-posting URLs
- **WebFetch** to *read* each posting in full

> **Note:** `mcp__exa__linkedin_search_exa` is **not** used here — it is
> deprecated and searches *people/profiles*, not job postings. If an Exa web
> search MCP tool is connected it can substitute for WebSearch in Mode B
> discovery, but WebSearch is the default and requires no MCP server.

This skill is **country-agnostic** by design (unlike the Danish portal CLIs in
`.agents/skills/`). Pass a location and it scopes the search accordingly —
LinkedIn serves country jobs from the `<cc>.linkedin.com` subdomain (e.g.
`au.linkedin.com`, `dk.linkedin.com`).

## Invocation

Two modes, auto-detected from the user's input:

### Mode A — Read a specific posting (URL given)
Triggered when the input contains a `linkedin.com/jobs/view/...` URL.
> "read this linkedin post — https://www.linkedin.com/jobs/view/4393056776"

### Mode B — Search postings (keywords given)
Triggered when the input is a query, not a URL.
> "find AI engineer jobs on linkedin in Sydney"
> "/linkedin staff data scientist remote"

Optional arguments for Mode B:
- A location, e.g. "in Sydney" / "remote" / "Copenhagen" (defaults to the
  candidate's configured location in `CLAUDE.md`)
- A recency hint, e.g. "this week" / "last month"

---

## Execution Steps

### Step 0: Load State (both modes)

1. Read `job_scraper/seen_jobs.json` (create `{"seen": {}}` if missing).
2. Read `job_search_tracker.csv` to know which company+role pairs are already
   tracked.

---

### Mode A — Read a specific posting

1. **WebFetch** the URL with a prompt that extracts: job title, company,
   location, posting date, employment type, seniority level, full description,
   requirements/qualifications, salary (if listed), and application deadline.
   - If the URL is `www.linkedin.com/...` and returns thin content, retry with
     the country subdomain form `au.linkedin.com/...` (or the relevant `<cc>`).
2. Present the posting in a clean summary (title, company, location, type,
   posted, salary, deadline, then responsibilities / requirements / benefits).
3. Record it in `seen_jobs.json` (see Step 4).
4. Offer next step: a full fit evaluation via **`/apply <url>`** — but only if a
   real profile exists (`CLAUDE.md` has no `[YOUR_...]` placeholders). If the
   profile is still a template, say so plainly and do **not** fabricate a fit
   score.

---

### Mode B — Search postings

#### Step 1: Build the search

Compose one or more WebSearch queries of the form:

```
site:linkedin.com/jobs/view <role / skill keywords> <location>
```

Call **WebSearch** with `allowed_domains: ["linkedin.com"]` to keep results on
LinkedIn. Run 2–4 query variants in parallel (role synonyms, with/without
location) for broader coverage. For a specific country, include the country
name in the query; results commonly come back on the `<cc>.linkedin.com`
subdomain.

#### Step 2: Pre-filter, then fetch

- From the search result titles/URLs, drop anything already in
  `seen_jobs.json` or already tracked in `job_search_tracker.csv`.
- **WebFetch** each remaining `jobs/view` URL to extract the fields listed in
  Mode A step 1. Don't fetch every result — prioritise the most relevant
  titles to stay token-efficient.

#### Step 3: Quick fit assessment

For each new job, a rapid signal only (not the full `/apply` evaluation):
- **High** — role directly matches the candidate's core skills
- **Medium** — adjacent to the candidate's experience
- **Low** — requires significant missing skills

If the profile is still a template (placeholders present), skip scoring and say
the profile must be set up first (`/setup`).

---

### Step 4: Deduplicate & Store (both modes)

Add every fetched job (presented or skipped) to `job_scraper/seen_jobs.json`:

```json
{
  "seen": {
    "<jobs-view-id-or-url>": {
      "title": "...",
      "company": "...",
      "location": "...",
      "url": "https://.../jobs/view/...",
      "source": "linkedin",
      "first_seen": "YYYY-MM-DD",
      "fit": "high|medium|low|unknown",
      "status": "new|skipped|evaluated"
    }
  }
}
```

Use today's date from the session context for `first_seen`. Only present jobs
not already seen or tracked.

### Step 5: Present Results (Mode B)

Sort by fit (high first):

```
## New LinkedIn Matches — YYYY-MM-DD

Found X new postings (Y high, Z medium, W low).

| # | Fit | Title | Company | Location | Posted | URL |
|---|-----|-------|---------|----------|--------|-----|
| 1 | High | ... | ... | ... | ... | [Link](...) |
```

For each high-match job add 2–3 bullets: why it matches, key requirements to
check, any red flags (e.g. location outside the candidate's commute range).

Then ask:
> "Want a full evaluation of any of these? Give me the number(s) and I'll run
> `/apply` on it."

### Step 6: Hand off

If the user picks a job, invoke **`/apply <url>`** (fit evaluation first, then
CV + cover letter if approved). If they decide to apply, add a row to
`job_search_tracker.csv` with `source` = `linkedin`.

---

## Important Rules

1. **Never fabricate postings or fit scores.** Only present jobs returned by
   real WebSearch/WebFetch calls, and only score fit against a real profile.
2. **Respect deduplication.** Check `seen_jobs.json` *and*
   `job_search_tracker.csv` before presenting.
3. **Honour location.** Flag (don't silently drop) jobs outside the
   candidate's commute range; remote/hybrid jobs override a location mismatch.
4. **Only open positions.** Skip postings marked closed or past deadline.
5. **Be token-efficient.** Pre-filter on titles before WebFetch; don't fetch
   every search hit.
6. **Parallelise.** Run discovery WebSearch variants and detail WebFetch calls
   in parallel where possible.

---

## Usage Examples

### Read one posting
```
read this linkedin post https://www.linkedin.com/jobs/view/4393056776
```
→ Mode A: WebFetch the URL, summarise, offer `/apply`.

### Search by role + city
```
/linkedin AI engineer Sydney
```
→ Mode B: `WebSearch site:linkedin.com/jobs/view AI engineer Sydney`
(`allowed_domains: ["linkedin.com"]`) → fetch top hits → dedup → table.

### Search remote roles this week
```
find remote applied AI / agents jobs on linkedin posted this week
```
→ Mode B with location "remote" and a recency hint in the query.
