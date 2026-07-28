---
name: firecrawl-search
version: 1.0.0
description: >
  Use this skill to find job postings on job boards that have no dedicated portal
  skill yet — any board, any country, any language — by searching the live web with
  Firecrawl and reading a posting's full text. It needs no per-portal HTML parser, so
  it is the fallback when a market's board is unsupported, when a shipped portal
  skill has broken on a markup change, or when a posting URL needs to be read in
  full. The hosted API requires FIRECRAWL_API_KEY and is metered per result; a
  self-hosted FIRECRAWL_API_URL may be keyless. Invoke this skill directly rather
  than through /scrape. Trigger phrases:
  search the web for jobs, find jobs on <job board>, jobs in <country> without a
  portal skill, read this job posting URL, scrape this job ad, my portal skill is
  broken find jobs anyway.
context: fork
enabled: false # deliberate: a metered per-result source must not run unattended in /scrape - see "Why this stays out of /scrape"
allowed-tools: Bash(bun run .agents/skills/firecrawl-search/cli/src/cli.ts *)
---

# Firecrawl Search Skill

Find job postings anywhere on the web via **[Firecrawl](https://docs.firecrawl.dev)**
and read a single posting in full. Where the other portal skills each target one
board with its own parser, this one targets **the web**: Firecrawl runs the search
and extracts the job fields from each posting page, so a single skill covers any
board in any market and language with **no markup anchors to maintain**.

> This is a country-agnostic worked example of the repo's job-portal-skill pattern,
> like `linkedin-search` and `freehire-search`. Unlike both, it is **not** tied to a
> single site — the board is chosen per query with `--site` — and unlike either, it
> requires an API key when using the hosted service.

## ⚠️ Credentialed and metered — invoke it directly, not via `/scrape`

Every other portal skill in this repo is credential-free and free to run. **The
hosted version of this one is neither.** It needs `FIRECRAWL_API_KEY` (get one at
[firecrawl.dev](https://firecrawl.dev)) and every result costs credits:

```bash
export FIRECRAWL_API_KEY="fc-..."
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "data engineer job opening" --limit 5
```

**Measured credit cost** (from live runs; `meta.credits_used` reports the real figure
every time):

| Call | Cost |
|------|------|
| Plain search (`--no-enrich`) | **2 × ceil(limit / 10)** — 2 at `--limit 10`, 4 at `--limit 15` |
| Enriched search (default) | search cost above + **~5 per successfully enriched result** — ~27 at `--limit 5`, **~104 at `--limit 20`** when every result is enriched |
| `detail <url>` | one scrape + extraction, ~5 |

### Why this stays out of `/scrape`

`/scrape` has no notion of a metered source. Step 1b runs **every enabled portal**
as a co-equal primary for several query categories at ~20 results each — so flipping
`enabled: true` would silently make this the most expensive part of a routine run:
roughly **100 credits per query**, i.e. several hundred per `/scrape`. That is not a
sensible default for a source whose free tier is measured in hundreds of credits
total.

So `enabled: false` here is **not** "enable me once you have a key" — it is the
intended steady state. Use this skill the way you'd use a generalist tool: **invoke
it directly** when you need it, with a small `--limit` you have chosen. It still
triggers by name from its description, and `detail <url>` works on a posting URL from
*any* source, including another portal whose own `detail` has broken.

If you do enable it for `/scrape`, do it knowingly: cap `--limit` hard and expect a
recurring per-run bill. A `fallback`-tier source that `/scrape` reaches for only after
an unsupported or failed portal — with a visible per-run credit budget — would be the
right way to automate this, and does not exist in the framework today.

Without a key (and without a self-hosted `FIRECRAWL_API_URL`) every command exits `1`
with `NO_API_KEY` on stderr, so nothing runs up a bill by accident.

## ℹ️ Hosted-service dependency

This skill depends on the hosted Firecrawl API. If it is unreachable the CLI fails
gracefully — a non-zero exit with a clear message — so an outage degrades this source
rather than breaking the surrounding workflow. Firecrawl is also self-hostable
([open source](https://github.com/firecrawl/firecrawl)); the skill honors a base-URL
env var, `FIRECRAWL_API_URL` (default `https://api.firecrawl.dev`). A self-hosted
instance runs **unauthenticated by default**, so no key is required when
`FIRECRAWL_API_URL` is set — and running your own instance is also how you avoid the
credit costs above entirely:

```bash
FIRECRAWL_API_URL=http://localhost:3002 bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "data engineer job"
```

If your self-host *does* require a key, set `FIRECRAWL_API_KEY` as well and it is sent
to that instance. Note the corollary: whenever a key is set it goes to whatever
`FIRECRAWL_API_URL` names, so don't point it at a host you don't trust with your
cloud key.

## When to use this skill

- Your market's job board has **no portal skill** and you have not built one with
  `/add-portal` yet
- A shipped portal skill has gone **degraded or broken** on a markup change (see
  `/scrape health`) and you still want coverage of that board today
- You want to sweep **several boards at once** by domain rather than one at a time
- You have a **posting URL** and want its full text, deadline, and employment type

For a board that you search regularly, a dedicated `/add-portal` skill is still the
better tool: it is free, faster, and needs no key. This skill is the generalist.

## Commands

### Search job listings

```bash
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — **required.** Keywords. Google-style operators
  work: `"exact phrase"`, `-exclude`, `inurl:`, `site:`.
- `--site <domains>` — restrict to these boards (comma-separated, repeatable), e.g.
  `--site jobs.lever.co,job-boards.greenhouse.io`. Maps to `includeDomains`.
- `--exclude-site <domains>` — drop these domains instead. **Mutually exclusive**
  with `--site` (the API rejects both; the CLI catches it before spending credits).
- `--country <code>` — ISO-3166 alpha-2 search locale, e.g. `--country DK`. Default `US`.
- `--location <place>` / `-l <place>` — geo-target the results, e.g. `--location "Berlin,Germany"`.
- `--jobage <days>` — search-freshness hint, **not** a posting-date filter. See **Notes**.
- `--page <n>` — 1-indexed page. Default 1.
- `--limit <n>` / `-n <n>` — results per page. Default 10; `page × limit` must be ≤ 100.
- `--no-enrich` — skip per-result extraction. Much cheaper and faster, but
  `company`, `location`, and `date` come back `null`.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/firecrawl-search/cli/src/cli.ts detail <url> [--format json|plain]
```

`<url>` is a posting URL — a search result's `id` **is** its URL, so it can be passed
straight through. Returns the posting text as markdown plus the extracted company,
location, posting date, employment type, and application deadline.

## Usage examples

```bash
# Data engineering roles across the big ATS boards, last 30 days
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "data engineer job opening" --site job-boards.greenhouse.io,jobs.lever.co,jobs.ashbyhq.com --jobage 30 --limit 5 --format table

# A market with no portal skill yet: Germany, in German
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "Stellenangebot Datenanalyst bewerben" --country DE --location "Germany" --limit 5 --format table

# Cheap, wide sweep for URLs only (4 credits at --limit 20)
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q '"machine learning engineer" remote apply' --no-enrich --limit 20

# Everything except one noisy aggregator
bun run .agents/skills/firecrawl-search/cli/src/cli.ts search -q "geophysicist vacancy" --exclude-site indeed.com --limit 5 --format table

# Read one posting in full
bun run .agents/skills/firecrawl-search/cli/src/cli.ts detail https://job-boards.greenhouse.io/acme/jobs/123 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing a result's `id` (its URL) to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single posting's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total", "enriched", "credits_used" }, "results": [...] }`;
each result carries at least `id` (the posting URL), `title`, `company`, `location`,
`date`, and `url` (missing values are `null`, never omitted), plus a `snippet`. All
errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Write the query like a job search, not a keyword

This searches **the whole web**, so an unqualified role name finds reference pages
rather than vacancies — `-q "geophysicist"` returns Wikipedia and a careers-advice
page. Two habits fix it, and the CLI deliberately does **not** apply them for you
(it never rewrites your query behind your back):

- **State the intent**: `"geophysicist job opening apply"`, `"Stellenangebot ..."`,
  `"ledige stillinger ..."` — in the market's own language.
- **Scope the domains**: `--site` with the boards you actually want. ATS domains
  (`job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `*.workday.com`)
  resolve to individual postings; large aggregators often rank their **search-results
  pages** instead, so `--site jobindex.dk` can return `/jobsoegning?q=...` listing
  URLs rather than single ads. Add `inurl:` to bias toward posting paths, or prefer a
  dedicated `/add-portal` skill for such a board.

## Notes

- **`--jobage` does not honor the contract's posting-age semantics.** It maps to
  Firecrawl's `tbs` parameter, which filters on the **search engine's freshness
  signal for the page** — not on the posting's `date_posted`, which is only extracted
  afterwards, per result. It is therefore a *hint*, and a lossy one in both
  directions: it can return postings older than N days, and it can miss recent ones
  whose page the index dates differently. It is also bucketed
  (hour/day/week/month/year), so `--jobage 14` requests the **month** bucket. When
  posting age actually matters, filter on the extracted `date` field downstream
  rather than trusting this flag.
- **`--page` re-fetches.** Firecrawl search has no offset parameter, so page N is
  served by requesting `page × limit` results and returning the last window. Page 1
  (the common case) fetches exactly what it needs; deeper pages cost proportionally
  more.
- **Extraction is model-based, so treat fields as best-effort.** `company` and
  `location` land reliably on real posting pages; `date` is often absent because many
  boards do not publish one. A `date` the page states in a non-ISO form (e.g.
  "3 days ago") is kept **verbatim** rather than converted to a guessed calendar date.
- `id` in search results is the posting **URL** — pass it as-is to `detail`.
- Results whose URL cannot be resolved are dropped rather than emitted with a
  placeholder.
- The API retries 429/5xx with exponential backoff and jitter; a `401`/`403` fails
  immediately with a key-specific message instead of retrying.
- Endpoints, parameters, and response shapes are documented in `url-reference.md` —
  that is the file to update if the Firecrawl API changes.
