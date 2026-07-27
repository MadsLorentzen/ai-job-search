# Next Mondays URL Reference

Public, unauthenticated pages on `https://nextmondays.com` used by this skill.
Recorded 2026-07-27. This is the file to update when the portal changes its markup.

## robots.txt

```
User-Agent: *
Disallow: /Search
Disallow: /jobs/ApplyForJobWithLinkedIn/
Sitemap: https://nextmondays.com/sitemap.xml
```

The site's own keyword-search endpoint (`/Search?...`) is **disallowed** and this CLI never
requests it. Every path below is allowed. Keyword filtering is done client-side instead.

## Listing pages

All three render the same card markup (`<div class="section-offers-list-item">` per mission),
with no pagination — the full matching set is in one response.

| Path | Filtering | Notes |
|------|-----------|-------|
| `GET /jobs/regions/<region>` | **None — returns the entire board** | The region facet is applied by the site's client-side JS, not the server. All five region pages returned an identical 79-card set. The CLI uses `/jobs/regions/%c3%8ele-de-france` as its "all missions" surface. |
| `GET /jobs/groups/<group>` | Server-side, by job domain | 6 groups (see below); union = 77 of the 79 cards. |
| `GET /jobs/tags/<tag>` | Server-side, by exact tag | e.g. `/jobs/tags/typescript` → 11 cards. Tag values are URL-encoded lowercase strings. |

Region slugs (from `sitemap-jobs-regions.xml`, URL-encoded lowercase):
`auvergne-rhône-alpes`, `bourgogne-franche-comté`, `île-de-france`, `nouvelle-aquitaine`,
`pays de la loire`.

Group slugs (from `sitemap-jobs-groups.xml`):
`electronique`, `infra & ops`, `logiciel embarqué`, `management`, `test & qa`, `web & edition`.

### Card field anchors

Each card chunk is parsed independently, so one malformed card cannot break the page.

| Field | Anchor |
|-------|--------|
| id + url | `href="/jobs/<slug>/<ID>"` — IDs look like `03P712386` (mixed case, case-insensitive on lookup) |
| title | `<h5 class="job-title">` |
| subtitle | `<h6 class="job-subtitle">` (usually empty) |
| client blurb | `<p class="job-description">` — the **anonymised** client description, not a company name |
| tags | `<a class="tag-item" href="/jobs/tags/...">` |
| daily rate | `<span class="job-pricing">680.00 &#x20AC;/ j</span>` |
| domain | `<div class="job-group-icon icon-webandedition">` → mapped to a group name |
| filled | presence of `job-is-filled-container` ("offre pourvue") |

**Not on cards:** location and posting date. Both require a detail fetch.

## Detail page

```
GET /jobs/<id>
```

The slug segment is decorative — `/jobs/03P712386`, `/jobs/anything/03P712386`, and the
lowercase `/jobs/analytic-engineer/03p711928` all return the same page.

Two parallel sources on the page:

**1. `<script type="application/ld+json">` — schema.org `JobPosting`.** Gives `title`,
`description`, `identifier.value` (the reference), `datePosted` (ISO date),
`employmentType` (always `CONTRACTOR`), `jobLocation.address.addressLocality` /
`addressRegion`, and `baseSalary.value.value` + `currency`.

> ⚠️ Upstream bug: `jobLocation.address.addressCountry` is `"Afghanistan"` on every
> mission. Ignore it — the CLI uses the page's own `localisation` value.

**2. HTML sections** (preferred where both exist, since the JSON-LD description is
double-encoded):

| Field | Anchor |
|-------|--------|
| title / subtitle | `<div class="wrapper-job-title">` → `<h1>` / `<h2>` |
| location | `class="summary-location"` → `.summary-content-item-body > span` |
| duration | `class="summary-duration"` (e.g. "6 mois (renouvelable)") |
| domain | `class="summary-activity"` |
| daily rate | `class="summary-salary"` |
| mission / client / profile | `<div class="job-info-group">` blocks keyed by their `<h3>`: `mission`, `entreprise`, `profil` |
| key points | `class="key-point-group-body"` → `<ul><li>` |
| tags | `<a class="tag-item">` |
| recruiter | `class="wrapper-author-name"` + `href="mailto:..."` |

### Encoding quirk

Mission bodies are **double-encoded**: the stored text contains literal `&lt;br /&gt;`
which decodes to a `<br />` tag rather than a line break. `cleanBlock()` therefore decodes
entities first, then converts the resulting `<br>` tags to newlines, then strips leftovers.
Losing that second pass leaves visible `<br />` in descriptions.

## Sitemaps

```
GET /sitemap.xml              → index
GET /sitemap-pages.xml        → static pages
GET /sitemap-jobs.xml         → 50 mission URLs (a subset — the region page has more)
GET /sitemap-jobs-regions.xml → the 5 region listing pages
GET /sitemap-jobs-groups.xml  → the 6 group listing pages
```

`sitemap-jobs.xml` is not authoritative for the full board; the CLI does not use it.

## Observed scale (2026-07-27)

- 79 cards on the board, ~50 open and ~29 marked `offre pourvue`
- Published TJM range 250–900 EUR/day
- Posting dates on open missions span ~6 months back
