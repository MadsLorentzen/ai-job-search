# Free-Work URL & API Reference

Endpoint documentation for `free-work-search`, recorded during the `/add-portal`
investigation on 2026-07-26. This is the file to update if Free-Work changes its
API shape.

## Hosts

| Host | Role |
|---|---|
| `https://www.free-work.com` | Public site (Nuxt 3 SPA). Human-facing posting URLs. |
| `https://api.free-work.com` | JSON API (Symfony / API Platform). What this CLI calls. |

The site is a Nuxt app whose `__NUXT_DATA__` payload is devalue-flattened and
awkward to parse. The API behind it answers unauthenticated GETs directly, so
the CLI skips the HTML entirely.

## Access rules

`https://www.free-work.com/robots.txt` (200, checked 2026-07-26):

```
User-agent: *
Disallow: /login
Disallow: /logout
Disallow: /fw-deals
```

Job paths are permitted for the general user-agent. Named crawlers (Yandex,
Baidu, HTTrack, Wget, MJ12bot, ia_archiver, …) are blocked individually. There
is no authentication wall and no Cloudflare challenge on the job paths.

> Contrast with Malt (`malt.fr`), evaluated and rejected for this repo: every
> path including `robots.txt` sits behind a Cloudflare managed challenge and
> returns 403 to non-browser clients, and Malt publishes no public API.

## Search

```
GET https://api.free-work.com/job_postings
Accept: application/json
```

Returns a **bare JSON array** of posting objects. Not a Hydra collection — there
is no `hydra:member` wrapper and **no total-count field or header**, so
`meta.count` in the CLI output is the number of results on the current page
after filtering, not the size of the full result set.

### Parameters

| Parameter | Works | Notes |
|---|---|---|
| `searchKeywords=<text>` | ✅ | The keyword filter. Free-text over title and description. |
| `query=<text>` | ❌ | **Silently ignored.** The site's own front-end sends this; the API returns unfiltered results. Verified: `query=backend` returned the same rows as no filter at all. |
| `search=<text>` | ❌ | Silently ignored. |
| `contracts=<value>` | ✅ | Scalar only. Comma-separate for OR: `contractor,permanent`. |
| `contracts[]=<value>` | ❌ | Errors: `Input value "contracts" contains a non-scalar value.` |
| `contract=<value>` | ❌ | Singular form silently ignored. |
| `locationKeys=<key>` | ✅ | See "Location keys" below. |
| `locations=` / `locationKey=` / `regions=` / `adminLevel1=` | ❌ | All silently ignored. |
| `page=<n>` | ✅ | 1-indexed. |
| `itemsPerPage=<n>` | ✅ | Honoured up to at least 100. The CLI uses 50. |
| `order=date` | ✅ | Newest first by `publishedAt`. |
| `order[publishedAt]=desc` | ❌ | Errors: non-scalar value. |
| `publishedSince=` / `sinceDate=` / `publishedAt[after]=` | ❌ | All silently ignored — **there is no server-side date filter.** `--jobage` is applied client-side. |

**The silent-ignore behaviour is the main hazard on this API.** An unsupported
filter does not error; it returns a full, plausible-looking result set. Any new
parameter must be verified by comparing *content* against an unfiltered call,
not by checking that the request succeeded or that the row count changed.

### Location keys

Format: `country~adminLevel1~adminLevel2~locality`, lowercase and
diacritic-stripped. Trailing empty segments widen the match.

| Key | Matches |
|---|---|
| `fr~ile-de-france~~` | All of Île-de-France |
| `fr~auvergne-rhone-alpes~haute-savoie~annecy` | Annecy specifically |
| `ch~zurich~district-de-zurich~zurich` | Zurich (the board is not France-only) |

Every search result carries its own `location.key`, so the reliable way to get
an exact department or city key is to copy it from a result. `buildLocationKey()`
in `helpers.ts` slugifies a friendly name to the region-level form and passes
any string containing `~` through verbatim.

## Detail

```
GET https://api.free-work.com/job_postings/{slug}
```

**Keyed by slug, not by id.** `/job_postings/656630` returns 404;
`/job_postings/sap-project-manager-s-4hana-release-upgrade` returns 200. There
is no known id → slug lookup, so `detail` requires the slug (or a posting URL to
extract it from).

Returns a single posting object with the same shape as a search result.

## Public posting URL

```
https://www.free-work.com/fr/tech-it/job-mission/{job.slug}/{slug}
```

where `job.slug` is the **category** slug (e.g. `developpeur-java-kotlin-groovy-scala`)
and `slug` is the posting's own. The reversed form
`/fr/tech-it/{job.slug}/job-mission/{slug}` 301-redirects to the canonical order
above; the CLI emits the canonical form. If the category is missing, the CLI
degrades to a site-search URL rather than emitting a link that would 404.

## Response fields

Fields consumed by the CLI, from a live posting:

| Field | Type | Notes |
|---|---|---|
| `id` | number | Stable identifier. **Not** usable against the detail endpoint. |
| `slug` | string | Detail key and URL component. |
| `title` | string | |
| `description` | string (HTML) | `<p>`, `<ul>`/`<li>`, heavy `<br />` padding, HTML entities (`&#43;`, `&#039;`), and ` `. `htmlToText()` normalizes all of it. |
| `contracts` | string[] | `contractor` \| `permanent` \| `fixed-term` \| `apprenticeship` \| `internship`. A posting can hold several. |
| `minDailySalary` / `maxDailySalary` | number \| null | **TJM.** Present on roughly half of postings. |
| `minAnnualSalary` / `maxAnnualSalary` | number \| null | |
| `currency` | string \| null | Observed: `EUR`, `GBP`. |
| `durationValue` / `durationPeriod` | number / string \| null | Period: `day` \| `month` \| `year`. |
| `renewable` | boolean \| null | |
| `remoteMode` | string \| null | `full` \| `partial` \| `none`. Frequently null. |
| `experienceLevel` | string \| null | `junior` \| `intermediate` \| `senior` \| `expert`. |
| `location` | object \| null | `{ locality, adminLevel1, adminLevel2, country, countryCode, label, shortLabel, key, latitude, longitude }`. |
| `company` | object \| null | `{ id, name, slug, description, logo, external }`. |
| `job` | object \| null | Job **category**: `{ id, name, shortName, slug, nameForUserSlug }`. |
| `publishedAt` / `createdAt` / `updatedAt` / `expiredAt` | ISO 8601 string | `publishedAt` is the date the CLI reports. |
| `applicationUrl` | string \| null | External apply link when `applicationType` is `url`. |
| `status` / `published` | string / boolean | Only `published` observed on the public endpoint. |
| `external` / `externalSource` | boolean / string \| null | Marks postings syndicated from elsewhere. |

## Field-vocabulary sample

From 100 postings (`itemsPerPage=100&order=date`, 2026-07-26):

- `contracts`: contractor 77, permanent 60, fixed-term 12, apprenticeship 1
- `remoteMode`: partial 41, null 38, none 19, full 2
- `experienceLevel`: senior 35, null 31, intermediate 17, junior 10, expert 7
- `durationPeriod`: null 43, month 40, year 15, day 2
- `currency`: EUR 62, null 21, GBP 17
- Postings with a TJM: 49 / 100
