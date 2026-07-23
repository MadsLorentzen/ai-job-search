# freehire.me API reference

The endpoints, parameters, and response shapes this skill depends on. This is the
file to update if the freehire API changes. Base URL defaults to
`https://freehire.me` and is overridable via the `FREEHIRE_API_URL` env var.

## Authentication

None for reads. `GET /api/v1/jobs/*` and `/companies/*` are public; only per-user
tracking mutations (`apply`/`save`/`me`) require a bearer API key, and this skill
does not use them.

Verified against the live API:

| Endpoint | Status |
|----------|--------|
| `GET /api/v1/jobs/search` | 200 |
| `GET /api/v1/jobs/facets` | 200 |
| `GET /api/v1/jobs/{slug}` | 200 |
| `GET /api/v1/auth/me` | 401 (auth required — not used here) |

## Envelope

Every response is `{ "data": ..., "meta": {...}, "error": "..." }`. Lists put the
array in `data` and pagination in `meta` (`{ total, limit, offset }`); a single
item puts the object in `data`. Errors are `{ "error": "<message>" }` with a 4xx/5xx
status (e.g. 404 → `{ "error": "not found" }`).

## `GET /api/v1/jobs/search`

Full-text + facet search over open jobs. Returns `data: [job, …]` with
`meta.total` = the total match count.

Query parameters used by the skill:

| Param | Maps to CLI flag | Notes |
|-------|------------------|-------|
| `q` | `--query` / `-q` | Keyword full-text query. |
| `limit` | `--limit` / `-n` | Page size. Default 25 in the CLI. |
| `offset` | (derived) | `offset = (page - 1) * limit`. |
| `semantic_ratio` | (fixed `0`) | Keyword search; the semantic index is opt-in. |
| `posted_within_days` | `--jobage` | Restrict to postings from the last N days. |
| `regions` | `--region` | Repeatable; OR within the facet. Values like `global`, `eu`, `us`, `apac`, `latam`, `cis`. |
| `countries` | `--country` | Repeatable; ISO-3166 alpha-2 (lowercased). |
| `cities` | `--city` | Repeatable; display-name city. |
| `seniority` | `--seniority` | Repeatable; `junior`, `middle`, `senior`, `staff`, … |
| `category` | `--category` | Repeatable; `backend`, `frontend`, `fullstack`, `devops`, `ml_ai`, … |
| `skills` | `--skill` | Repeatable; canonical skill names. |
| `company_slug` | `--company` | Single company. |
| `work_mode` | `--remote` | `remote` \| `hybrid` \| `onsite`. |
| any facet param | `--facet key=value` | Escape hatch for the long tail (e.g. `salary_min`, `visa_sponsorship`, `employment_type`, `english_level`). |

Repeated params (`?seniority=senior&seniority=staff`) are ORed within a facet;
different facets are ANDed (geography ORs into one location group). Deep paging is
bounded server-side (`offset + limit ≤ 10000`).

### Job object (the fields the skill reads)

```jsonc
{
  "public_slug": "golang-zensar-2bxu6dxm", // -> result.id, and detail's <slug>
  "source": "oracle",
  "external_id": "…",
  "url": "https://…",                       // the real posting URL (ATS host)
  "title": "GOLANG",
  "company": "Zensar",
  "company_slug": "zensar",
  "location": "India",                       // free-text ATS location
  "description": "<ul><li>…</li></ul>",      // HTML; the skill strips it for detail
  "skills": ["go", "kubernetes", …],         // dictionary facet (top-level)
  "work_mode": "remote",                     // may be absent
  "regions": ["apac"],                       // dictionary/hybrid facet
  "countries": ["in"],
  "cities": [],
  "collections": [],
  "posted_at": "2026-07-06T00:00:00Z",       // -> result.date (nullable)
  "created_at": "2026-07-06T15:25:…Z",
  "enrichment": {                             // nested, typed; {} when unenriched
    "seniority": "senior",
    "category": "backend",
    "employment_type": "full_time",
    "salary_min": 90000, "salary_max": 120000, "salary_currency": "EUR"
  }
}
```

The internal numeric id is deliberately never exposed; `public_slug` is the stable
identifier.

## `GET /api/v1/jobs/{slug}`

A single job by its `public_slug`. Returns the same job object in `data`. A closed
posting is still served here (with a non-null `closed_at`); a missing slug is 404
`{ "error": "not found" }`. The skill's `detail` command maps a 404 to a
`NOT_FOUND` error on stderr.

## `GET /api/v1/jobs/facets`

The market's facet-value distributions under an optional filter — each facet's live
values with counts. `data.facets` is `{ <facet>: { <value>: <count> } }`. This skill
does not call it programmatically, but it is the vocabulary source the SKILL.md
points users to (`?q=<role>` scopes the counts). Example:
`GET /api/v1/jobs/facets?q=react`.

## Parsing notes

- The response is JSON, so there is no HTML card parsing (unlike the scraping
  portals). The only markup handling is stripping the `description`'s HTML into
  readable text (`cleanHtml` in `cli/src/helpers.ts`).
- Fetch uses a browser-ish User-Agent, `Accept: application/json`, and exponential
  backoff with jitter on 429/5xx (max 6 retries). A connection error (API
  unreachable) fails fast with a clear message — no retry, since it is not
  transient server load — which is the graceful-degradation contract: an outage
  degrades this source quickly instead of hanging the caller.
