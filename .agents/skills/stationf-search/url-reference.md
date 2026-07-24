# STATION F job board — endpoint and parsing reference

Everything the CLI depends on, so that a future maintainer can repair it when the
board changes. Verified live on 2026-07-24.

## Access rules

- `https://jobs.stationf.co/robots.txt` → `User-agent: *` / `Allow: /`. No path is
  disallowed, including `/search` and the job pages.
- No login, cookie, or API key of our own. The Algolia credentials the CLI uses
  are the ones the board page publishes to its own browser JavaScript.
- The board is operated by **Welcomekit** (Welcome to the Jungle's ATS). Its
  records share a schema with the main WTTJ index — see `../wttj-search/url-reference.md`.

## 1. Credential discovery — `GET https://jobs.stationf.co/search`

The search page carries three things the CLI needs:

```html
<script>
  window.legacyEnv = {
    candidatesFormLoaderRootUrl: "https://www.welcomekit.co",
    algoliaAppId: "CSEKHVMS53",
    algoliaIndexSuffix: "production_careers"
  }
</script>
...
<input type="hidden" name="algolia_api_key" id="algolia_api_key" value="<base64 secured key>" autocomplete="off" />
```

| Value | Where | Parsed by |
|---|---|---|
| Application id | `algoliaAppId:` in `window.legacyEnv` | `parseCredentials()` in `cli/src/helpers.ts` |
| Index suffix | `algoliaIndexSuffix:` in `window.legacyEnv` | same |
| Search key | `value=` of the `<input id="algolia_api_key">` tag | same |

Index name = `wk_cms_jobs_` + suffix → **`wk_cms_jobs_production_careers`**.

The key is an Algolia **secured search key**: base64-decoding it reveals
`filters=website.reference%3Astation-f-job-board`, so the key itself scopes every
query to this board. It cannot be widened to the whole Welcomekit corpus, and it
is search-only.

**Note:** these values are NOT on the board homepage (`/`) — only on `/search`.
Env overrides exist for when this markup moves: `STATIONF_ALGOLIA_API_KEY`,
`STATIONF_ALGOLIA_APP_ID`, `STATIONF_ALGOLIA_INDEX_SUFFIX`.

## 2. Search — `POST https://CSEKHVMS53-dsn.algolia.net/1/indexes/wk_cms_jobs_production_careers/query`

Headers: `X-Algolia-Application-Id`, `X-Algolia-API-Key`, `Content-Type: application/json`,
`Referer: https://jobs.stationf.co/` (the key is referer-restricted server-side),
browser `User-Agent`.

Body:

```json
{
  "query": "data engineer",
  "facetFilters": [["offices.city:Paris"], ["contract_type:FULL_TIME"]],
  "offset": 0,
  "length": 100,
  "attributesToHighlight": [],
  "attributesToSnippet": []
}
```

- `facetFilters`: outer array ANDs, inner arrays OR.
- `offset`/`length` (rather than `page`/`hitsPerPage`) so over-fetching for
  client-side date filtering does not make `--page` skip postings. `length` is
  capped at 1000 by Algolia.
- `attributesToHighlight/Snippet: []` strips the `_highlightResult` /
  `_snippetResult` blocks, which otherwise double the response size.

Response: `{ hits: [...], nbHits, nbPages, page }`. Errors come back as
`{ message, status }` with a 4xx — `"Method not allowed with this referer"` means
the Referer header is missing or wrong.

### Corpus size (2026-07-24)

651 postings total. Filtering by `contract_type`: `FULL_TIME` 391, `INTERNSHIP`
174, `APPRENTICESHIP` 54, `FREELANCE` 16, `TEMPORARY` 14, `OTHER` 1.

### Record fields the CLI reads

| Field | Notes |
|---|---|
| `slug` | job slug — second half of the CLI `id` |
| `name` | job title |
| `organization.slug` / `.name` | company — first half of the CLI `id` |
| `reference` | stable job reference, used for dedup |
| `published_at` | ISO 8601 with offset; the `date` field |
| `contract_type` | `FULL_TIME`, `TEMPORARY`, `INTERNSHIP`, `APPRENTICESHIP`, `FREELANCE`, `OTHER` |
| `contract_type_names.fr` | `CDI`, `CDD / Temporaire`, `Stage`, `Alternance`, `Freelance`, `Autres` |
| `remote` | `no`, `partial`, `punctual`, `fulltime`, `unknown` |
| `office` / `offices[]` | `{city, district, state, country, country_code}` |
| `department` | `Tech`, `Business`, `Sales`, `Marketing`, `Opérations`, … |
| `salary_minimum` / `_maximum` / `_currency` / `_period` | only when the employer published one |
| `experience_level_minimum` | years, may be fractional (`0.5`) |
| `education_level` | `NO_DIPLOMA`, `BAC`, `BAC_2`, `BAC_3`, `BAC_4`, `BAC_5`, `PHD` |
| `language` | posting language: `fr`, `en`, `es`, `de`, `it`, `nl` |

Filterable attributes seen in the index (`facets: ["*"]`): `offices.city`,
`offices.state`, `offices.country_code`, `office.district`, `contract_type`,
`remote`, `department`, `organization.slug`, `organization.labels`, `language`,
`education_level`, `experience_level_minimum`, `sectors_name.fr.*`,
`profession_name.fr.*`, `website.reference`, `salary_yearly_minimum`.

### No date-sorted replica

`wk_cms_jobs_production_careers_published_at_desc` **does not exist** (the main
WTTJ index has an equivalent replica; this one does not). That is why `--jobage`
and `--sort date` are client-side here: the CLI widens `length` to ≥100 and
filters/sorts the window. If the board ever gains a replica, wire it in and drop
the widening.

## 3. Detail — `GET https://jobs.stationf.co/companies/<org-slug>/jobs/<job-slug>`

Fully server-rendered. The CLI reads the **schema.org `JobPosting`** in an
`application/ld+json` script block rather than the visual markup — far more stable
than class names.

Fields used: `title`, `description` (HTML), `qualifications`,
`educationRequirements`, `experienceRequirements`, `employmentType`, `datePosted`,
`validThrough`, `baseSalary`, `hiringOrganization.name`, `jobLocation[].address`.

**Parsing quirk:** the ld+json block contains **raw, unescaped newlines inside
string values**, which is invalid JSON and makes `JSON.parse` throw.
`escapeControlCharsInStrings()` in `helpers.ts` escapes control characters that
sit inside string literals (tracking string state, so newlines *between* tokens
are untouched) and the parse is retried. Do not "fix" this by escaping newlines
globally — that corrupts pretty-printed JSON.

**Shape differences vs WTTJ:** here `employmentType` is the human label
(`"Full-Time"`) and `baseSalary` is a bare string (`"60000"`); on WTTJ they are
`"FULL_TIME"` and an object/`null`. `contractFromLd()` and `salaryFromLd()` accept
both.

`remote` and `department` are not in the ld+json, so `detail` leaves them `null` —
they come from `search`.

## Failure modes to check first

| Symptom | Likely cause |
|---|---|
| `could not read the Algolia search key` | `/search` markup changed — re-find the hidden input / `legacyEnv` |
| `Method not allowed with this referer` | Referer header dropped, or the key's referer allowlist changed |
| `Invalid Application-ID or API key` | key rotated and the cached/env value is stale |
| `Index … does not exist` | index suffix changed (check `algoliaIndexSuffix`) |
| search works, `detail` returns `PARSE_FAILED` | the job page dropped or renamed its ld+json block |
| every result has `company: null` | record shape moved — check `organization.name` |
