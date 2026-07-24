# Welcome to the Jungle — endpoint and parsing reference

Everything the CLI depends on, so a future maintainer can repair it when the site
changes. Verified live on 2026-07-24.

## Access rules (read this before changing anything)

`https://www.welcometothejungle.com/robots.txt`:

```
User-agent : *
disallow: /me/*
disallow: /settings/*
disallow: /users/*
disallow: */jobs?query=*
Disallow: /*?
Allow: /*.css$
Allow: /*.js$
Sitemap: https://www.welcometothejungle.com/sitemaps/index.xml.gz
```

- **`Disallow: /*?` puts every query-string URL off-limits**, which includes the
  site's own search page (`/fr/jobs?query=…`). The CLI never fetches it.
- **Job detail pages carry no query string** (`/fr/companies/<org>/jobs/<slug>`)
  and are on the allowed side.
- Search goes to `*.algolia.net`, a different host that this robots.txt does not
  govern. That is the deliberate, user-approved trade-off recorded in SKILL.md's
  "Personal use only" section — keep volume low; this is not an invitation to crawl.

The site's search UI is a Next.js client-side app: fetching `/fr/jobs` returns a
~550KB shell with **zero job data** and no `__NEXT_DATA__`, so HTML scraping of
search results is not an option even setting robots.txt aside.

## AWS WAF

Job pages sit behind AWS WAF. A request it dislikes gets **HTTP 202 with a
JavaScript challenge** (body contains `gokuProps` / `awsWafCookieDomainList`, or
is empty) instead of the document; a non-browser User-Agent gets a **403**. A CLI
cannot solve the challenge.

Observed behaviour (2026-07-24):

| Endpoint | User-Agent | Result |
|---|---|---|
| `/api/env` | honest (`wttj-search-skill/1.0`), `Accept: */*` | 200 |
| `/api/env` | Chrome UA + `Accept: text/html,…` | 202 challenge |
| job page | honest skill UA | 403 |
| job page | Chrome UA | 200 — until throttled, then 202 |
| `*.algolia.net` | anything, with the right Referer | 200 — **not WAF-guarded** |

So the CLI identifies honestly to `/api/env` and sends a browser UA to job pages,
and `helpers.ts` raises a typed `WafChallengeError` (`code: "WAF_CHALLENGE"`)
rather than a confusing parse error. **Throttling is per-client and clears on its
own** — retrying in a tight loop is what earns it in the first place.

Because search is unaffected, `detail` falls back to a search-index lookup when a
page is blocked (`"source": "index"` in the output, `description: null`).

## 1. Credential discovery — `GET https://www.welcometothejungle.com/api/env`

Returns JavaScript, not JSON:

```js
window.env = {"PUBLIC_ALGOLIA_API_KEY_CLIENT":"4bd8f6215d0cc52b26430765769e65a0",
"PUBLIC_ALGOLIA_APPLICATION_ID":"CSEKHVMS53","PUBLIC_ALGOLIA_ARTICLES_INDEX":"wk_cms_articles_production",
"PUBLIC_ALGOLIA_ORGANIZATIONS_INDEX":"wk_cms_organizations_production", …}
```

`parseCredentials()` slices from the first `{` to the last `}` and JSON-parses it,
falling back to a per-key regex if that fails. The front-end reads the same object
(`getEnvOrThrow("PUBLIC_ALGOLIA_APPLICATION_ID")` in the Next.js chunks, which
poll for `window.env`).

**The jobs index is not named in the payload** — only the articles and
organizations ones are — so it is the constant `wk_cms_jobs_production`.

Env overrides for when this moves: `WTTJ_ALGOLIA_API_KEY`, `WTTJ_ALGOLIA_APP_ID`,
`WTTJ_ALGOLIA_INDEX`.

## 2. Search — `POST https://CSEKHVMS53-dsn.algolia.net/1/indexes/wk_cms_jobs_production/query`

Headers: `X-Algolia-Application-Id`, `X-Algolia-API-Key`, `Content-Type: application/json`,
**`Referer: https://www.welcometothejungle.com/`** — the key is referer-restricted;
without it Algolia answers `403 "Method not allowed with this referer"`.

Body:

```json
{
  "query": "data engineer",
  "facetFilters": [["offices.city:Paris"], ["contract_type:FULL_TIME"]],
  "offset": 0,
  "length": 160,
  "attributesToHighlight": [],
  "attributesToSnippet": []
}
```

- `facetFilters`: outer array ANDs, inner arrays OR.
- `offset`/`length` rather than `page`/`hitsPerPage`, so over-fetching for dedup
  does not make `--page` skip postings. `length` max 1000.
- `attributesToHighlight/Snippet: []` drops `_highlightResult` / `_snippetResult`,
  which otherwise dominate the response size.

### Date-sorted replica

