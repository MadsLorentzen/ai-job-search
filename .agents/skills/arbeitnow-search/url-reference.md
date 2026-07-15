# Arbeitnow Job Board API — URL Reference

Free public API, no key, no registration: https://www.arbeitnow.com/api/job-board-api
(docs: https://documenter.getpostman.com/view/18545278/UVJbJdKh — linked from arbeitnow.com).
The API's own `meta.terms` string: "This is a free public API for jobs, please do not abuse."

Focus: jobs in Germany, strong tech/startup/English-speaking slant, visa-sponsorship
friendly listings.

## Endpoint

```
GET https://www.arbeitnow.com/api/job-board-api?page=N
```

- Returns 100 jobs per page, newest first. `links.next` is null on the last page.
- **Server-side filtering does NOT work** (verified 2026-07): `search`, `q`, `tag`,
  and `remote` parameters are ignored — the response is a shared cached list, and
  `meta.current_page_url` even echoes other clients' query strings. The CLI therefore
  filters **client-side** and fetches multiple pages (`--pages`).

## Response shape

```
{ "data": [ { slug, company_name, title, description (HTML), remote (bool),
              url, tags[], job_types[], location, created_at (unix seconds) } ],
  "links": { first, last, prev, next },
  "meta":  { current_page, per_page: 100, ... } }
```

## Quirks

- `description` is HTML — strip tags for plain output.
- `created_at` is a unix timestamp (seconds).
- No per-job detail endpoint: the full description is already in the list payload,
  so `detail <slug>` scans pages until the slug is found (capped).
- `job_types` is often empty; `tags` carries the useful categorisation.
- Job page URL per job is the `url` field (arbeitnow.com/jobs/companies/...).
