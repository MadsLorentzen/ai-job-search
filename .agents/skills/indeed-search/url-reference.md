# Indeed via Apify: reference

## Run endpoint (Apify)

`POST https://api.apify.com/v2/acts/misceres~indeed-scraper/run-sync-get-dataset-items?timeout=280&maxTotalChargeUsd=<cap>`

- Header `Authorization: Bearer <APIFY_API_TOKEN>`, body = actor input JSON.
- Waits for the run and returns the dataset items as a JSON array.
- `maxTotalChargeUsd` is Apify's per-run spend cap for pay-per-event actors.

| Status | CLI code |
|---|---|
| 401 / 403 | `BAD_CREDENTIALS` |
| 402, or a body about usage/credit | `QUOTA_EXCEEDED` (no retry) |
| 408 (run longer than `timeout`) | `TIMEOUT` |
| 429 / 5xx | retried with backoff (3x), then `REQUEST_FAILED` |

## Actor input (misceres/indeed-scraper, schema checked 2026-10-15)

| Field | Used as |
|---|---|
| `startUrls` | `[{ "url": "https://ie.indeed.com/jobs?q=title:\"<q>\"&l=<loc>&fromage=<days>" }]`, one per query (`q=<q>` with `--broad`) |
| `maxItemsPerSearch` | `--limit` |
| `parseCompanyDetails` | `false` |
| `saveOnlyUniqueItems` | `true` |

Also accepted but unused: `position`, `location`, `country`. Start URLs are used instead,
because they carry Indeed's own `fromage` date filter (fixed in the actor on 2026-09-22).

## Actor output item

| Actor field | CLI field |
|---|---|
| `id` | `id` |
| `positionName` | `title` |
| `company`, `location`, `salary`, `description` | same |
| `jobType` (array) | `jobType` (joined) |
| `url` | `url` |
| `externalApplyLink` | `applyUrl` |
| `postingDateParsed` (ISO), else `postedAt` ("3 days ago") + `scrapedAt` | `date` |
| `isExpired` | expired items dropped |
| `{ "error": "FOUND_NO_RESULTS" }` | dropped |

If the actor renames fields, `toResult` and `postedDate` in `cli/src/helpers.ts` are the
only places to update.
