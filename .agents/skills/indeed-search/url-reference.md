# Indeed Spain URL Reference

Public pages of `https://es.indeed.com`. Verified live on 2026-10-18.

## robots.txt (checked 2026-10-18)

Group `User-agent: *`:

| Rule | Consequence for this CLI |
|------|--------------------------|
| `Allow: /` plus `Allow: /*&start=0&` … `/*&start=90&` | `/jobs` is allowed; pagination only for start 0–90, **and only when `start=N` is followed by another `&param`** |
| `Disallow: /*&start=` (the bare form) | `start` must never be the last parameter. `buildSearchUrl` always appends `&sort=date` after it |
| `Disallow: /viewjob`, `/m/viewjob` | **No detail fetch.** The `detail` command refuses |
| `Disallow: /*radius=` | No radius flag |
| `Disallow: /*&iafilter=`, `/*&mna=`, `/*?rss`, `/*rt=nc`, `/*&alid=`, `/*&calert=` | Not used |

`python tools/robots_check.py <url>` returned exit 0 for `…/jobs?q=x&l=Toledo&start=90&sort=date` and
exit 1 for `…&start=100&sort=date` and for a trailing `…&start=10`.

## Search

```
GET https://es.indeed.com/jobs?q=<keywords>&l=<place>&start=<0|10..90>&sort=date&fromage=<1|3|7|14>
```

| Parameter | Meaning |
|-----------|---------|
| `q` | Keywords |
| `l` | Place, plain Spanish (`Toledo`) |
| `start` | Result offset = (page − 1) × 10; omitted on page 1 |
| `sort` | `date` = newest first (always set) |
| `fromage` | Posted within N days: 1, 3, 7 or 14 |

### Response structure

The page assigns its job cards inline as JSON:

```
window.mosaic.providerData["mosaic-provider-jobcards"]={"metaData":{"mosaicProviderJobCardsModel":{"results":[ ... ]}}, ...};
```

The CLI finds the marker and balances braces (string- and escape-aware) to cut out the object,
then reads `metaData.mosaicProviderJobCardsModel.results[]`. Per result:

| Field | Used as |
|-------|---------|
| `jobkey` | `id` (16 hex chars); `url` = `/viewjob?jk=<jobkey>` |
| `displayTitle` / `title` | `title` |
| `company` / `truncatedCompany` | `company` |
| `formattedLocation` | `location` (often `45007 Toledo, Toledo provincia`) |
| `pubDate` | `date` (epoch milliseconds → UTC calendar day) |
| `salarySnippet.text` | `salary` (absent when not published) |
| `snippet` | `snippet` (a small HTML list, flattened to ` \| `-separated text) |
| `sponsored` | `sponsored` |
| `remoteLocation` | `remote` |

Other signals:
- Total: `"totalJobCount":N` somewhere in the page.
- Empty search: no jobcards provider, and a `jobsearch-NoResult` block. The CLI treats that as zero
  results. A page with neither is `PARSE_FAILED`.
- Bot protection: a `403`, or a `401 Authenticating...` shell on `/viewjob`. Two causes were seen:
  a burst of requests (clears after a few minutes), and **the HTTP client itself**: on 2026-10-18 Bun's
  `fetch` got `403` on every attempt while `curl` got `200` for the same URL and the same
  `User-Agent: Mozilla/5.0 (compatible; indeed-search-cli/1.0)`. `htmlFetch` therefore retries a `403`
  once through `curl` (`curlFetch` in `helpers.ts`). If Indeed starts refusing curl as well, that
  fallback is the first thing to revisit; do not escalate to impersonating a browser.

## Quirks

- A freshness window with no matches (`fromage=14` for a small town) returns the no-results page, not an error.
- A very specific query can return fewer than 10 organic results plus sponsored placements.
- The `link` field (`/rc/clk?jk=...&bb=...`) is a tracking redirect; the CLI discards it in favour of the canonical `viewjob?jk=` URL.
