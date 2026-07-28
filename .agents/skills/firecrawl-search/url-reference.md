# Firecrawl API reference

The endpoints, parameters, and response shapes this skill depends on.
**This is the file to update if the API changes.** Official docs:
<https://docs.firecrawl.dev>.

Base URL: `https://api.firecrawl.dev` (API version `v2`), overridable with the
`FIRECRAWL_API_URL` env var for a self-hosted instance.

## Authentication

Requests carry `Authorization: Bearer $FIRECRAWL_API_KEY` **when a key is set**.
Auth handling depends on which endpoint is targeted:

| `FIRECRAWL_API_URL` | `FIRECRAWL_API_KEY` | Behaviour |
|---------------------|---------------------|-----------|
| unset (hosted cloud) | set | `Authorization` sent |
| unset (hosted cloud) | unset | exits `1` with `NO_API_KEY` before any request |
| set (self-hosted) | unset | **no `Authorization` header at all** — self-hosted Firecrawl [defaults to authentication disabled](https://github.com/firecrawl/firecrawl/blob/main/SELF_HOST.md), and a placeholder key would turn that into a 401 |
| set (self-hosted) | set | `Authorization` sent to that instance |

Note the last row's corollary: a key that is set is sent to whatever
`FIRECRAWL_API_URL` names, so it should only point at a trusted host.

Verified against the live cloud API:

| Endpoint | Status |
|----------|--------|
| `POST /v2/search` | 200 with a valid key |
| `POST /v2/scrape` | 200 with a valid key |
| either, bogus key | `401` — failed immediately, not retried |

## Envelope

Both endpoints wrap their payload:

```jsonc
{
  "success": true,
  "data": { /* endpoint-specific */ },
  "creditsUsed": 17,      // surfaced as meta.credits_used on search
  "id": "…"               // search job id (used by the feedback endpoint; unused here)
}
```

On failure `success` is `false` with an `error` string, and validation failures add a
`details` array naming the offending field. The CLI appends `details` to the error
message, so `Invalid request body` becomes actionable.

## `POST /v2/search`

Body parameters used by the skill:

| Param | Maps to CLI flag | Notes |
|-------|------------------|-------|
| `query` | `--query` / `-q` | Required. Supports operators: `""`, `-`, `site:`, `inurl:`, `intitle:`, `filetype:` |
| `limit` | `--limit` × `--page` | **Max 100** (verified: 101+ returns `too_big`) |
| `sources` | — | Always `["web"]`; `news`/`images` are not job sources |
| `tbs` | `--jobage` | Bucketed: `qdr:h`, `qdr:d`, `qdr:w`, `qdr:m`, `qdr:y`. Omitted when > 366 days. Filters the **search index's freshness signal**, *not* the posting's `date_posted` — see "Recency" below |
| `country` | `--country` | ISO-3166 alpha-2. API default `US` |
| `location` | `--location` / `-l` | Free-text geo-target, e.g. `"Berlin,Germany"` |
| `includeDomains` | `--site` | Bare hostnames, no scheme or path |
| `excludeDomains` | `--exclude-site` | **Mutually exclusive** with `includeDomains` — sending both returns `includeDomains and excludeDomains cannot both be specified` |
| `scrapeOptions` | (omitted by `--no-enrich`) | `{onlyMainContent: true, formats: [{type: "json", prompt, schema}]}` |

There is **no offset/cursor parameter**, which is why `--page n` over-fetches
`n × limit` results and returns the last window.

### Recency (`tbs`) is not posting age

`tbs` is applied by the search backend when selecting results, i.e. before any page
is scraped and before `date_posted` exists. It therefore filters on how fresh the
*index* considers the page, which is not the same as when the job was posted: a
long-lived posting page that was recently recrawled can pass a narrow bucket, and a
freshly posted job on a stale-looking page can be excluded. The skill maps
`--jobage` onto it as a best-effort hint and documents it as such; precise
posting-age filtering has to happen downstream on the extracted `date`.

### Credits (measured live)

| Request | Credits |
|---------|---------|
| search, no `scrapeOptions` | **2 × ceil(limit / 10)** (2 at `limit` 10, 4 at `limit` 15) |
| search with `scrapeOptions` json extraction | search cost above + **~5 per successfully enriched result** (12 at `limit` 2, 17 at `limit` 3, ~104 at `limit` 20 when every result is enriched) |
| `POST /v2/scrape` with markdown + json | ~5 |

`creditsUsed` is returned on every response and surfaced as `meta.credits_used`;
treat the table as indicative and the response field as authoritative.

### Result items (`data.web[]`)

The item shape depends on whether `scrapeOptions` was sent — this union is the main
parsing hazard, so the CLI reads both shapes with fallbacks.

```jsonc
// Without scrapeOptions (--no-enrich): a plain search result
{
  "url": "https://job-boards.greenhouse.io/acme/jobs/1",
  "title": "Job Application for Data Engineer at Acme",
  "description": "…snippet…",
  "position": 1
}

// With scrapeOptions: a Document. Top-level url/title are still present, but
// metadata mirrors them (metadata.sourceURL / metadata.title) and `json` carries
// the extracted fields. An item with no resolvable URL is dropped.
{
  "url": "…", "title": "…", "description": "…", "position": 1,
  "json": {                       // matches JOB_SCHEMA in cli/src/helpers.ts
    "company": "Acme",
    "location": "Berlin, Germany",
    "date_posted": "2026-07-06",  // "" when the page states none
    "employment_type": "",
    "deadline": ""
  },
  "metadata": { "sourceURL": "…", "title": "…", "statusCode": 200 }
}
```

Extraction is model-based, so absent fields come back as **empty strings**; the CLI
maps those to `null` so "stated but empty" never reaches the contract output.

## `POST /v2/scrape`

Body parameters used by `detail`:

| Param | Maps to CLI flag | Notes |
|-------|------------------|-------|
| `url` | the `<url>` argument | A search result's `id` is exactly this |
| `onlyMainContent` | — | Always `true`: strips nav/footer from the posting text |
| `formats` | — | `["markdown", {type: "json", prompt, schema}]` — one request returns both the text and the structured fields |

Response `data` is a document: `markdown` (the posting text), `json` (same schema as
above), and `metadata` (`sourceURL`, `title`, `description`, `statusCode`).

Not every site is scrapeable — some are explicitly unsupported and return
`success: false` with a message pointing at Firecrawl's intake form. The CLI surfaces
that message as a `DETAIL_FAILED` error rather than pretending the posting was empty.

## Parsing notes

- `formats: ["markdown"]` returns the page text. It is **not** a summary — the
  `summary` format would be an LLM digest, which this skill deliberately does not use
  for `detail`, so `/scrape` sees the real posting wording.
- Dates: an ISO-prefixed value is truncated to `YYYY-MM-DD`; anything else the page
  stated is preserved verbatim rather than converted to a guessed date.
- Domains are normalised before sending: scheme, path, and a leading `www.` are
  stripped and the host is lowercased.
- Requests use a `firecrawl-search-skill/1.0` User-Agent, a 180 s `AbortSignal`
  timeout (enrichment scrapes every hit, so a search is legitimately slow), and
  exponential backoff with jitter on 429/5xx up to 6 retries. `401`/`403` is terminal.
- Other Firecrawl operations (`crawl`, `map`, `monitor`, `batch`) are intentionally
  **not** wired: this skill is search + detail only, matching the portal-skill
  contract.
