# Welcome to the Jungle URL Reference

Public, unauthenticated endpoints used by this skill. Global — the same endpoints serve
every market; only the filters you pass change.

> Personal use only — keep volume low and don't use it for bulk data collection.

## Search (Algolia)

```
POST https://CSEKHVMS53-dsn.algolia.net/1/indexes/*/queries
```

Headers (the public search key is **referer-restricted**, so the Referer header is required):

| Header | Value |
|--------|-------|
| `X-Algolia-Application-Id` | `CSEKHVMS53` |
| `X-Algolia-API-Key` | `4bd8f6215d0cc52b26430765769e65a0` (public, search-only) |
| `Content-Type` | `application/json` |
| `Referer` | `https://www.welcometothejungle.com/` |

Body: `{"requests":[{"indexName":"wk_cms_jobs_production","params":"<url-encoded query string>"}]}`

`params` query string values the CLI uses:

| Param | Meaning | Example |
|-------|---------|---------|
| `query` | Free-text query | `devops engineer` |
| `hitsPerPage` | Page size | `20` |
| `page` | 0-indexed page | `0`, `1`, `2`, … |
| `facetFilters` | JSON array, ANDed | `["offices.country_code:US","remote:partial"]` |
| `attributesToRetrieve` | JSON array of fields | trims the company-description bloat |

Facet vocabularies (from the live index):

- `remote`: `fulltime` · `partial` · `punctual` · `no` · `unknown`
- `contract_type`: `FULL_TIME` · `PART_TIME` · `INTERNSHIP` · `APPRENTICESHIP` · `FREELANCE` · `TEMPORARY` · `VIE` · `OTHER` · `GRADUATE_PROGRAM` · `VOLUNTEER`
- `offices.country_code`: ISO codes — `FR` (dominant), `ES`, `GB`, `US`, `DE`, `CA`, …
- `offices.city`: proper-cased city names — `Paris`, `London`, `Los Angeles`, …

Each hit carries `objectID`, `reference`, `name`, `slug`, `organization.{name,slug}`,
`offices[]`, `remote`, `contract_type(_names)`, and `published_at`.

## Detail (public jobs API)

Two-step, because search returns a `reference` but the detail endpoint is keyed by org + slug.

1. Resolve a reference to an org slug and job slug:

   ```
   GET https://api.welcometothejungle.com/api/v1/jobs/<reference>
   → { "website_organization_slug": "...", "job_slug": "..." }
   ```

2. Fetch the full job:

   ```
   GET https://api.welcometothejungle.com/api/v1/organizations/<org>/jobs/<slug>
   ```

   Returns `{ "job": { name, description, profile, apply_url, remote, contract_type,
   experience_level_minimum, salary_min/max/currency/period, skills, offices, organization, … } }`.
   `description` and `profile` are HTML fragments (the CLI strips them to plain text).

## Job page

```
https://www.welcometothejungle.com/en/jobs/<slug>
```

## Notes

- No authentication required for either endpoint.
- The human-facing HTML pages are behind bot mitigation (DataDome); the Algolia index and the
  jobs API above are the reliable, public data path.
- Respect rate limits — the CLI backs off on 429/5xx.
- Country-agnostic: pass any `--country`/`--location`/`--remote` filter.
