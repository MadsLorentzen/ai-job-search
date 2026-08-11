# JobSearch API (jobtechdev.se) URL Reference

Public, unauthenticated JSON API operated by Arbetsförmedlingen's open-data platform
(JobTech Dev). It backs the Platsbanken job board at arbetsformedlingen.se — every ad
returned here also has a human-readable page at `arbetsformedlingen.se/platsbanken/annonser/<id>`.

Investigated 2026-08-11. `jobtechdev.se` (the docs landing site) could not be reached from
this environment's sandbox network (DNS did not resolve), so this reference is built from
directly probing the live API rather than from its published documentation — re-verify
against `jobtechdev.se`'s docs if you have external access and something here looks wrong.

## Search

```
GET https://jobsearch.api.jobtechdev.se/search
```

Query params observed to work:

| Param | Meaning | Example | Notes |
|-------|---------|---------|-------|
| `q` | Free-text query | `forskningsingenjör` | Runs NLP concept extraction — see Location below. |
| `limit` | Results per page | `20` | Errored (400) once at 200 in testing but 100 succeeded in a later run — behavior looked inconsistent/possibly rate-related; the CLI caps requests at 100 and treats a 400 as a client error (not retried). |
| `offset` | Pagination offset (0-indexed) | `20` | CLI maps 1-indexed `--page` to `offset = (page-1)*limit`. |
| `published-after` | Only ads published on/after this date | `2026-08-01` (YYYY-MM-DD) | Confirmed live: filters correctly. |
| `published-before` | Only ads published on/before this date | `2020-01-01` | Returned 200; not fully verified beyond that it doesn't error. |
| `sort` | Sort order | `pubdate-desc` | Confirmed live: reorders by publication date descending. Default (omitted) is relevance. |
| `municipality` | Filter by municipality | — | **Does not accept plain text.** `municipality=Jönköping` returned `total.value: 0` (silently over-filtered) rather than an error or a match — it expects a taxonomy `concept_id`, not a name. Not used by the CLI; embed the city in `q` instead (see Location). |

Unknown/unsupported param names are silently ignored (still 200), so a bad guess at a
param name fails quietly rather than erroring — verify any new param against real output,
not just a 200 status.

### Location

There is no reliable plain-text location parameter. Free-text location terms inside `q`
work well instead: the API extracts a `location` concept from the query text server-side
(visible in the response's `freetext_concepts.location` field) and filters hits by it. E.g.
`q=ingenjör Jönköping` correctly returned only Jönköping-based results in testing. The CLI
follows the `jobindex-search` convention: no `--location` flag — document "include the city
in `--query`" instead (see `SKILL.md`).

### Response shape

```jsonc
{
  "total": { "value": 51 },
  "hits": [
    {
      "id": "31322464",
      "headline": "Forskningsingenjör additiv tillverkning",
      "webpage_url": "https://arbetsformedlingen.se/platsbanken/annonser/31322464",
      "publication_date": "2026-08-05T14:52:31",
      "application_deadline": "2026-08-31T23:59:59",
      "employer": { "name": "RISE Research Institutes of Sweden AB", "url": "...", "organization_number": "..." },
      "workplace_address": { "municipality": "Mölndal", "region": "Västra Götalands län", "country": "Sverige", "coordinates": [lon, lat] },
      "occupation": { "label": "Forskningsingenjör, maskin", "concept_id": "..." },
      "description": { "text": "...", "text_formatted": "<p>...</p>" },
      "employment_type": { "label": "Vanlig anställning" },
      "working_hours_type": { "label": "Heltid" },
      "duration": { "label": "Tills vidare" },
      "application_details": { "url": "...", "email": null, "information": null }
      // ... many more taxonomy-linked fields (salary_type, scope_of_work, must_have/nice_to_have, etc.)
    }
  ]
}
```

The CLI maps each hit to the portal-skill contract's minimal shape
(`id, title, company, location, date, url`) plus `deadline` and `occupation`, via
`toJobResult()` in `helpers.ts`. `location` joins `municipality, region`, falling back to
`country` if both are absent.

## Detail

```
GET https://jobsearch.api.jobtechdev.se/ad/<id>
```

Returns the same object shape as one `hits[]` entry (confirmed identical field set live),
just for a single ad. A bogus/removed id returns `404` with an empty body — the CLI maps
this to `{ "error": "Job ad not found", "code": "NOT_FOUND" }`.

`description.text` is already plain text (no HTML stripping needed); `description.text_formatted`
carries the same content as light HTML if a formatted version is ever wanted.

## Access notes

- No authentication or API key required for either endpoint.
- `arbetsformedlingen.se/robots.txt` disallows `/platsbanken/annonser` only for two named
  bots (`i3bot`, `i3agent`); it is not disallowed for a general user agent (`*`). The API
  host (`jobsearch.api.jobtechdev.se`) has no `robots.txt` at all (404).
- This is Sweden's official public-sector open-data API for job listings (JobTech Dev /
  Arbetsförmedlingen), designed for third-party reuse — not a scrape of a page not meant
  for automated access. No formal terms-of-use text was reachable from this sandbox to
  quote directly; the personal-use-only framing in `SKILL.md` is a precaution, not a
  documented restriction.
- No rate-limit response headers were observed; the CLI still backs off on 429/5xx per the
  portal-skill contract in case limits exist but aren't advertised.
