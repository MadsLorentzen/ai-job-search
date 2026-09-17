# Hitmarker Jobs Search API Reference

Public Typesense search backend behind hitmarker.net/jobs (a Vue SPA). Global —
the same endpoint serves every market.

**How it was found:** static grep of the page's minified JS bundles
(`jobs-*.js`, `useSearch-*.js`) found the Typesense client wiring (`apiKey:
window.TSSK`, `host: "search.hitmarker.com"`) but not the collection name or
request-payload shape — those only appear in the actual request made at
runtime. Found by loading `https://hitmarker.net/jobs` in a real browser and
reading the resulting network requests (`claude-in-chrome`'s
`read_network_requests`), then confirming the collection name (`hitmarker_jobs`)
by direct `curl` trial against a short list of guessed names. If this stops
working, redo the browser capture rather than re-grepping the bundles.

## Search key (`TSSK`)

Every page load of `https://hitmarker.net/jobs` embeds a line like:

```html
<script>window.TSSK = "QjFTckNNRFB...(base64)..."</script>
```

Decoding the base64 shows it is a standard Typesense **scoped search key**: an
HMAC signature + a JSON suffix constraining what the key may do —
`{"exclude_fields":"totalCount,altSearchTerms,author","limit_multi_searches":10000}`
in the sample captured 2026-07-31. This is the same "secured search key" pattern
Algolia uses for public embeds: safe to expose client-side, read-only, and
scoped. The CLI fetches this value fresh on every run (see `getSearchKey()` in
`helpers.ts`) rather than hardcoding it, since Hitmarker could rotate it at any
time without notice.

## Search

```
POST https://search.hitmarker.com/multi_search
Header: X-TYPESENSE-API-KEY: <TSSK value>
Content-Type: application/json

{
  "searches": [
    {
      "collection": "hitmarker_jobs",
      "q": "Environment Artist",
      "query_by": "title,jobDescription,jobCompany.title,jobTags.title",
      "page": 1,
      "per_page": 20,
      "sort_by": "postDate:desc",
      "filter_by": "postDate:>1753900800"
    }
  ]
}
```

`filter_by` on `postDate` (Unix seconds) is how `--jobage` is implemented — confirmed
working server-side, so no client-side date filtering is needed (unlike
`artstation-search`, which had no such param).

Response: `{"results": [{"found": N, "page": 1, "hits": [{"document": {...}}]}]}`.
A collection-not-found or malformed request comes back as `{"results":
[{"code": 404, "error": "Not found."}]}` inside a `200` HTTP response — the CLI
checks `result.code` explicitly rather than trusting the HTTP status alone.

### Document shape (`hitmarker_jobs` collection)

```json
{
  "id": "3598322",
  "title": "Environment Artist",
  "url": "https://hitmarker.net/jobs/rebellion-environment-artist-3598322",
  "jobDescription": "We want you to #JOINTHEREBELLION! ... (plain text, not HTML)",
  "jobCompany": { "id": 341062, "title": "Rebellion", "slug": "rebellion", "url": "https://hitmarker.net/companies/rebellion", "companyLogo": "...", "companyVerified": false, "companyTotalJobCount": 503 },
  "jobLocation": [
    { "title": "Oxford", "type": "city", "flag": "🇬🇧", "id": "c50840", "_geo": {"lat": 51.75, "lng": -1.26}, "parents": [{"title": "Europe", "type": "continent"}, {"title": "UK", "type": "country"}] }
  ],
  "jobLevel": { "id": "intermediate", "title": "Intermediate (2–5 years)" },
  "jobContract": [{ "id": "fullTime", "title": "Full Time" }],
  "jobSalary": null,
  "jobTags": [{ "id": 122781, "slug": "3d", "title": "3D" }],
  "jobApplicationType": "url",
  "jobApplicationUrl": "https://jobs.workable.com/view/...",
  "jobApplicationEmail": null,
  "postDate": 1785409347,
  "dateUpdated": 1785416437,
  "jobExpiryDate": 0,
  "typeId": 3,
  "jobBoosts": [],
  "jobTier": [],
  "jobScrapedSchema": null
}
```

`jobDescription` arrives as plain text with real Unicode punctuation (curly
quotes, em dashes) already decoded — no HTML stripping needed, unlike
`linkedin-search`/`artstation-search`. `jobLocation` can be an empty array
(fully remote / unspecified) or hold multiple city entries for a
multi-office role (the same distribution pattern `/scrape`'s mass-posting
detection watches for on LinkedIn). No entry observed with `type: "remote"` or
a title literally "Remote" during scaffolding, but the parser checks for both
defensively. `jobSalary` was `null` on every sample seen; its populated shape
is unconfirmed.

## Detail (id lookup)

There is no plain GET single-document endpoint reachable with the scoped
search key — `GET .../collections/hitmarker_jobs/documents/<id>` returns:

```json
{"message": "Forbidden - a valid `x-typesense-api-key` header must be sent."}
```

(HTTP 401) even with a valid *search* key, because Typesense scoped search keys
do not carry document-read permission. The workaround, confirmed working:
reuse `multi_search` with an id filter —

```json
{"searches": [{"collection": "hitmarker_jobs", "q": "*", "query_by": "title", "filter_by": "id:=3598322", "per_page": 1}]}
```

## Access notes

- `https://hitmarker.net/robots.txt` disallows `/actions/`, `/cache/`,
  `/cpresources/`, `/dist/` (Craft CMS conventions) — none of which this skill
  touches. `search.hitmarker.com` is a separate host with its own (unchecked,
  and irrelevant since it's a dedicated search API host) robots policy.
- No authentication beyond the public scoped search key.
- The main site also renders a server-side "Craft CMS + Sprig" component tree
  for parts of the page (signed, non-guessable component hashes) — that
  mechanism was a dead end for this skill's purposes and is unrelated to the
  Typesense search path actually used here.
