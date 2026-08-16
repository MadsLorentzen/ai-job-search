# CutShort URL & Data Reference

Data sources are CutShort's **public, robots-allowed, unauthenticated** surfaces only.

## robots.txt (relevant excerpt)

`https://cutshort.io/robots.txt` — `User-agent: *`, no AI/Claude bot named. Disallows include:

```
Disallow: /profile/
Disallow: /view/j/
Disallow: /view/c/
Disallow: /apply/
Disallow: /*?job_listing
Disallow: /*?free_text
Sitemap: https://cutshort.io/sitemap_jobs.xml
```

The live in-app search API uses the disallowed `?free_text` / `?job_listing` params and is a
login-gated profile-matching feed — **we never touch it.** The `sitemap_jobs.xml` and the
`/job/<id>` pages are allowed and used instead.

## Search — jobs sitemap

```
GET https://cutshort.io/sitemap_jobs.xml
```

A flat `<urlset>` (~8 MB). Each `<url>` block:

```xml
<url>
  <loc>https://cutshort.io/job/Data-Engineer-Pune-Vikash-Technologies-arcRXEzK</loc>
  <lastmod>2026-07-15T16:42:16.251Z</lastmod>
  <changefreq>weekly</changefreq>
</url>
```

- **Slug format:** `<Title-Words>-<Location-Words>-<Company-Words>-<id>` (variable-length
  segments; not reliably splittable, which is why detail enrichment is used for exact fields).
- **id:** the final hyphen-delimited segment of the `<loc>` path (e.g. `arcRXEzK`).
- **lastmod:** ISO 8601; used for the `--jobage` recency filter (approximate).

Search filters slugs by keyword/location tokens, sorts by `lastmod` desc, pages client-side
(20/page), then enriches the page's rows from their detail pages.

## Detail — public job page

```
GET https://cutshort.io/job/<id>          # bare id works; serves same content as full slug URL
GET https://cutshort.io/job/<full-slug>   # also works
```

Every field lives in the embedded Next.js data blob:

```html
<script id="__NEXT_DATA__" type="application/json">{ ... }</script>
```

Inside it is a schema.org `JobPosting` node (located by recursive `@type === "JobPosting"`):

| Field | Path | Example |
|-------|------|---------|
| title | `title` | `"Data Engineer"` |
| company | `hiringOrganization.name` | `"Vikash Technologies"` |
| location | `jobLocation.address.addressLocality` (+ `addressRegion`) | `"Pune"` |
| date posted | `datePosted` | `"2026-07-15T16:36:40.957Z"` |
| valid through | `validThrough` | `"2026-10-14T11:32:01.510Z"` |
| employment type | `employmentType` (array) | `["FULL_TIME"]` |
| salary | `baseSalary` (`currency`, `value.minValue/maxValue/unitText`) | `INR 1500000–2500000 / YEAR` |
| skills | `skills` (comma-joined string) | `"ELT, ETL, PySpark, ..."` |
| description | `description` (HTML) | rendered to plain text |

## Fetching conventions

- Browser `User-Agent`.
- Exponential backoff + jitter on `429`/`5xx` (max 6 retries); `""` returned on `404`.
- Zero runtime dependencies; sitemap XML and page HTML parsed with regex + `JSON.parse`.
