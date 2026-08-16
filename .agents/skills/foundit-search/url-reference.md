# Foundit (Monster India) — endpoint reference

Portal: `https://www.foundit.in` (formerly Monster India). Market: India,
English. Investigated 2026-07-07.

## Summary: detail-only

| Surface | Path | robots.txt | Bot access | Usable |
|---------|------|-----------|------------|--------|
| Job detail | `/job/<slug>-<id>` and `/job/<id>` | **allowed** | 200 via plain curl | **YES** |
| Search API (JSON) | `/middleware/jobsearch` | **disallowed** (`Disallow: /middleware/`) | reachable | no (robots) |
| Search page (HTML) | `/search/<role>-jobs-in-<city>` | allowed | **HTTP 403** (Akamai) | no (blocked) |
| SRP shell | `/srp/results?query=…&locations=…` | allowed | 200 but **no job data** (SPA shell) | no |

Conclusion: there is no robots-allowed **and** bot-accessible way to run a
keyword/location search, so this skill implements `detail` only. `search` exits
`1` with code `SEARCH_UNSUPPORTED`.

## Detail endpoint (the data source)

```
GET https://www.foundit.in/job/<slug>-<id>
GET https://www.foundit.in/job/<id>            # bare id also 200s with full data
```

Headers: a browser `User-Agent` is sufficient. No auth, no cookies. A
nonexistent id returns **HTTP 404**.

The page server-renders several `<script type="application/ld+json">` blocks;
the one with `"@type":"JobPosting"` holds the data. Parse it with `JSON.parse`
and pick the JobPosting block (others are `BreadcrumbList`, etc.).

### JobPosting field map

| JSON-LD path | Our field | Notes |
|--------------|-----------|-------|
| `title` | `title` | |
| `identifier.value` | `id` | numeric; also the trailing id in the URL |
| `hiringOrganization.name` | `company` | |
| `jobLocation.address.addressLocality` | `location` | `jobLocation` may be an array → joined with `; ` |
| `datePosted` | `date` | `DD-MM-YYYY` |
| `validThrough` | `deadline` | `DD-MM-YYYY` |
| `url` | `url` / `applyUrl` | canonical foundit job URL |
| `description` | `description` | HTML → stripped to text, paragraph breaks kept |
| `employmentType` | `employmentType` | e.g. `Full time` |
| `experienceRequirements.monthsOfExperience` | `experienceMonths` | integer months |
| `occupationalCategory` | `category` | |
| `industry` | `industry` | array → comma-joined |
| `skills` | `skills` | array of strings |

Fields not always populated: `qualifications`, `responsibilities`,
`educationRequirements` are often `"NA"` / empty — not surfaced.

## robots.txt (relevant lines, 2026-07-07)

```
User-agent: *
Disallow: /seeker/dashboard
Disallow: /seeker/profile
Disallow: /pwa/
Disallow: /middleware/            <-- search JSON API lives here
Disallow: /mthinking/
Disallow: /xmlsitemap/expired-jobs-sitemap*.xml
Sitemap: https://www.foundit.in/xmlsitemap/sitemap-index.xml
Sitemap: https://www.foundit.in/xmlsitemap/todays-jobs-sitemap.xml
```

`/job/` and `/search/` are **not** disallowed. `/middleware/` **is**.

## Sitemaps (allowed)

- `https://www.foundit.in/xmlsitemap/todays-jobs-sitemap.xml` — `<loc>` entries
  are `/job/<slug>-<id>` URLs for today's postings. The test suite pulls the
  first id from here to run a live `detail` smoke test that does not rot.
- `https://www.foundit.in/xmlsitemap/sitemap-index.xml` — index of all sitemaps.

These provide job URLs but no keyword/location query capability, so they are not
a general search substitute.

## Maintenance notes

If `detail` breaks, the likely cause is a change to the JobPosting JSON-LD
shape. Re-fetch a `/job/<id>` page, dump the `application/ld+json` block whose
`@type` is `JobPosting`, and re-map fields in `cli/src/helpers.ts`
(`parseJobDetail`). If Foundit ever exposes a public, robots-allowed search
endpoint, `search.ts` is the place to implement it against the existing
contract (`--query`, `--location`, `--jobage`, `--page`, `--limit`, `--format`).
