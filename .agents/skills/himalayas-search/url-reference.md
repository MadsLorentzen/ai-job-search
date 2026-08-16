# Himalayas API Reference

Public, unauthenticated JSON endpoint used by this skill.

## Listings

```
GET https://himalayas.app/jobs/api?limit=20&offset=<n>
```

- `limit` is silently capped at **20** server-side regardless of the value requested.
- `offset` pages through results (0, 20, 40, …), newest first.
- Query params like `searchTerm`, `keywords`, `q`, `search` are accepted but **ignored**
  — there is no server-side keyword search. This skill fetches N pages and filters
  client-side.

Response shape: `{ comments, updatedAt, offset, limit, totalCount, jobs: [...] }`.

Job object fields used by this skill:

| Field | Meaning |
|-------|---------|
| `title` | Job title |
| `companyName` / `companySlug` | Company name and URL slug |
| `employmentType` | e.g. `Full Time`, `Contract` |
| `minSalary` / `maxSalary` / `salaryPeriod` / `currency` | Salary range, when listed |
| `locationRestrictions` | Array of allowed countries; **empty array = worldwide/no restriction** |
| `categories` / `parentCategories` | Tag/category arrays |
| `description` | Full HTML job description (already complete — no separate detail fetch needed) |
| `pubDate` | Unix epoch seconds |
| `guid` | Canonical job URL, `https://himalayas.app/companies/<companySlug>/jobs/<jobSlug>` — the `<companySlug>/<jobSlug>` pair is used as this skill's job ID |
| `applicationLink` | Direct application link (often same as `guid`) |

## Detail pages

`GET https://himalayas.app/companies/<company>/jobs/<slug>` (the HTML page) returns
**403 to non-browser clients** — it's not usable for scraping. Since the list API
already embeds the full description, this skill's `detail` command instead re-scans
the paged list API for a matching ID rather than fetching the HTML page.

## Notes

- No authentication required.
- Respect rate limits — the CLI backs off on 429/5xx.
