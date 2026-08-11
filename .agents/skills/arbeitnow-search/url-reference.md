# Arbeitnow URL Reference

Public, unauthenticated endpoints. No credentials required.

## robots.txt (fetched 2026-08-10)

```
User-agent: *
Disallow:
Disallow: /*?__hstc
Disallow: /jobs/companies/*/apply
```

Effectively open: nothing this skill touches is disallowed. `/jobs/companies/*/apply` is
blocked (this skill never fetches that path — it fetches the job posting page itself, not the
apply sub-page).

## Job-board API

```
GET https://www.arbeitnow.com/api/job-board-api?page=<n>
```

This is a real, documented public API (Arbeitnow markets it as a free job-board API for
developers — see `meta.info` in any response for a link to their blog post about it). The
response embeds its own terms:

> "This is a free public API for jobs, please do not abuse. I would appreciate linking back to
> the site. By using the API, you agree to the terms of service present on Arbeitnow.com"

**Keep volume low** per that notice, even though nothing here is robots.txt-disallowed.

### Response shape

```json
{
  "data": [
    {
      "slug": "machine-learning-engineer-berlin-berlin-munchen-bavaria-180645",
      "company_name": "Awin",
      "title": "Machine Learning Engineer (f/m/d)",
      "description": "<p>...</p>",
      "remote": false,
      "url": "https://www.arbeitnow.com/jobs/companies/awin/machine-learning-engineer-...-180645",
      "tags": ["Product", "Research & Development"],
      "job_types": ["Full-time"],
      "location": "Berlin, Berlin; München, Bavaria",
      "created_at": 1786384551
    }
  ],
  "links": { "first": "...", "last": null, "next": "...?page=2", "prev": null },
  "meta": { "current_page": 1, "per_page": 176, "terms": "...", "info": "..." }
}
```

- `description` is the **full** job description HTML (confirmed: 10k+ characters on real
  postings) — no separate detail fetch is needed to get the full text from `search` output.
- `created_at` is a **Unix timestamp** (seconds), always present, always reliable — unlike
  StepStone's relative German time strings, this converts cleanly to an ISO date.
- `location` can be an **empty string** for fully-remote/unlocated postings — mapped to `null`.
- No numeric/stable job ID field; `slug` is the closest thing to one, but it does **not**
  include the company slug that the job's own URL needs (see Detail below).
- `links.last` is always `null` — there is no "total pages" signal; jobs are just an ongoing
  reverse-chronological stream, paginate by incrementing `page` until a page comes back empty
  or 404s.

### No server-side search — verified, not assumed

This looked like it might support `?search=`, `?q=`, `?title=`, `?location=`, `?tags=`,
`?remote=`, or similar filter params, since sites like this often do. **It does not.** Verified
during development by comparing responses:

- `?search=Product+Owner`, `?q=Product+Owner`, `?title=Product+Owner`, `?keyword=Product+Owner`,
  `?tags=Product`, `?location=Berlin`, and even `?search=zzzznonexistentqueryzzzz` (a value that
  cannot possibly match anything) **all returned the exact same first result**, byte-for-byte
  identical to each other regardless of the parameter name or value.
- `?remote=true` returned a result set still containing both `remote:true` and `remote:false`
  jobs — not filtered.
- Only `?page=<n>` genuinely changes the response.

Conclusion: unrecognized query parameters are silently ignored (likely just changing which
cache bucket nginx/Laravel serves), not used as filters. **This CLI therefore filters
client-side** after fetching one page — see `filterJobs()` in `cli/src/helpers.ts`. `search`
only searches the ONE page it fetches (`--page`, default 1, ~176 jobs); to look further back,
call `search` again with a higher `--page` (results are reverse-chronological, so higher pages
are older postings).

## Job detail page (JSON-LD)

```
GET https://www.arbeitnow.com/jobs/companies/<company-slug>/<job-slug>
```

This is the `url` field from a listing entry. The page embeds a `JobPosting` schema.org block
inside `<script type="application/ld+json">`, wrapped in a `@graph` array:

```json
{
  "@context": "https://schema.org/",
  "@graph": [{
    "@type": "JobPosting",
    "title": "Machine Learning Engineer (f/m/d)",
    "identifier": { "name": "Awin", "value": "awin" },
    "datePosted": "2026-08-10T17:55:51.000000Z",
    "employmentType": "FULL_TIME",
    "hiringOrganization": { "name": "Awin", "url": "...", "logo": "..." },
    "jobLocation": { "address": { "addressLocality": "Berlin", "addressRegion": "BERLIN", "addressCountry": "DE" } },
    "skills": "Product, Research & Development",
    "validThrough": "2026-11-02T18:55:51.000000Z",
    "jobBenefits": "English speaker friendly, 4 day work week possible",
    "description": "<p>...</p>"
  }]
}
```

This is **more complete than the listing API** for a single job — real ISO `datePosted` and
`validThrough`, `employmentType`, and `jobBenefits` that the listing endpoint doesn't expose.

**A bare `slug` from a search result cannot be turned into this URL on its own** — the URL also
needs the company slug (`identifier.value` / the `/companies/<company-slug>/` path segment),
which is only present in the full `url` field a search result already gives you. Always pass
that URL to `detail`, not the bare slug.

`description` in the JSON-LD is the same rich HTML as the listing API's `description` field —
cleaned the same way (block tags → newlines, entities decoded, tags stripped).

No dedicated `applyUrl` — `directApply: false` in the JSON-LD signals applications happen
off-site; the job's own `url` is the best entry point.

## Notes

- Named HTML entities matter here, not just numeric ones: real descriptions (many originally
  German) use `&uuml;`, `&auml;`, `&szlig;`, etc. `decodeHtmlEntities()` in `helpers.ts` has an
  explicit table for these — confirmed live on a real posting ("übernimmst" was coming through
  as literal "&uuml;bernimmst" before this was added).
- No authentication required for either the API or job pages.
- Backs off on 429/5xx with exponential backoff + jitter (max 6 retries), matching the other
  portal skills in this repo.
