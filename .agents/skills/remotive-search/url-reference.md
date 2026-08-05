# Remotive API — endpoint reference

Verified live on 2026-08-04.

## Endpoints

| Purpose | Method | URL |
|---------|--------|-----|
| Jobs feed | GET | `https://remotive.com/api/remote-jobs` |
| Categories | GET | `https://remotive.com/api/remote-jobs/categories` |
| Job detail | — | **Does not exist.** The feed carries full descriptions; `detail` selects locally. |

No authentication or API key. Responses are JSON.

## Terms (from the API's own response fields)

The response includes `00-warning` and `0-legal-notice` keys. Summary of the legal
notice as returned on 2026-08-04:

- API access is granted so developers can share Remotive's jobs further.
- Do **not** submit Remotive jobs to third-party sites — Jooble, Neuvoo, Google Jobs, LinkedIn Jobs named explicitly.
- Link back to the Remotive URL **and** credit Remotive as the source, or access is terminated.
- Jobs are **delayed by 24 hours** so Remotive gets attribution first.
- Collecting signups/emails off the listings breaches their ToS.
- Paid private API available; stated starting budget $5k/mo.

The CLI therefore always emits attribution alongside results.

## Search parameters — all ignored

Probed on 2026-08-04. Every request returned the identical full 32-record set:

```
limit=5                          -> jobs=32  total=32
search=python&limit=5            -> jobs=32  total=32
category=software-dev&limit=5    -> jobs=32  total=32
company_name=Automattic&limit=3  -> jobs=32  total=32
```

`category=software-dev` still returned all 11 categories
(`All others, Data and Analytics, Design, Devops, Information Technology,
Marketing, Medical, Product Management, Sales, Software Development, Writing`),
confirming the filter is not applied server-side.

**Consequence:** `helpers.ts` implements every filter client-side, and the CLI
fetches the feed once per invocation. If Remotive restores server-side filtering,
move `--query`/`--category` into the request URL and drop the local pass.

The **categories** endpoint does work and returns slugs:
`software-development, customer-service, design, marketing, sales, product,
project-management, artificial-intelligence, data, devops, finance,
human-resources, …`. Note these slugs do **not** match the human-readable
`category` values on job records (`Software Development` vs `software-development`),
which is why `matchesCategory` normalizes separators before comparing.

## Feed size

`job-count: 32`, `total-job-count: 32`, spanning 2026-07-04 → 2026-08-02. This is
the whole free feed, not a page of it. There is no pagination to exhaust.

## Response structure

```jsonc
{
  "00-warning": "...",
  "0-legal-notice": "...",
  "job-count": 32,
  "total-job-count": 32,
  "jobs": [ /* RawRemotiveJob */ ]
}
```

## Per-result field paths

| Contract field | API path | Notes |
|----------------|----------|-------|
| `id` | `id` | number → stringified |
| `title` | `title` | |
| `company` | `company_name` | **often has a trailing space** — trimmed |
| `location` | `candidate_required_location` | an eligibility **region**, not a city |
| `date` | `publication_date` | **no timezone suffix** — see quirk |
| `url` | `url` | |
| `category` | `category` | human-readable, e.g. `Software Development` |
| `jobType` | `job_type` | `full_time`, `freelance`, `contract`, … |
| `salary` | `salary` | free text, frequently empty or oddly formatted (`"$20k -$35k"`) |
| `tags` | `tags[]` | joined with `", "` |
| `description` | `description` | HTML, present in the **feed** record |

Observed key set: `candidate_required_location, category, company_logo,
company_logo_url, company_name, description, id, job_type, publication_date,
salary, tags, title, url`

## Quirks

- **`publication_date` carries no timezone** (`2026-08-02T20:00:46`). `toIsoDate` appends `Z`; parsing it raw shifts every date by the local UTC offset.
- **`candidate_required_location` is a region.** Values include `Worldwide`, `USA`, `USA, Canada`, `Americas, Europe, Asia`, `USA timezone`. City filtering is impossible; `matchesLocation` special-cases `USA` to also accept the broader regions that include US candidates.
- **No per-job endpoint.** Descriptions ship inside the feed. A job that ages out of the 32-record window becomes unfetchable by id.
- `salary` is unstructured free text and often absent.
- Category slugs from the categories endpoint differ in form from the `category` value on job records.
