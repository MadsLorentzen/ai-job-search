# Otta / Welcome to the Jungle URL Reference

Otta was acquired by **Welcome to the Jungle**; `https://otta.com` now `301`-redirects to
`https://uk.welcometothejungle.com` (marketing) and the job board lives at
`https://www.welcometothejungle.com`. This skill uses two public, unauthenticated endpoints.

> Personal use only — automated access is against the site's Terms of Service; keep volume low.

## What is and isn't accessible

| Surface | URL | Status |
|---------|-----|--------|
| Otta "matching" app | `app.welcometothejungle.com` | **Login-gated** — not used |
| Public HTML job board | `www.welcometothejungle.com/en/jobs` | AWS WAF bot-challenge (`202`, `x-amzn-waf-action: challenge`) — **not fetchable** by a plain client |
| Public Algolia job index | `csekhvms53-dsn.algolia.net` | **Public** — used for `search` |
| Public REST API | `api.welcometothejungle.com/api/v1` | **Public** — used for `detail` |

`robots.txt` (`uk.welcometothejungle.com/robots.txt`) has an empty `Disallow:` (nothing
disallowed), but the site ToS prohibits automated/bulk access — hence the personal-use warning.

## Search — Algolia

```
POST https://csekhvms53-dsn.algolia.net/1/indexes/*/queries
```

Headers:

| Header | Value |
|--------|-------|
| `x-algolia-application-id` | `CSEKHVMS53` |
| `x-algolia-api-key` | `4bd8f6215d0cc52b26430765769e65a0` (public, search-only) |
| `content-type` | `application/x-www-form-urlencoded` |
| `origin` | `https://www.welcometothejungle.com` |

Body (JSON):

```json
{ "requests": [ { "indexName": "wk_cms_jobs_production", "params": "query=data%20analyst&hitsPerPage=30&page=0&filters=offices.country_code:IN AND remote:fulltime" } ] }
```

`params` is a URL-encoded Algolia query string:

| Param | Meaning | Example |
|-------|---------|---------|
| `query` | Free-text query | `data analyst` |
| `hitsPerPage` | Results per page (≤1000) | `30` |
| `page` | **0-indexed** page | `0`, `1`, … |
| `filters` | Algolia facet filter expression | `offices.country_code:IN`, `remote:fulltime`, joined with ` AND ` |

Filterable facets used here:
- `offices.country_code` — ISO 3166-1 alpha-2 (`IN`, `GB`, `FR`, `US`, …)
- `remote` — `fulltime` · `partial` · `punctual` · `none` · `unknown`

Response: `results[0].hits[]` plus `results[0].{nbHits,nbPages,page,hitsPerPage}`.
Algolia caps reachable results at `paginationLimitedTo = 1000` per query.

### Hit fields consumed

| Field | Maps to |
|-------|---------|
| `objectID` | `id` (stable) |
| `name` | `title` |
| `organization.name` / `organization.slug` | `company` / `companySlug` |
| `office.city` + `office.country_code` | `location` |
| `remote` | `remote` |
| `contract_type_names.en` / `contract_type` | `contractType` |
| `published_at` (ISO-8601) | `date` |
| `slug` | `slug` |
| derived | `url` = `…/en/companies/{companySlug}/jobs/{slug}` |

## Detail — REST

```
GET https://api.welcometothejungle.com/api/v1/organizations/{org_slug}/jobs/{job_slug}
```

Returns `{ "job": { … } }`. Returns `404` for unknown slugs. Fields consumed: `name`,
`organization.name`, `offices[0]`/`office`, `remote`, `contract_type`, `experience_level`,
`education_level`, `salary_min`/`salary_max`/`salary_currency`/`salary_period`,
`description` (HTML), `profile` (HTML — "preferred experience"), `apply_url`, `published_at`,
`urls[kind=canonical].href`.

Resolving an `id` for `detail`:
- A full job URL → org + job slug parsed directly from `/companies/{org}/jobs/{slug}`.
- A bare numeric `objectID` or a job `slug` → one Algolia lookup
  (`filters=objectID:<id>` or `filters=slug:<id>`) to recover `organization.slug` + `slug`,
  then the REST call above.

## Maintenance notes

- If Algolia returns `403 {"message":"Invalid Application-ID or API key"}`, the public
  search key rotated. Recover the current `CSEKHVMS53` key from the WTTJ front-end bundle
  (Algolia `x-algolia-api-key`) and update `ALGOLIA_API_KEY` / `ALGOLIA_APP_ID` in
  `cli/src/helpers.ts`.
- The REST detail host is not behind the WAF; the HTML `www` host is. Do not switch `detail`
  to scrape the HTML page.
