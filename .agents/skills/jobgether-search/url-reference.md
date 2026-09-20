# jobgether.com API reference

The endpoints, parameters, and response shapes this skill depends on. This is the
file to update if jobgether changes its API. Base URL is fixed at
`https://jobgether.com` (no self-hosting; this is a hosted SaaS aggregator).

## The API is public and explicitly built for AI agents

`robots.txt` (`https://jobgether.com/robots.txt`) carries `Content-Signal: search=yes,
ai-input=yes, ai-train=no` and explicitly `Allow: /astroapi/ai/jobs.json` /
`Allow: /astroapi/ai/jobs.json?*` even though it otherwise disallows query strings
(`Disallow: /*?*`). The API's own docs endpoint opens with: "Intended for AI
agents/assistants answering user job-search queries." No API key, no login wall.

Verified against the live API (2026-09-20):

| Endpoint | Status |
|----------|--------|
| `GET /api/v1/jobs` | 200 |
| `GET /astroapi/ai/jobs.json` | 200 — deprecated alias of `/api/v1/jobs`, sunsets 2026-09-28 (`Deprecation`/`Sunset`/`Link: rel="successor-version"` headers). This skill uses `/api/v1/jobs` directly. |
| `GET /astroapi/ai/jobs/docs` | 200 — machine-readable reference: params, enums, error format, examples |
| `GET /openapi.json` | 200 — OpenAPI 3.1 spec, same surface |
| `POST /mcp` | 200 — the same search exposed as an MCP tool (`searchJobs`, JSON-RPC 2.0 Streamable HTTP). Not used by this skill; REST is simpler for a CLI. |
| `GET /offer/<24-hex-id>-<any-slug>` | 200 with a **browser** User-Agent; **403 with the CLI's honest UA** — see "detail is WAF-blocked" below |

## `GET /api/v1/jobs`

GET (query params) or POST (same params as a JSON body); this skill uses GET only.

| Param | Maps to CLI flag | Notes |
|-------|-------------------|-------|
| `keyword` | `--query` / `-q` | Free-text across title, job function, skills, company, contract type, language. |
| `jobReferences` | `--job-function` | Job-function slugs, comma-separated (e.g. `product-manager`). Open taxonomy — no fixed enum; an unknown value is a 400, not a silent no-op. |
| `locations` | `--location` / `-l` | Country, continent, or city slugs (e.g. `spain`, `europe`, `worldwide`), comma-separated. Open taxonomy, same 400-on-unknown behavior. |
| `industries` | `--industry` | Industry slugs or ids, comma-separated. |
| `contractType` | `--contract-type` | Closed enum: `full-time`, `part-time`, `fixed-term`, `freelance`, `internships`. Comma-separated for OR. |
| `experience` | `--experience` | Closed enum: `entry-level-graduate`, `junior-1-2-years`, `mid-level-2-5-years`, `senior-5-10-years`, `expert-10-years`. |
| `remoteType` | `--remote` | `full-remote` \| `remote-first` \| `hybrid`. All listings are remote-friendly by default; this widens/narrows that. |
| `includeHybrid` | `--include-hybrid` | `"true"`/`"false"`. Bare flag sets `true`. |
| `salaryMin` / `salaryMax` | `--salary-min` / `--salary-max` | Annual, in `currency`. |
| `currency` | `--currency` | ISO code, e.g. `EUR`. |
| `sort` | `--sort` | `relevance` (default) \| `date`. |
| `page` | `--page` | 1-indexed. **Capped at 10** by the API. |
| `limit` | `--limit` / `-n` | Default 10, capped at 25 by the API. |

**No `posted_within_days`-style parameter exists.** `--jobage <days>` is implemented
client-side in `search.ts`, filtering the fetched page's `postedAt` values — it does
not reduce or re-fetch earlier pages. Combine with `--sort date` to see the freshest
postings first.

Closed enums (`contractType`, `experience`, `remoteType`, `sort`) are **not**
validated client-side. The CLI passes them straight through and translates the
API's own 400 response into the stderr error convention — see "Error format" below.
This mirrors `freehire-search`'s "never invent facet values" principle and keeps the
CLI in sync with the API automatically if an enum value is added or renamed.

### Response shape

```jsonc
{
  "jobs": [
    {
      "id": "6aaf5383865119c687d03d66",
      "title": "Senior Product Manager",
      "company": "Clera Inc.",
      "url": "https://jobgether.com/offer/6aaf5383865119c687d03d66-senior-product-manager",
      "location": "Austria",
      "remote": "Full Remote",
      "contractType": "Full time",
      "experience": "Senior (5-10 years)",
      "salaryRange": "70000-150000 USD",   // absent when undisclosed
      "jobFunctions": ["Product Manager"],
      "postedAt": "2026-09-20T03:31:15.864Z"
    }
  ],
  "pagination": { "page": 1, "limit": 10, "hasMore": true },
  "browseOnSiteUrl": "https://jobgether.com/search-offers?keyword=..."
}
```

