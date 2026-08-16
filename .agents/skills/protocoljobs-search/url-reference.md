# Protocol Jobs API Reference

Protocol Jobs (protocoljobs.ai) is a **Framer marketing site** at the apex domain and a
**Next.js app** at `app.protocoljobs.ai`, both backed by a JSON API at
`https://api.protocoljobs.ai`. This skill talks to the API directly.

> Personal use only — public endpoints, but no published API agreement; keep volume low.
> robots.txt (`https://protocoljobs.ai/robots.txt`) is fully permissive (`User-agent: * / Allow: /`).

## Base URL

```
https://api.protocoljobs.ai
```

The app resolves this at runtime (`resolveApiBaseUrl()` in the client bundle): any host
other than localhost uses `https://api.protocoljobs.ai`.

## Search — `POST /api/featured-jobs`  (public, no auth)

The app's real search, `POST /api/jobs/search`, is **login-gated** and returns
`401 {"error":"Unauthorized user!"}`. `POST /api/featured-jobs` takes the **identical
request body**, is public, and is backed by the full listing database, so this skill uses
it as the search endpoint.

Request body:

```json
{
  "filters": {
    "keyword": "data analyst",
    "locations": ["BENGALURU"],
    "domain": ["data"],
    "jobFreshness": ["last1Week"],
    "experienceBands": ["threeFive"]
  },
  "page": { "limit": 20, "cursor": null }
}
```

| Body path | Meaning | Values |
|-----------|---------|--------|
| `filters.keyword` | Free-text title match | any string |
| `filters.locations[]` | Location codes | `REMOTE`, `HYBRID`, `TIER_1_CITIES`, `OTHER_CITIES`, `AHMEDABAD`, `BENGALURU`, `CHENNAI`, `DELHI_NCR`, `GURGAON`, `HYDERABAD`, `KOLKATA`, `MUMBAI`, `NOIDA`, `PUNE` |
| `filters.domain[]` | Job domain | `product`, `frontend`, `backend`, `fullstack`, `qa`, `devops`, `cloud`, `ml_ai`, `data`, `mobile`, `product_design`, `project_program_management` |
| `filters.jobFreshness[]` | Recency bucket | `last48Hours`, `last72Hours`, `last1Week`, `last2Weeks`, `last4Weeks` |
| `filters.experienceBands[]` | Experience | `zeroOne`, `zeroThree`, `threeFive`, `fiveSeven`, `sevenTen`, `tenPlus` |
| `page.limit` | Page size | integer (skill uses 20 or `--limit`) |
| `page.cursor` | Opaque next-page cursor | base64 string from `pageInfo.nextCursor`, or `null` for page 1 |

Response:

```json
{
  "items": [ { "id": "...", "title": "...", "company": {"name": "...", "tier": 1},
               "locations": [{"cityCode":"BENGALURU","stateCode":"KARNATAKA","countryCode":"IN"}],
               "workplaceType": "office", "domain": "data",
               "experienceBands": ["threeFive"], "experience": {"minValue":3,"maxValue":5},
               "salary": {"minValue":20,"maxValue":30}, "firstPublishedTime": "2026-07-16T...",
               "competitionBenchmark": {"level":"high"}, "shortlistingStrictness": {"level":"high"},
               "source": "greenhouse", "url": "https://boards.greenhouse.io/..." } ],
  "pageInfo": { "limit": 20, "nextCursor": "eyJpZCI6..." },
  "totalCount": 19195
}
```

Notes:
- `query` at the **top level is ignored** — the keyword must be inside `filters.keyword`.
- Pagination is **cursor-based**: pass `pageInfo.nextCursor` back as `page.cursor`. A top-level `cursor` is ignored.
- `url` is the direct apply/career-page link (Greenhouse, Lever, SmartRecruiters, etc.).

## Detail — `GET /api/jobs/details/{id}`  (public, no auth)

`{id}` is the 24-char hex Mongo id from a search result. Returns `{ "job": { ... } }`
(the CLI unwraps `.job`). Same fields as a search item **plus** `description` (HTML with
entities — the CLI strips tags and decodes entities) and `structuredDescription`.

The detail payload does **not** include `url`/apply link — carry it from the search result.
Invalid id → `400 {"error":"Invalid job id"}`.

## Config — `GET /api/env/config`  (public, reference only)

Returns the authoritative filter taxonomy: `filters` (domains, experienceBands,
jobFreshness, locations with labels), `cityLabels`, `stateLabels`. Useful when the
location/domain code lists above change. The CLI hard-codes the mappings rather than
fetching this per call.

## Other observed endpoints (not used — auth-gated)

`/api/jobs/search`, `/api/auth/*`, `/api/user/*`, `/api/me/*`, `/api/jobs/{id}/bookmark`,
`/api/bookmarks/search`, `/api/linkedin-posts/*`, `/api/featured-linkedin-posts`.
