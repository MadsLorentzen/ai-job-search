# JobStreet URL & DOM Reference

Browser portal - there is no HTTP API this skill may use. These are the page URLs the
**Browser Recipe** in `SKILL.md` navigates to in the user's own Chrome session, and the DOM
anchors it parses. This is the file to update when JobStreet changes its markup.

> Personal use only - drives a signed-in browser session at hand-search volume. See the
> warning in `SKILL.md`.

## Access (checked 2026-09-03, re-confirmed 2026-09-10)

`https://www.jobstreet.com.my/robots.txt`:

| Path | Status | Used by this skill |
|------|--------|--------------------|
| `/<slug>-jobs`, `/jobs?keywords=…` (listing/search) | **Allowed** | yes - the only paths it navigates for scraping |
| `*/job/` (detail pages) | **Disallowed** | no - skill is search-only |
| `/graphql`, `/api/jobsearch/` | **Disallowed** | no |

A Cloudflare managed challenge 403s any non-browser User-Agent even on the allowed listing
path, which is why this is a browser portal and not a `fetch`-based CLI.

## Search / listing pages

Canonical form:

```
https://my.jobstreet.com/<query-kebab>-jobs
https://my.jobstreet.com/<query-kebab>-jobs/in-<Place-kebab>
https://my.jobstreet.com/<query-kebab>-jobs?page=<n>
```

`<query-kebab>`: lower-case the keyword phrase, replace runs of non-alphanumerics with a
single `-`. `senior product manager` -> `senior-product-manager`. `AI transformation` ->
`ai-transformation`.

Equivalent, 302s to the canonical path:

```
https://my.jobstreet.com/jobs?keywords=<url-encoded phrase>
```

| Concern | Handling |
|---------|----------|
| Location | `/in-Kuala-Lumpur`, `/in-Petaling-Jaya,-Selangor`, `/in-Selangor` path segment. Omit for all-Malaysia. |
| Pagination | `?page=2`, `?page=3`, … 1-indexed. ~30 cards/page. |
| Recency | **No reliable URL parameter.** Filter client-side on the parsed relative date. |
| Result count | Shown in a heading, e.g. "1,299 senior product manager jobs in Malaysia". |

## DOM anchors (listing page)

### Results region

`find "search results job list container region"` -> one region ref. Observed value
`ref_693` on every load in testing, **but re-find it after every `navigate`** - a ref
carried over from a prior page load raises `Element with ref_id '…' not found`.

Read it with `read_page {ref_id, filter: "all", max_chars: 20000}` (~12-15 cards; raise
`max_chars` or page for more).

### Per-job card

Each job is an `<article>` inside the region. Fields:

| Field | Anchor | Example / notes |
|-------|--------|-----------------|
| `id` | `href` of any card link: `/job/<digits>?…` | `94502082` - the stable dedupe key |
| `title` | card `heading` -> nested `link` text | "Senior Product Management Leader - Save & Spend" |
| `company` | `link` "Jobs at <X>" text, or bare `generic` "Private Advertiser" | masked employers show a generic word + `href="/jobs?advertiserid=<n>"` |
| `location` | `link` "Limit results to <place>" text | "Petaling, Selangor" |
| `salary` | `generic` "Salary: <text>" | **often absent** - emit `null` |
| `date` | `generic` relative age: "1d ago", "17h ago", "30d+ ago" | resolve to `YYYY-MM-DD`; "30d+ ago" -> `null` + `stale` mark |
| `url` | compose: `https://my.jobstreet.com/job/<id>` | canonical, resolves |
| `snippet` | `generic` teaser sentence under the salary/bullets | the only description text available |
| `subClassification` | `generic` "subClassification: <label>" | JobStreet taxonomy, e.g. "Product Management & Development" |
| `classification` | `generic` "(<parent label>)" | e.g. "(Information & Communication Technology)" |
| badges | `generic` texts: "New to you", "Viewed", "Be an early applicant", "Very strong applicant", "Expiring" | personalisation - only present when signed in |

## Detail pages

**Not used.** `robots.txt` disallows `*/job/`. The stored `url`
(`https://my.jobstreet.com/job/<id>`) is for the user to open manually; this skill never
navigates there for scraping. Deadline, full requirements, and closed-at-source status are
therefore unavailable from this portal - see `SKILL.md` "No `detail` command".

## Failure surfaces

| Symptom | Meaning |
|---------|---------|
| No results-region match from `find` | layout changed -> broken; update this file |
| Region reads with zero `<article>` nodes (all queries) + prior `jobstreet-search` rows in `seen_jobs.json` | layout changed -> broken |
| "Verify you are human" / Cloudflare interstitial | inconclusive - back off, do not loop |
| JobStreet sign-in wall | inconclusive - ask the user to sign in to JobStreet in Chrome |
| Extension not connected / no browser | inconclusive - browser portal cannot run in this context |