`wk_cms_jobs_production_published_at_desc` exists and is the same corpus ordered
newest-first. `--jobage` and `--sort date` query it, which makes the recency
filter exact. (Station F's careers index has **no** such replica — see
`../stationf-search/url-reference.md`.)

### Corpus (2026-07-24)

94,656 records. `office.country`: France 88,404, Spain 966, UK 885, US 723,
Germany 554. `offices.state`: Ile-de-France 37,457, Auvergne-Rhone-Alpes 10,021,
Nouvelle-Aquitaine 6,274, Provence-Alpes-Cote d'Azur 5,781, Occitanie 5,573,
Hauts-de-France 4,707. `contract_type`: FULL_TIME 69,785, TEMPORARY 12,639,
INTERNSHIP 6,838, APPRENTICESHIP 3,404, FREELANCE 837, OTHER 662. `remote`:
unknown 39,226, no 20,410, partial 19,158, punctual 14,120, fulltime 1,742.
`language`: fr 85,017, en 8,726.

**Region spellings are unaccented and hyphenated** (`Ile-de-France`,
`Provence-Alpes-Cote d'Azur`); **city names keep their accents**.

### Duplicates

One record per job **per website** it is syndicated to — a single `reference` was
observed on 16 records. `dedupe()` keeps the first per `reference`. `nbHits`
therefore overstates the number of distinct jobs; the CLI reports it as
`meta.total` and says so in SKILL.md.

### Record fields the CLI reads

| Field | Notes |
|---|---|
| `slug` | job slug — second half of the CLI `id` |
| `name` | job title |
| `organization.slug` / `.name` | company — first half of the CLI `id` |
| `reference` | stable job reference, used for dedup |
| `published_at` | ISO 8601 **with a local offset** (`…+02:00`) — compare with `Date.parse`, never as a string |
| `contract_type` / `contract_type_names.fr` | `FULL_TIME` → `CDI`, `TEMPORARY` → `CDD / Temporaire`, `INTERNSHIP` → `Stage`, `APPRENTICESHIP` → `Alternance`, `FREELANCE`, `OTHER` |
| `remote` | `no`, `partial`, `punctual`, `fulltime`, `unknown` |
| `office` / `offices[]` | `{city, district, state, country, country_code}` |
| `department` | `Business`, `Tech`, `Sales`, `Opérations`, `Marketing`, `Retail`, … |
| `profile` | requirements text ("profil recherché"); the `detail` fallback uses it |
| `salary_*` | `minimum`, `maximum`, `currency`, `period`, `yearly_minimum` |
| `experience_level_minimum` | years, may be fractional |
| `education_level` | `NO_DIPLOMA`, `BAC`, `BAC_2`…`BAC_5`, `PHD` |
| `sectors_name.fr.*` / `profession_name.fr.*` | nested facet vocabularies, reachable via `--facet` |

**`slug` is neither filterable nor searchable** — querying a slug string returns 0
hits. The `detail` fallback therefore lists the company's records
(`organization.slug` *is* facetable, `length: 500`, trimmed with
`attributesToRetrieve`) and matches the slug client-side.

## 3. Detail — `GET https://www.welcometothejungle.com/fr/companies/<org-slug>/jobs/<job-slug>`

Server-rendered. The CLI reads the **schema.org `JobPosting`** from an
`application/ld+json` block rather than the visual markup. The page emits two
ld+json blocks (`JobPosting` and `FAQPage`) — parse each independently.

Fields used: `title`, `description` (HTML), `qualifications`,
`educationRequirements`, `experienceRequirements`, `employmentType`
(`"FULL_TIME"`), `datePosted`, `validThrough`, `baseSalary` (object or null),
`hiringOrganization.name`, `jobLocation[].address`.

`remote` and `department` are absent from the ld+json, so `detail` leaves them
`null` on the `"page"` path — they come from `search` (or from the `"index"`
fallback, which has them).

**Shared parsing quirk with Station F:** these ld+json blocks can contain raw,
unescaped control characters inside string values, which is invalid JSON.
`escapeControlCharsInStrings()` escapes only the ones inside string literals
(tracking string state) and the parse is retried. Do not escape newlines globally
— that corrupts pretty-printed JSON.

## Failure modes to check first

| Symptom | Likely cause |
|---|---|
| `WAF_CHALLENGE` | anti-bot throttling — wait, do not retry in a loop |
| `could not read the Algolia search key` | `/api/env` payload changed, or the env request itself got challenged |
| `Method not allowed with this referer` | Referer header dropped, or the allowlist changed |
| `Invalid Application-ID or API key` | key rotated and a stale `WTTJ_ALGOLIA_API_KEY` is set |
| `Index … does not exist` | jobs index renamed (it is not published in `/api/env`) |
| search works, `detail` always `"source": "index"` | the WAF is blocking every page fetch |
| every result has `company: null` | record shape moved — check `organization.name` |
| results repeat the same job | `dedupe()` broke, or `reference` was renamed |
