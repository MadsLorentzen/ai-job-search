# ArtStation Jobs API Reference

Public, unauthenticated JSON API used by the artstation.com/jobs Angular app.
Global — the same endpoints serve every market.

**How it was found:** static grep of the page's minified JS bundles (`main.*.js`,
`vendor.*.js`, `scripts.*.js`) turned up nothing — the endpoint is built at
runtime, not present as a literal string. It was found by loading
`https://www.artstation.com/jobs` in a real browser, running a search, and
reading the resulting network requests (`claude-in-chrome`'s
`read_network_requests`). If this endpoint stops working, redo that capture
rather than re-grepping the bundles.

## Search

```
GET https://www.artstation.com/api/v2/jobs/public/jobs.json
```

Query params:

| Param | Meaning | Example |
|-------|---------|---------|
| `query` | Free-text keyword search | `Environment Artist` |
| `page` | 1-indexed page | `1` |
| `per_page` | Results per page. **Must be >= 3** — the API returns a 400 (`{"message":"per_page should be >= 3","code":"per_page"}`) below that. | `20` |

No server-side location or date-range parameter was identified. The web UI has
Location/Experience/Job Type/Industry/Tags/Medium/Software/Salary filter
dropdowns, but their param wiring wasn't captured during scaffolding (Step 2 of
`/add-portal` scoped to search + detail only). Revisit with a browser network
capture on those filter controls if location filtering becomes worth adding.

Response shape:

```json
{
  "total_count": 6,
  "data": [
    {
      "id": 29668,
      "hash_id": "aNba",
      "title": "Senior Environment Artist",
      "description": "<h2>...</h2><p>...</p>",
      "about": null,
      "company_name": "Epic Games",
      "company_url": "https://www.epicgames.com/...",
      "apply_link": "https://www.epicgames.com/site/careers/jobs/...",
      "how_to_apply": "<a ...>...</a>",
      "recruitment_localities": [
        { "locality": { "formatted_name": "Cary, NC, USA", "city_name": "Cary", "country_name": "United States" } }
      ],
      "skills": "",
      "salary_range": { "min_salary": null, "max_salary": null, "currency": "USD", "period": "year", "currency_symbol": "$" },
      "work_remotely": true,
      "offer_relocation": false,
      "level": "senior",
      "job_type": "permanent",
      "job_state": "approved",
      "created_at": "2026-07-29T14:54:56+00:00",
      "updated_at": "..."
    }
  ]
}
```

`recruitment_localities` can be an empty array (fully remote/unspecified) or hold
multiple entries (a role open across several countries/cities — mirrors the
mass-posting pattern seen on LinkedIn). `skills` was empty string on every sample
observed; the parser also accepts an array shape defensively. `job_type` observed
values: `permanent`, `contract`, `other`.

## Detail

```
GET https://www.artstation.com/api/v2/jobs/public/jobs/<hash_id>.json
```

Returns a single job object in the same shape as one `data[]` entry above — no
envelope. 404s on an unknown/removed `hash_id`.

There is **no separate facets/detail UI endpoint needed** for this skill's scope;
`facets.json` (`GET .../jobs/facets.json?query=...`) exists and returns
classification-id counts for the UI's filter sidebar, but the CLI does not use it.

## Human-facing URL

```
https://www.artstation.com/jobs/<hash_id>
```

This is what a browser renders for one posting; confirmed live during scaffolding
(2026-07-31) that this route works standalone from just the `hash_id`.

## Access notes

- `robots.txt` (`https://www.artstation.com/robots.txt`) disallows `/*/likes`,
  `/*/following`, `/*/followers`, `/*/collections*`, `/registration/*`,
  `/studentpro`, `/2fa`, `/users/password/edit` — none of which overlap `/jobs`
  or `/api/v2/jobs`.
- Plain `curl` with a standard browser `User-Agent` gets a normal 200 from both
  the HTML page and the JSON API — no Cloudflare/bot-check friction observed for
  these specific endpoints during scaffolding, even though `WebFetch` (a
  different fetch path/IP) hit a 403 on the HTML page. If the JSON API starts
  403ing from a given environment, the browser-based capture route
  (`claude-in-chrome`) is the fallback for re-diagnosing it.
- No authentication required for either endpoint.
