# ENTRA API reference

The endpoints, parameters, and response shapes this skill depends on. This is the
file to update if the ENTRA API changes. Base URL defaults to
`https://entracareers.com/api` and is overridable via the `ENTRA_API_URL` env var;
the public site (`https://entracareers.com`, used for result links) via `ENTRA_SITE_URL`.

## Authentication

None for reads. `GET /jobs`, `GET /jobs/{id}`, `GET /companies` and
`GET /specializations` are public; only account actions (apply, favorites,
employer endpoints) require a bearer token, and this skill does not use them.

Verified against the live API on 2026-09-19:

| Endpoint | Status |
|----------|--------|
| `GET /jobs` | 200 |
| `GET /jobs/{id}` | 200 (404 JSON error for an unknown id) |
| `GET /companies` | 200 |
| `GET /specializations` | 200 (slug vocabulary for `--specialization`) |
| `GET /jobs/search-suggestions?q=` | 200 (not used by this skill) |
| `GET /jobs/salary-ranges` | 200 (not used by this skill) |
| `GET /countries`, `GET /cities` | 404 — no public lookup, hence the client-side `--location` |

## Envelope

Lists are `{ "data": [...], "page", "limit", "total", "totalPages" }`; a single
item is `{ "data": {...} }`. Errors are Fastify-style
`{ "statusCode": 404, "error": "Not Found", "message": "..." }` with a 4xx/5xx status.

## `GET /jobs`

Full-text + filter search over active postings, newest first by default.

Query parameters used by the skill (the full schema, `JobFiltersSchema`, accepts
more — id-keyed geography, industries, languages, benefits — none of which a CLI
user can supply without a lookup endpoint):

| Param | Maps to CLI flag | Notes |
|-------|------------------|-------|
| `search` | `--query` / `-q` | Full-text over title/description/company (`search=stripe` matches the company). |
| `workLocation` | `--remote` | `remote` \| `hybrid` \| `office`. |
| `experienceLevel` | `--experience` | `no_experience` \| `1_3_years` \| `3_6_years` \| `6_plus_years`. |
| `employmentType` | `--employment` | `full_time` \| `part_time` \| `contract` \| `freelance` \| `internship`. |
| `specializationSlugs` | `--specialization` | Repeatable (`?specializationSlugs=a&specializationSlugs=b`), OR within the facet. Verified live: two slugs widen the count. |
| `companyId` | `--company` | UUID; the CLI resolves a slug/name via `GET /companies?search=` first. |
| `salaryMin` | `--salary-min` | Integer; only postings with a stated salary match (most don't). |
| `sortBy` | `--sort` | `publishedAt` (date) or `salary`; also `title`, `company` (unused). |
| `sortOrder` | (fixed `desc`) | |
| `page` | `--page` | 1-indexed. |
| `limit` | `--limit` / `-n` | 1–100 (server maximum 100). |

Not available server-side (handled client-side in `search.ts`):

- **Recency** — no `posted_within_days`; `--jobage` filters on `publishedAt` after the call.
- **Free-text location** — geography is `countryId` / `cityId` / `citySlugs` (ids or
  internal slugs, no public lookup); `--location` substring-matches the rendered
  `"City, Country"`.

Unknown query parameters are ignored by the API (no error), so the CLI validates
flags itself and rejects unknown ones.

### Job object (the fields the skill reads)

```jsonc
{
  "id": "25b71e5a-db28-43a2-84c0-1c7df875a547", // -> result.id, and detail's <id>
  "title": "Product Manager, Mobile",
  "description": "Who we are\n\nAbout Stripe\n…",   // plain text with newlines (some sources: HTML)
  "requirements": null,                             // separate requirements text, often null
  "employmentType": "full_time",
  "workLocation": "remote",                         // office | remote | hybrid
  "experienceLevel": "3_6_years",
  "salaryMin": null, "salaryMax": null,             // stated salary, usually null
  "salaryCurrency": "USD", "salaryPeriod": "monthly", // period defaults even when salary is null
  "source": "greenhouse",                           // ATS the posting was ingested from
  "externalApplyUrl": "https://stripe.com/jobs/search?gh_jid=8140438", // -> apply_url
  "isActive": true,
  "publishedAt": "2026-09-16T10:52:18.948Z",        // -> result.date
  "expiresAt": "2026-10-16T10:52:14.827Z",
  "company": { "id": "…", "name": "Stripe", "slug": "stripe", "isVerified": false },
  "specialization": { "nameEn": "Product Manager", "slug": "product-manager" },
  "country": { "nameEn": "United States", "slug": "usa", "flag": "🇺🇸" }, // no ISO code field
  "city": { "nameEn": "New York City", "slug": "new-york-city" }
}
```

`country` carries no ISO code; the public posting URL is built as
`https://entracareers.com/vacancies/<id>` (the site geo-redirects to a country
prefix, any prefix resolves).

## `GET /jobs/{id}`

A single job by UUID, same object in `data`. An expired posting is still served
(`isActive: false`); an unknown id is a 404 JSON error, which the skill maps to
`NOT_FOUND` on stderr.

## `GET /companies`

`?search=<text>&limit=<n>&page=1` → `{ data: [{ id, name, slug, isVerified, … }], total, page, limit }`.
The skill uses it only to resolve `--company` (exact slug/name match preferred,
otherwise the first row). Verified live: `search=spacex` → one row, slug `spacex`.

## `GET /specializations`

The specialization vocabulary (`slug`, `nameEn`) behind `--specialization`. The
skill does not call it programmatically; it is the discovery source the SKILL.md
points users to.

## Parsing notes

- Responses are JSON, so there is no HTML card parsing. Descriptions are plain text
  for most ATS sources; `cleanHtml` (`cli/src/helpers.ts`) strips tags and decodes
  entities for the ones that arrive as HTML and passes plain text through with
  whitespace normalized.
- Fetch uses `Mozilla/5.0 (compatible; entra-cli/1.0)`, `Accept: application/json`,
  a 15 s timeout, and exponential backoff with jitter on 429/5xx (max 6 retries). A
  connection error (API unreachable) fails fast with a clear message — no retry —
  which is the graceful-degradation contract.
