# Instahyre — endpoint reference

Data source for `instahyre-search`. Update this file if Instahyre changes its API
or posting-page markup.

## Access / terms

- `https://www.instahyre.com/robots.txt` — only declares a `Sitemap:` and an empty
  `User-agent: *` block with **no `Disallow` rules**. Nothing is disallowed.
- The `job_search` JSON API and the public posting pages (`/job-<id>-...`) return
  full data **anonymously** (no login). Applying to a job requires an account, but
  reading listings/descriptions does not — so this is not an auth-walled portal.
- Treat as personal-use only: keep volume low, no bulk/commercial scraping.

## Search — JSON API (primary)

```
GET https://www.instahyre.com/api/v1/job_search/?skills=<kw>&jobLocations=<city>&offset=<n>
Accept: application/json
```

Parameters (all optional, but supply at least one filter):

| Param          | Maps to CLI flag | Notes |
|----------------|------------------|-------|
| `skills`       | `--query` / `-q` | Keyword/skill/role filter. Accepts phrases ("backend developer" → 197 results). **This is the real keyword filter.** |
| `jobLocations` | `--location`/`-l`| City name ("Bangalore", "Mumbai", "Delhi NCR", "Pune"). Repeatable (OR). |
| `offset`       | `--page`         | 0-indexed record offset. Page size is **fixed at 35**; `page N → offset=(N-1)*35`. |

**Gotchas discovered during investigation:**

- The `q=` param is **ignored** — it always returns the full ~13,600-job feed in a
  default/rotating order. Do **not** use `q` for keyword search; use `skills`.
- `limit=` is **ignored** by the server (always returns 35). `--limit` is applied
  client-side.
- No posting-age parameter and **no date field** in search objects, so `--jobage`
  is unsupported and `date` is always `null` in search results (the detail page
  does carry `datePosted`).
- Other supported filters seen in the frontend (not wired into the CLI):
  `job_functions=[uri]`, `job_type` (0=full-time, internship slug), `company_size`,
  `years` (experience).

### Response shape

```json
{
  "objects": [
    {
      "id": 432044,
      "title": "Lead Engineer - LLM",
      "candidate_title": "Lead Engineer - LLM",
      "locations": "Bangalore,Kolkata",
      "public_url": "https://www.instahyre.com/job-432044-lead-engineer-llm-at-mihup-bangalore-kolkata/",
      "employer": { "company_name": "Mihup", "id": 14769, ... },
      "keywords": ["Generative AI", "NLP", "Python"]
    }
  ],
  "meta": { "total_count": 13649, "offset": 0, "limit": 35, "next": "...", "previous": null, ...facets }
}
```

Field mapping (`objects[i]` → JobCard):

| JobCard   | Source |
|-----------|--------|
| `id`      | `id` (stringified) |
| `title`   | `title` (fallback `candidate_title`) |
| `company` | `employer.company_name` |
| `location`| `locations` (comma-split, re-joined ", ") |
| `date`    | `null` (not present) |
| `url`     | `public_url` |
| `keywords`| `keywords[]` |

## Detail

Two-step, because the JSON object has no description:

1. `GET https://www.instahyre.com/api/v1/job_search/<id>` → JSON with `public_url`
   + basic fields (title, employer, locations, keywords). Used to resolve the
   public URL from a numeric id.
2. `GET <public_url>` (HTML) → the page embeds a `JobPosting` JSON-LD block:

```json
{
  "@type": "JobPosting",
  "title": "SDE - 1 (Full - Stack)",
  "jobLocation": [{ "address": { "addressLocality": "Noida", "addressRegion": "Uttar Pradesh", ... } }],
  "employmentType": "FULL_TIME",
  "datePosted": "2014-04-17",
  "hiringOrganization": { "name": "Instahyre", ... },
  "description": "<html><body><p>...full HTML description...</p></body></html>"
}
```

Detail field sources:

| JobDetail        | Source |
|------------------|--------|
| `description`    | ld+json `description` (HTML → text: entities decoded, tags stripped, `<p>/<br>/<li>` → newlines) |
| `date`           | ld+json `datePosted` |
| `employmentType` | ld+json `employmentType` (e.g. `FULL_TIME`) |
| `location`       | ld+json `jobLocation[].address` (locality + region) |
| `company`        | ld+json `hiringOrganization.name` (fallback API `employer.company_name`) |
| `applyUrl`       | the public posting URL (applying requires login) |

`detail` accepts either a numeric id (`432044`) or a full posting URL
(`https://www.instahyre.com/job-432044-...`).

## Sitemaps (context, not used by the CLI)

- `https://www.instahyre.com/sitemap.xml` → index of `sitemap-jobs.xml`,
  `sitemap-skills.xml` (`/<skill>-jobs/` landing pages), `sitemap-home.xml`.
- Public search landing pages exist at `/<skill>-jobs/` and
  `/<skill>-jobs-in-<city>/`, but they are Angular shells that fetch the same
  `job_search` API — the CLI calls the API directly instead of scraping them.
