# GamesJobsDirect Jobs URL Reference

Public, unauthenticated pages behind `https://www.gamesjobsdirect.com` (a UK-headquartered
games-industry job board, international listings, English language). Found by static
inspection: `curl`'d the homepage and `/search` advanced-search page, then read the
`/bundles/search` JS bundle to find the `loadResults()` function that builds the
results-page query string and does `window.location = url`.

> `robots.txt` allows generic crawlers (`User-agent: * / Allow: / / Crawl-Delay: 5`) — only
> specific named bots are disallowed (Jobbot, barkrowler, dotbot, Yandex, BLEXBot, DotBot,
> JobBot, rogerbot, AccompanyBot, Adsbot, SeznamBot, AwarioRssBot, AwarioSmartBot,
> ZoominfoBot). The CLI enforces the 5-second crawl delay between requests itself
> (see `respectCrawlDelay()` in `helpers.ts`).

## Search

```
GET https://www.gamesjobsdirect.com/results
```

Query params (short names, built client-side by `loadResults()` in `/bundles/search`):

| Param | Meaning | Example |
|-------|---------|---------|
| `k` | Free-text keyword query | `3d artist` |
| `l` | Location name (freeform text) | `Remote`, `Stockholm` |
| `age` | Posting-age bucket in days | `0` (any, default), `1`, `7`, `14`, `30`, `999` |
| `page` | 1-indexed page number | `1`, `2`, … |

`age=999` means "more than 30 days old" (the inverse of what `--jobage` needs), so the CLI
never selects it for `--jobage` — see `mapJobAge()` in `helpers.ts`.

**`l` is unreliable as a hard filter.** The site's homepage/search-page location field is an
autocomplete that resolves a free-text name to a `LocationID`/lat-lon pair before submitting;
passing raw text in `l` alone (as tested: `l=Remote`) did **not** filter results to remote
postings — the response still mixed in on-site jobs from many countries. Treat `--location`
as best-effort and prefer folding the place name into `--query` instead (same caveat
`jobindex-search` documents for its own board).

Returns an HTML results page. Each job card is:

```html
<li class="list-group-item job-list [featured]">
  <a href="/job/<company-slug>/<job-slug>/<id>" class="job-title" title="...">Job Title</a>
  <span class="label label-featured job-status">Featured</span>  <!-- only on featured cards -->
  <p class="job-info">
    <span class="job-location">City, Country</span><span class="job-company">Company</span><span class="job-sector"> Category</span>
  </p>
  <p class="job-description">Truncated snippet...</p>
  <p class="job-posteddate">Posted - 16 Jun 2026</p>
</li>
```

The CLI splits on `<li class="list-group-item job-list` and parses each chunk independently
so one malformed card can't break the rest. `id` is the numeric last path segment of the
`job-title` href. Pagination is `?page=<n>` (confirmed up to 15 pages on a broad query,
~10 results/page); `<ul class="pagination">` links confirm the param name.

## Detail

```
GET https://www.gamesjobsdirect.com/job/<any-slug>/<any-slug>/<id>
```

**The two slug segments are cosmetic** — confirmed by fetching
`/job/x/x/349054` and diffing against the real slugged URL for the same id: identical
`title` in the page's JSON-LD. The CLI always requests `/job/listing/listing/<id>`.

**Invalid/expired ids do not 404** — they return HTTP 200 with the body:
`Sorry, this job has expired, please view similar jobs below or search again with
different parameters.` and no `application/ld+json` script tag. The CLI treats "no
JobPosting JSON-LD block found" as `NOT_FOUND` rather than trusting the HTTP status.

### JobPosting JSON-LD block

Every valid detail page embeds a `<script type="application/ld+json">` block shaped like
`schema.org/JobPosting`, but **it is not valid JSON** — sampled block had semicolons instead
of commas inside the nested address object:

```json
{
  "datePosted": "2026-06-23",
  "description": "            <p>...&lt;br&gt;&lt;br&gt;...</p>\n",
  "employmentType": "Permanent",
  "jobLocation": {
    "address": {
      "addressLocality": "Stockholm, Sweden",
      "addressRegion": "Sweden";
      "addressCountry": "Sweden";
    }
  },
  "industry": "Art",
  "salaryCurrency": "GBP",
  "title": "3D Artist",
  "workHours": "Full Time",
  "validThrough": "2026-08-21",
  "hiringOrganization": { "name": "Embark Studios" }
}
```

Because of the stray semicolons, the CLI does **not** `JSON.parse` this block — it extracts
each field with a targeted regex scoped to the `<script>` body (see `parseJobDetail` in
`helpers.ts`). `description` is doubly-nested: the outer wrapper (`<p>...</p>`) is real HTML,
but inner formatting (`<br>`, `<ul><li>`, `<strong>`) is HTML-entity-escaped
(`&lt;br&gt;` etc.) one level deeper than the outer tags — decode entities **first**, then
strip tags, converting block-level closes to newlines (same approach as
`linkedin-search`'s `parseJobDetail`).

`validThrough` is the application deadline when present. `employmentType` /
`workHours` are free-text portal-specific enums (`"Permanent"`, `"Full Time"`, etc.), not
schema.org's own controlled vocabulary — pass them through as-is.

### Apply link

The "Apply" button on a detail page points at
`/details/redirect/<job-slug>/<id>` on the portal itself (an interstitial/tracking hop, not a
direct redirect — `curl -I` on it returns `200`, not a `3xx`, so the CLI does not attempt to
resolve it further). The CLI surfaces this portal path as `applyUrl`; following it in a
browser is required to reach the employer's own application page.

## Notes

- No authentication required.
- Respect the 5-second crawl delay from `robots.txt` — the CLI enforces a minimum 5s gap
  between any two requests it makes (search or detail), in addition to its 429/5xx backoff.
- Results and detail pages are plain server-rendered HTML (ASP.NET MVC) — no separate JSON
  API was found; `/bundles/search` only contains the client-side query-string builder, not a
  fetch/AJAX call (`loadResults()` does a hard `window.location` navigation to `/results`).
