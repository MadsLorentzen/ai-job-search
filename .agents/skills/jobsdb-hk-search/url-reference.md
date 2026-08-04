# Jobsdb Hong Kong URL Reference

## Base URL

```
https://hk.jobsdb.com
```

## Search Endpoint

### URL pattern

```
https://hk.jobsdb.com/{query-slug}-jobs[/in-{location-slug}][?daterange={days}][&page={n}]
```

### Examples

```text
https://hk.jobsdb.com/ai-engineer-jobs
https://hk.jobsdb.com/ai-engineer-jobs/in-Hong-Kong
https://hk.jobsdb.com/ai-engineer-jobs?daterange=7
https://hk.jobsdb.com/ai-engineer-jobs/in-Hong-Kong?daterange=7&page=2
```

### Query parameters

| Parameter | Description | Values |
|-----------|-------------|--------|
| `daterange` | Max posting age in days | `1`, `3`, `7`, `14`, `31` |
| `page` | 1-indexed result page | `1`, `2`, `3`, ... |

### Path segments

- `{query-slug}` — keyword phrase, lower-cased, words joined by hyphens (e.g. `ai-engineer`).
- `in-{location-slug}` — optional location filter. Spaces become hyphens, commas are preserved (e.g. `in-Kowloon-Bay,-Kwun-Tong-District`).

## Detail Endpoint

### URL pattern

```
https://hk.jobsdb.com/job/{id}?type=standard
```

### Example

```text
https://hk.jobsdb.com/job/93714207?type=standard
```

## Job Card Extraction (search results page)

Each result is an `<article>` with `data-testid="job-card"`.

| Field | Anchor | Notes |
|-------|--------|-------|
| `id` | `data-job-id="{id}"` | Numeric ID |
| `title` | `aria-label="..."` on the `<article>`; fallback `data-automation="jobTitle"` | |
| `url` | `data-automation="job-list-view-job-link"` `href` | Relative path; prepend `BASE_URL` |
| `company` | `data-automation="jobCompany"` text | |
| `location` | `data-automation="jobLocation"` text | |
| `date` | Embedded JSON state blob: `"id":"{id}","isFeatured":...,"listingDate":"2026-08-04T03:12:07.000Z"` (one per card, keyed by job id; emitted as `YYYY-MM-DD`). Fallback: first `>Listed ...<` text | Fallback is a relative string with spelled-out numbers, e.g. "Listed forty nine minutes ago" |
| `employmentType` | `>This is a ... job<` text | e.g. "Full time" |

Result pages contain **30** jobs per page.

## Job Detail Extraction (detail page)

| Field | Anchor | Notes |
|-------|--------|-------|
| `title` | `data-automation="job-detail-title"` text | |
| `company` | `data-automation="advertiser-name"` text | |
| `location` | `data-automation="job-detail-location"` text | |
| `employmentType` | `data-automation="job-detail-work-type"` text | e.g. "Full time" |
| `salary` | `data-automation="job-detail-salary"` text | Optional |
| `description` | Inner HTML of `<div data-automation="jobAdDetails">` | Convert block-level closings to newlines |
| `applyUrl` | `href="/job/{id}/apply"` or construct `{BASE_URL}/job/{id}/apply` | |

The detail page carries no posting date — `date` is always `null` for `detail`.

## Access Notes

- No authentication is required for search or detail pages.
- `robots.txt` (as of 2026-08) disallows `*/job/`, `/api/jobsearch/`, `/graphql`, and `*?` (with only `?keywords` and `?advertiserid` exceptions). This skill therefore carries a personal-use-only warning.
- The site is a React/SSR app; the initial HTML contains all job cards on search pages and the full description on detail pages, so no JavaScript execution is required to parse them.
- Keep request volume low to avoid rate limiting or blocks.
