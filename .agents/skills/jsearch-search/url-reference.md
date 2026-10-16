# JSearch API reference (as used by jsearch-search)

Provider: OpenWeb Ninja, sold through RapidAPI. Data: Google for Jobs.

## Authentication

Every request sends two headers:

| Header | Value |
|---|---|
| `X-RapidAPI-Key` | the user's RapidAPI key, from `JSEARCH_API_TOKEN` |
| `X-RapidAPI-Host` | `jsearch.p.rapidapi.com` |

## `GET https://jsearch.p.rapidapi.com/search`

| Parameter | Used as | Notes |
|---|---|---|
| `query` | `"<keywords> in <location>"` | location lives inside the query text |
| `page` | `--page` | 1-indexed |
| `num_pages` | always `1` | each extra page is billed; the CLI pages explicitly instead |
| `date_posted` | from `--jobage` | `all`, `today`, `3days`, `week`, `month` |
| `country` | `--country` | ISO 3166 alpha-2, lowercase |
| `work_from_home` | `--remote` | `true` for remote only |

## `GET https://jsearch.p.rapidapi.com/job-details`

| Parameter | Notes |
|---|---|
| `job_id` | from search; base64, may contain `=` and `/` (URL-encode) |
| `country` | optional, as above |

## Response

`{ "status": "OK", "request_id": "...", "parameters": {...}, "data": [ job, ... ] }`

Fields the CLI reads from each job:

| JSearch field | CLI field |
|---|---|
| `job_id` | `id` |
| `job_title` | `title` |
| `employer_name` | `company` |
| `job_location`, else `job_city`, `job_state`, `job_country` | `location` |
| `job_posted_at_timestamp` (unix s), else `job_posted_at_datetime_utc` | `date`, `postedAt` |
| `job_apply_link` | `url` |
| `job_publisher` | `publisher` |
| `apply_options[] { publisher, apply_link, is_direct }` | `applyOptions[] { publisher, url, isDirect }` |
| `employer_website`, `job_employment_type`, `job_is_remote` | same names, camelCase |
| `job_description`, `job_highlights.Qualifications`, `job_highlights.Responsibilities` | detail only |

## Error statuses

| Status | Body hint | CLI code |
|---|---|---|
| 401 / 403 | "not subscribed" | `NOT_SUBSCRIBED` |
| 401 / 403 | other | `BAD_CREDENTIALS` |
| 429 | mentions "quota" | `QUOTA_EXCEEDED` (no retry) |
| 429 / 5xx | other | retried with backoff, then `REQUEST_FAILED` |
| 404 | - | empty result |

If the provider renames fields, `toResult`/`toDetail` in `cli/src/helpers.ts` are the only
places to update.
