# Randstad India Jobs URL Reference

Public, unauthenticated job board at https://www.randstad.in/jobs/. The site is a
**Next.js** app; the search-results page server-renders its job list inside an RSC
(React Server Components) stream. There is no separate JSON API — the CLI parses
the RSC payload embedded in the HTML.

This file is what a future maintainer needs when Randstad changes its markup.

## Search

```
GET https://www.randstad.in/jobs/q-<query>/ci-<city-slug>/
```

The search is expressed as **path segments**, not query-string params:

| Segment | Meaning | Example |
|---------|---------|---------|
| `q-<query>` | URL-encoded free-text keywords | `q-project%20manager` |
| `ci-<city-slug>` | Lower-cased, hyphenated city | `ci-pune`, `ci-bengaluru`, `ci-navi-mumbai` |

Either segment may be omitted (the CLI requires at least one). Examples:
- `/jobs/q-data%20engineer/ci-bengaluru/`
- `/jobs/ci-hyderabad/` (location only)
- `/jobs/q-accountant/` (keyword only)

**Not used (robots.txt-disallowed):** date filters `/jobs/?d=` and
`/jobs/*/?d=`, plus the `km-`, `postcode-`, `sh-`, `sd-`, `sw-`, `sm-`, `sa-`,
`l-`, `h-`, `jt-*` filter prefixes. `--jobage` is therefore applied client-side
against each result's `postingTime`.

### Response structure

The results page HTML contains an RSC stream. The stream escapes its JSON with
`\"`; after un-escaping, the job list lives at:

```
"results":[{"languageCode":...}, {"languageCode":...}, ...]
```

The CLI anchors on `"results":[{"languageCode"`, then splits the region on the
`{"languageCode":` object marker so each job is parsed independently (one
malformed card cannot break the rest). Per-job fields:

| Field | Location in chunk | Notes |
|-------|-------------------|-------|
| `url` | `"postedUrl":[{"href":"<url>"` | Full detail URL; query string stripped |
| `id` | UUID tail of `url` | `_<8-4-4-4-12>/` at the end of the path |
| `title` | `"jobTitle":"<text>"` | |
| `company` | `"clientDetail":{…"name":"<text>"` | Often `"A client of Randstad India"` |
| `location` | `"locality":"<x>"` + `"administrativeArea":"<y>"` | Joined as `"<locality>, <area>"`, title-cased |
| `date` | `"postingTime":"<iso>"` | ISO timestamp; `--jobage` filters on it |
| `employmentType` | `"jobTypes":["<type>"` | e.g. `Permanent`, `Temporary` |

## Detail

```
GET https://www.randstad.in/jobs/<slug>_<city>_<uuid>/
```

Detail pages are keyed by `slug + city + UUID`. The slug cannot be reconstructed
from a bare UUID, so `detail` takes the full job **URL** from a search result's
`url` field (absolute `https://…randstad.in/jobs/…` or a `/jobs/…` path).

The page is another RSC stream. Header fields (`jobTitle`, `clientDetail.name`,
`locality`/`administrativeArea`, `postingTime`, `jobTypes`, `displayId`) are read
the same way as search cards. The **rich description** is a lazily-referenced RSC
row:

```
"description":{"description":"$<ref>"      ← pointer
\n<ref>:T<hexlen>,<html>…                   ← the referenced row holding the HTML
```

The CLI resolves `<ref>`, slices the row up to the next RSC row boundary
(`\n<hex>:` or the closing `"])</script>`), converts `<br>`/`</p>`/`</li>` etc. to
newlines, strips remaining tags, and decodes unicode + HTML entities. If the
reference is missing it falls back to `"shortDescription":"…"`.

## Notes

- No authentication required.
- `robots.txt` `Allow: /` broadly; the `q-`/`ci-` search paths and
  `/jobs/<slug>_<uuid>/` detail pages used here are permitted. Only specific
  filter prefixes, `/jobs/?d=`, and `/job-redirect/` are disallowed.
- Randstad is a staffing agency, so `company` is frequently masked as
  `"A client of Randstad India"`.
- Only page-1 results (~30 jobs) are server-rendered into the RSC payload; there
  is no reliable server-side pagination via these path URLs, so `--page` does not
  fetch further pages.
- The CLI retries 429/5xx with exponential backoff + jitter and returns `""` on a
  404 (treated as "not found").
