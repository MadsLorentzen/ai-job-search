# The Muse — endpoint reference

Everything a future maintainer needs when The Muse changes its API. All findings
below were verified live against the API on 2026-08-04.

Official docs: <https://www.themuse.com/developers/api/v2>

## Endpoints

| Purpose | Method | URL |
|---------|--------|-----|
| Search  | GET | `https://www.themuse.com/api/public/jobs` |
| Detail  | GET | `https://www.themuse.com/api/public/jobs/{id}` |

No authentication or API key is required for either. Responses are JSON.

## Search parameters

| Param | Server-side? | Notes |
|-------|--------------|-------|
| `page` | yes | **0-indexed.** The CLI exposes 1-indexed `--page` and subtracts 1. |
| `category` | **yes** | The strongest filter. e.g. `Software Engineering`, `Data Science`, `Product Management`, `Design and UX`. |
| `location` | **yes** | e.g. `Austin, TX`. The remote bucket is the literal string `Flexible / Remote`. Repeatable in the API; the CLI sends one. |
| `level` | **yes** | `Entry Level`, `Mid Level`, `Senior Level`, `Management`, `Internship`. |
| `company` | **yes** | Company `short_name`, e.g. `avalabs`. |
| `descending` | yes | `true` sorts newest first. The CLI always sets this. |
| `q` / `query` / `keyword` / `search` | **NO — ignored** | See below. |

### Verified: there is no free-text search parameter

Probed on 2026-08-04. `total` is unchanged by every free-text spelling tried:

```
q=engineer         total=405744
query=engineer     total=405744
keyword=engineer   total=405744
search=engineer    total=405744
(no param)         total=405744
```

This is why `--query` is implemented **client-side** in `helpers.ts:matchesQuery`
over a bounded page sweep. If The Muse ever adds a real search parameter, move the
filter server-side in `commands/search.ts:buildUrl` and drop the sweep.

### Verified: `category` really does filter

```
location=Flexible / Remote                                 total=6315
location=Flexible / Remote & category=Software Engineering total=1145
```

Different first result, and every returned record carries
`categories: ['Software Engineering']`. Note that The Muse's *own* tagging is noisy —
records like "Director, HRBP" genuinely carry the `Software Engineering` category
upstream. Do not "fix" this in the parser; it is real API data.

## Search response structure

```jsonc
{
  "page": 0,
  "page_count": 58,
  "items_per_page": 20,
  "total": 1145,
  "results": [ /* RawMuseJob */ ]
}
```

## Per-result field paths

These are the anchors `helpers.ts:normalizeJob` depends on.

| Contract field | API path | Notes |
|----------------|----------|-------|
| `id` | `id` | number → stringified |
| `title` | `name` | **often has a leading space** — trimmed by the parser |
| `company` | `company.name` | |
| `location` | `locations[].name` | array; joined with `"; "` |
| `date` | `publication_date` | ISO 8601 UTC |
| `url` | `refs.landing_page` | falls back to `https://www.themuse.com/jobs/{company.short_name}/{short_name}` |
| `levels` | `levels[].name` | joined with `", "` |
| `categories` | `categories[].name` | joined with `", "`; **may be `[]`** |
| `companyShortName` | `company.short_name` | used for the URL fallback |
| `description` (detail) | `contents` | HTML; converted to text by `htmlToText` |

Full observed key set on a result:
`categories, company, contents, id, levels, locations, model_type, name,
publication_date, refs, short_name, tags, type`

The **detail** endpoint returns the identical shape as a single object (not wrapped
in `results`), so `normalizeJob` is reused for both.

## Quirks

- `name` frequently begins with a leading space (`" Senior Technical Product Manager"`). Always trim.
- `categories` is commonly an empty array even on well-formed postings.
- `contents` is HTML with `<p>`, `<ul>`/`<li>`, `<strong>` and entity escapes.
- A bogus job id returns **404** (not an empty object); `jsonFetch` maps that to `null` and the CLI reports `NOT_FOUND`.
- `page` beyond `page_count` returns an empty `results` array rather than an error.
