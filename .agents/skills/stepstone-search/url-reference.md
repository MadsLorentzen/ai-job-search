# Stepstone.de URL Reference

Public, unauthenticated, server-rendered HTML pages used by this skill. No JSON API is
exposed to unauthenticated clients (checked for `/api/`/XHR endpoints in the page source —
none found; the Akamai-fronted site only returns SSR HTML to a plain GET).

## robots.txt constraints (checked 2026-08-02)

```
Disallow: /jobs/*?*
Allow: /jobs/*?q=*
Disallow: /jobs/*?q*&*
...
Disallow: /search-results
Disallow: /search-results/*
Disallow: /listing
Disallow: /listing/*
```

`/jobs/*` paths are disallowed with **any** query string except a bare `?q=<value>` — a
second parameter (`&page=`, `&age=`, etc.) is explicitly disallowed. The newer
`/search-results` and `/listing` endpoints (which do support extra params) are fully
disallowed. This CLI therefore only ever issues `GET /jobs/<slug>[/in-<city>]?q=<query>`
— nothing else — and implements recency filtering and pagination client-side/as a hard
error rather than via URL params. `/stellenangebote--*` (job detail) is not mentioned in
robots.txt and is unrestricted.

## Search

```
GET https://www.stepstone.de/jobs/<any-slug>[/in-<city-slug>]?q=<query>
```

- The first path segment (`<any-slug>`) is decorative — verified live that `/jobs/search?q=...`
  and `/jobs/machine-learning-engineer?q=...` return identical results for the same `q`.
- `/in-<city-slug>` is optional; when present, Stepstone resolves it to roughly a 30km
  radius around that city server-side (confirmed via the `searchResultsRadiusSearched:30`
  value embedded in the page's analytics payload). Omit it to search all of Germany.
- No other query parameters are honored in an allowed way — `--jobage` and `--page>1`
  are therefore not implemented as URL params (see `../cli/README.md`).

### Response structure

Server-rendered HTML (~1-1.5MB, heavy CSS-in-JS noise per element). Each result is:

```html
<article id="job-item-<numericId>" data-at="job-item" ...>
  ...
  <a href="/stellenangebote--<slug>--<numericId>-inline.html" data-at="job-item-title">
    ...<div>Job Title</div>
  </a>
  ...
  <span data-at="job-item-company-name">...<div>Company Name</div></span>
  <span data-at="job-item-location">...<span>City, Other City</span></span>
  <span data-at="job-item-timeago"><time>vor 4 Tagen</time></span>
  <span data-at="job-item-badge">Vollzeit</span>
</article>
```

Every field of interest sits behind a `data-at="job-item-*"` marker, with the actual text
a few empty wrapper tags (icons, style blocks, layout divs) below it and no other text in
between. `helpers.ts`'s `firstLeafText()` exploits this: locate the marker, then take the
first non-empty `>text<` run that follows — this is robust to Stepstone reshuffling the
wrapper divs (which change often; the class names are hashed/generated) as long as the
`data-at` marker and the "no other text before the value" property hold.

- **Total count**: `data-resultlist-offers-total="<n>"` attribute near the top of the
  results container (parsed into `meta.total`). The SSR page only ever contains the first
  ~25 results (`searchResultsDisplayedJobCount:25` in the analytics payload) regardless of
  `total` — further results load via client-side infinite scroll, which is not reachable
  through an allowed single GET.
- **Date**: only a relative string is present (`vor 4 Tagen`, `Heute`, `Gestern`, `vor 2
  Wochen`, `vor 3 Monaten`) — no absolute timestamp. `parseGermanRelativeDate()` converts
  this to an ISO date for the CLI's `date` field.
- **Employment type**: `data-at="job-item-badge"` (e.g. `Vollzeit`, `Teilzeit`) — present
  on some but not all cards.

## Detail

```
GET https://www.stepstone.de/stellenangebote--<any-slug>--<numericId>-inline.html
```

- Verified live: the slug is ignored server-side — `--x--14338328-inline.html` returns the
  same job as the slug captured from search results. The CLI always builds detail URLs
  with a placeholder slug (`--job--<id>-inline.html`) so `detail <id>` works from a bare ID.
- The **non**-`-inline` variant (`/stellenangebote--...--<id>.html`, no `-inline` suffix)
  returned `403` in testing — always use `-inline.html`.
- Fields (all behind `data-at` markers, same `firstLeafText` extraction approach):
  - `header-job-title` — job title (`<h1>`)
  - `metadata-company-name` — company name
  - `metadata-location` — location
  - `job-ad-salary` — salary range text when Stepstone estimates one; frequently absent
    (the marker's own leaf text is the literal heading "Gehalt" when no salary follows —
    the CLI discards that specific value and returns `null`)
  - `job-ad-content` — the full description block, sliced up to the next
    `job-ad-company-card` marker, `<style>` blocks stripped, then all remaining tags
    stripped with paragraph/list/heading closes converted to newlines
- **Apply link**: the apply button (`data-at="apply-now-section"`) is a client-side-only
  React component (`disabled` in the raw SSR HTML) — no server-rendered apply URL exists.
  The CLI returns the detail page URL itself as `applyUrl`; a human still needs to open it
  in a browser to apply.
- **Deadline**: not present as a structured field on the postings checked during
  development — German boards generally don't surface one the way Danish boards do. Not
  parsed; would show up as prose inside `description` if the posting mentions one.

## Notes

- Access checked via `curl` with a standard desktop Chrome User-Agent; no CAPTCHA/block
  page was encountered for `/jobs/*?q=*` or `/stellenangebote--*-inline.html` at the
  request volumes used during development (a handful of requests). The site sets Akamai
  Bot Manager cookies (`_abck`, `bm_sz`) but did not require them to be echoed back for a
  plain GET to succeed.
- If Stepstone changes its markup, re-run `curl` against a real search URL, grep for
  `data-at="job-item` (search) or `data-at="header-job-title"` (detail) to confirm the
  markers above still exist, and update `firstLeafText`'s call sites in `helpers.ts`
  accordingly.