`browseOnSiteUrl` is a **human-facing link**, not a paginator — the docs explicitly
warn against treating it as a way to fetch more results; this skill does not use it.

No `description` field is present in search results — that is exactly what `detail`
exists to fetch.

## Error format (RFC 9457 `application/problem+json`)

```jsonc
{
  "type": "/astroapi/ai/jobs/docs#invalid_parameter",
  "title": "Invalid parameter",
  "status": 400,
  "detail": "Invalid value for 'experience': \"senior\"",
  "code": "invalid_parameter",
  "field": "experience",
  "allowedValues": ["entry-level-graduate", "junior-1-2-years", ...]
}
```

`helpers.ts`'s `apiGet` reads `detail` as the error message and `code` (uppercased,
e.g. `INVALID_PARAMETER`) as the CLI's stderr `code` — so a bad `--experience` value
surfaces the API's own message and allowed values, not a generic "search failed".
Codes: `invalid_parameter` / `invalid_body` (400, no retry), `not_found` (404),
`timeout` (504 — "search exceeded its server-side budget, retry with a narrower
query" — retried with backoff like any 5xx, then surfaced), `internal_error` (500).

## `detail` has no JSON endpoint — and its HTML page is WAF-blocked by default

There is **no** `GET /api/v1/jobs/<id>` and no per-job MCP tool (confirmed live:
`tools/list` on `/mcp` returns only `searchJobs`). The only place a posting's full
description, deadline, and apply link exist is the HTML offer page,
`https://jobgether.com/offer/<id>-<slug>`.

That page is guarded by Cloudflare in a way the JSON API is not:

- The CLI's honest UA (`Mozilla/5.0 (compatible; jobgether-search-cli/1.0)`) gets
  **403** on every `/offer/...` URL tested, headers or no headers.
- A full browser User-Agent gets **200** on the identical URL.
- `robots.txt` does **not** disallow this path — it only blocks literal
  unresolved-placeholder paths (`/offer/{*}`, `/offer/%7B*%7D`), confirmed with
  `python3 tools/robots_check.py '<offer URL>'` → `ALLOWED`.

That combination — WAF default blocking a non-browser UA on a path `robots.txt`
actually permits — is exactly the case
`.claude/skills/job-application-assistant/09-web-research.md` exists for. Per the
add-portal contract, this CLI does **not** bake a browser-header retry into its
default fetch (`fetchOfferHtml` in `helpers.ts`); it reports `403` as a `FORBIDDEN`
error pointing at that file's documented procedure (`robots_check.py`, then `curl`
with browser headers) instead. Whoever is driving the CLI decides whether to run
that retry manually.

The JSON-LD parsing itself (`parseOfferDetail`) was verified against a real,
live-fetched offer page obtained via that exact procedure — description, employment
type, deadline, and the real ATS apply link all extracted correctly (see SKILL.md's
"detail is WAF-blocked" section for the live verification result).

### What `detail`'s parser reads once it has the HTML

The offer page embeds a schema.org `JobPosting` in a `<script type="application/ld+json">`
block:

```jsonc
{
  "@type": "JobPosting",
  "title": "Senior Product Manager",
  "description": "<p>...</p>",              // HTML; stripped by cleanHtml()
  "hiringOrganization": { "name": "Clera Inc." },
  "datePosted": "Sun Sep 20 2026 03:31:15 GMT+0000 (...)",
  "employmentType": ["FULL_TIME"],
  "validThrough": "2026-11-20T03:31:15.864Z",  // -> deadline
  "applicantLocationRequirements": [{ "name": "AT" }]  // ISO country code, coarser
                                                        // than search's "Austria"
}
```

The real (external ATS) apply link is a separate `data-apply-url="..."` attribute
elsewhere in the page markup — jobgether's own `/auto-apply` anchor on the page is a
redirect wrapper, not the destination, so `parseOfferDetail` reads the attribute
directly rather than following the wrapper link.

A 404 or 410 (confirmed live for a made-up id) means the posting is gone; `detail`
reports `NOT_FOUND`.

### Building the offer URL from a bare id

The slug after the id is cosmetic — jobgether resolves the page from the 24-hex id
prefix alone and ignores the rest (verified live: an arbitrary placeholder slug
still returns 200), so `detail <id>` builds `https://jobgether.com/offer/<id>-job`
without needing to look up the real slug first.
