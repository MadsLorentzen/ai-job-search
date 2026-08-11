# StepStone.de URL Reference

Public, unauthenticated pages used by this skill. No credentials required. **All URLs are
static, query-string-free paths** — see "Why no query string?" below for the reason.

## robots.txt summary (fetched 2026-08-10)

The relevant rules from `https://www.stepstone.de/robots.txt`:

```
Disallow: /jobs/*?*
Allow: /jobs/*?q=*
Disallow: /jobs/*?q*&*
Disallow: /search-results
Disallow: /search-results/*
Disallow: /listing
Disallow: /listing/*
Disallow: /public-api/
```

- `/jobs/*` with **any** query string is disallowed, **except** a bare `?q=<value>` with no
  other parameters (the `Disallow: /jobs/*?q*&*` line blocks appending anything else via `&`).
  That means no robots.txt-compliant way to add `--jobage`/`--page` as query params on this path.
- `/search-results` and `/listing` (the classic results-page routes) are fully disallowed.
- `/public-api/` is disallowed — this is the endpoint (`/public-api/resultlist/`) that actually
  backs the search UI's live results (visible in the page's client bundle), so it is off-limits
  even though it would be the "obvious" JSON API to call.
- Nothing under `/stellenangebote--...` (job detail pages) or `/jobs/<slug>[/in-<city>]`
  (path-segment search, no query string) is disallowed.

## Why no query string?

Given the above, this CLI never constructs a `/jobs/*?...` URL. Instead it uses the path-based
search pattern that StepStone's own site links to from job-title/category landing pages:

```
GET https://www.stepstone.de/jobs/<title-slug>[/in-<city-slug>]
```

This is a fully static path (no `?`), so none of the query-string rules above apply to it.
Confirmed live with real, differently-filtered results for:
- `/jobs/product-owner` (no location)
- `/jobs/product-owner/in-berlin` (title + city)
- `/jobs/backend-entwickler-python/in-muenchen`
- `/jobs/asdkjaslkdjalksd-not-a-real-title` (garbage slug still 200s — StepStone does fuzzy
  matching on the slug, not exact lookup, so it degrades gracefully rather than 404ing)

Slugs are built by `slugify()` in `cli/src/helpers.ts`: lowercase, German umlauts/ß
transliterated (`ä`→`ae`, `ö`→`oe`, `ü`→`ue`, `ß`→`ss`), everything else collapsed to hyphens.

**Trade-off:** because there is no compliant way to pass `page` or `jobage` params on this
path, this CLI only returns StepStone's single default results page per query (StepStone's own
page size, not user-configurable) and does not support `--page`/`--jobage`. `--limit` still caps
results client-side.

## Search results page structure

The search results are present in the **initial server-rendered HTML** — no client-side JS
execution needed. Each result is a card; cards are split on:

```
data-at="job-item" data-testid="job-item"
```

Within a card, per-field anchors (all `data-at="..."` attributes — see "Markup stability" below):

| Field | Anchor | Notes |
|-------|--------|-------|
| id, url | `data-testid="job-item-title"` anchor's `href` | `href` matches `--(\d+)-inline\.html`; the digits are the id |
| title | `data-at="job-item-title"` | text is the last `data-genesis-element="TEXT"` or `"BASE"` leaf in the window |
| company | `data-at="job-item-company-name"` | same leaf-text pattern |
| location | `data-at="job-item-location"` | same leaf-text pattern; can be a comma-separated list of cities for multi-location postings |
| date | `data-at="job-item-timeago"` | a German relative-time string (`vor 3 Tagen`, `vor 1 Woche`), **not** an ISO date — StepStone does not expose an absolute date/datetime attribute here. `null` on sponsored/pinned cards, which don't show a timeago. |

~25 results per default page (observed; not documented, may vary).

## Job detail page structure

```
GET https://www.stepstone.de/stellenangebote--<slug>--<id>-inline.html
```

`<slug>` is free text (title + location + company, hyphenated) that StepStone itself generates
in search-result links — this CLI never constructs one, it only follows URLs `search` returns.

**Critical quirk — Referer header required.** Requesting a detail page directly (no `Referer`
header) reliably hangs / silently drops the connection (observed: consistent 15-30s timeouts
with zero bytes received, across multiple job IDs and multiple retries). The identical request
with `Referer: https://www.stepstone.de/` succeeds immediately (sub-second). Search pages under
`/jobs/` do not show this behavior. `htmlFetch()` in `helpers.ts` always sends a referer when
fetching a detail page — **do not remove it** if you touch this code later, or `detail` will
start silently failing again.

Field anchors on the detail page:

| Field | Anchor | Notes |
|-------|--------|-------|
| title | `data-at="header-job-title"` | text directly after the `>`, inside an `<h1>` |
| company | `data-at="metadata-company-name"` | icon + text; text is everything after the tag strips to plain text |
| location | `data-at="metadata-location"` | same pattern |
| contract type | `data-at="metadata-contract-type"` | e.g. "Feste Anstellung", "Befristeter Vertrag" |
| work type | `data-at="metadata-work-type"` | e.g. "Homeoffice möglich, Vollzeit" |
| online date | `data-at="metadata-online-date"` | e.g. "Erschienen: vor 2 Tagen" — same relative-string caveat as search's `date` |
| description | `data-at="section-text-description-content"` | rich HTML (`<p>`, `<ul><li>`); converted to plain text with paragraph/list breaks preserved |
| requirements | `data-at="section-text-profile-content"` | appended to `description` |
| benefits | `data-at="section-text-benefits-content"` | appended to `description` |
| apply URL | `data-at="apply-now-section"` | **not extractable** — the button is a disabled placeholder in server-rendered HTML; its real href is wired up by client-side JS after hydration. `applyUrl` is always `null`; the job's own `url` is the entry point to apply. |

## Markup stability warning

This is a React app using Emotion CSS-in-JS. Class names like `res-du9bhi`, `job-ad-display-xxeiht`
are **generated per build and not guaranteed stable** — do not parse against them. Everything in
this CLI keys off `data-at="..."` and `data-genesis-element="..."` attributes instead, which read
as intentional, semantic test/analytics hooks and were stable across all pages fetched during
development (search results, detail pages, multiple queries). If StepStone ships a markup change
that breaks parsing, check whether these attributes were renamed or restructured first.

## Notes

- No authentication required for either search or detail pages.
- The CLI backs off on 429/5xx with exponential backoff + jitter (max 6 retries), matching the
  other portal skills in this repo.
- Job IDs are purely numeric (e.g. `14255090`). A bare ID alone cannot be turned into a detail
  URL — the slug text before the ID is required and only StepStone's own search-result links
  provide it, so always pass the full URL from a `search` result to `detail`.
