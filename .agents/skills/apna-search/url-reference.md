# apna.co — endpoint reference

Portal: `https://apna.co`. Market: India, English + Hindi (bilingual postings).
Investigated 2026-07-07. No authentication, no API key, zero runtime deps.

## Summary: public web pages, slug-based browsing

| Surface | Path | Access | Data location | Usable |
|---------|------|--------|---------------|--------|
| Listing (all / city / category) | `/jobs`, `/jobs/jobs-in-<city>`, `/jobs/<cat>-jobs`, `/jobs/<cat>-jobs-in-<city>` | 200 via browser UA | `__NEXT_DATA__` JSON | **YES** |
| Job detail | `/job/<id>` (bare id 200s; slug segments cosmetic) | 200 via browser UA | `jdp-job-schema` ld+json | **YES** |
| Free-text keyword search | (app / login only) | not public on web | — | no |

apna has **no public free-text keyword search** — the public web is browsed by
*slug* only. This skill bridges that: it resolves `--query` to apna's nearest
job **category** or **department** from apna's own live catalog, fetches that
listing (optionally scoped to a city), then narrows results **client-side** by
keyword (`resolveSlug` + `keywordMatch` in `cli/src/helpers.ts`).

## Listing endpoint (search data source)

```
GET https://apna.co/jobs                                  # all-India bootstrap
GET https://apna.co/jobs/jobs-in-<city>                   # city-scoped
GET https://apna.co/jobs/<category-slug>-jobs             # category, all-India
GET https://apna.co/jobs/<category-slug>-jobs-in-<city>   # category + city
GET  ...?page=<n>                                          # 1-indexed pagination
```

Headers: a browser `User-Agent` is sufficient (`Accept-Language: en,hi` to get
bilingual text). A sparse category+city combo can **404** — the CLI then falls
back to the city-only page and relies on the client-side keyword filter.

The page is server-rendered Next.js. The full job objects live in:

```html
<script id="__NEXT_DATA__" type="application/json">{ ... }</script>
```

Parse with `JSON.parse`, then read `props.pageProps`:

- `props.pageProps.jobs[]` — each has `.data`, the full job object (mapped by `mapJob`).
- `props.pageProps.categoryList[]` — `{ type/name, slug }`; used to resolve queries to a category slug.
- `props.pageProps.departmentList[]` — `{ name }`; departments have **no slug** in the catalog, so the CLI derives `dep_<snake_case_name>`.

### `jobs[].data` field map (JobCard)

| JSON path | Our field | Notes |
|-----------|-----------|-------|
| `id` | `id` | numeric job id (string) |
| `title` (fallback `type`) | `title` | dropped if empty |
| `organization.name` | `company` | |
| `address.area` + `address.city.name` (fallback `location_name`) | `location` | joined `area, city` |
| `created_on` | `date` | ISO; sliced to `YYYY-MM-DD` |
| `public_url` (fallback `/job/<id>`) | `url` | |
| `min_salary` / `max_salary` | `salary` | monthly INR → `₹50,000 - ₹1,15,000/month` (`formatSalary`, `en-IN`) |
| `category` | `category` | |
| `department` (obj `.name` or string) | `department` | |
| `is_part_time` / `is_flexible_job` | `employmentType` | else `Full time` |
| `no_of_openings` | `openings` | integer or null |
| `is_wfh` | `workFromHome` | boolean |

## Detail endpoint (the data source)

```
GET https://apna.co/job/<id>          # bare id resolves; slug segments cosmetic
```

App-Router page embedding a schema.org `JobPosting`:

```html
<script id="jdp-job-schema" type="application/ld+json">{ "@type":"JobPosting", ... }</script>
```

A nonexistent id returns **HTTP 404** (CLI emits `NOT_FOUND`).

### JobPosting field map (JobDetail, `parseJobDetail`)

| JSON-LD path | Our field | Notes |
|--------------|-----------|-------|
| `title` | `title` | |
| `hiringOrganization.name` | `company` | |
| `jobLocation.address.addressLocality` + `addressRegion` | `location` | fallback `streetAddress` |
| `datePosted` | `date` | sliced to `YYYY-MM-DD` |
| `url` | `url` / `applyUrl` | canonical apna job URL |
| `baseSalary.value` (`minValue`/`maxValue`/`unitText`) | `salary` | INR-formatted |
| `employmentType` | `employmentType` | array → comma-joined; `_` → space |
| `industry` | `industry` | |
| `occupationalCategory` | `category` | |
| `validThrough` | `validThrough` | apply-by date |
| `description` | `description` | HTML → stripped to text; entities decoded; **Hindi/English preserved** |

## Query → slug resolution

`resolveSlug(query, categoryList, departmentList)` tokenizes the query (dropping
stopwords: `job(s)`, `in`, `naukri`, `vacancy`, …), scores each catalog
category/department name by token overlap (exact or shared prefix ≥5 chars, so
`telecaller`≈`telecalling`), and returns the highest-scoring slug. No overlap →
`null`, and the caller browses the city-only page filtered client-side by
`keywordMatch`. City tokens: `citySlug("Delhi")` → `delhi` → `jobs-in-delhi`.

## Maintenance notes

- **Search breaks** → apna changed the `__NEXT_DATA__` shape or `pageProps` keys.
  Re-fetch `/jobs/jobs-in-delhi`, dump `props.pageProps`, and re-map in
  `mapJob` / the `categoryList`/`departmentList` reads.
- **Detail breaks** → the `jdp-job-schema` ld+json shape changed. Re-fetch a
  `/job/<id>` page, dump the `JobPosting` block, re-map `parseJobDetail`.
- If apna ever exposes a public keyword-search endpoint, implement it in
  `search.ts` against the existing contract (`--query`, `--location`, `--jobage`,
  `--page`, `--limit`, `--format`) and retire the slug-resolution bridge.
</content>
</invoke>
