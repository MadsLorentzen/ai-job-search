# Lever postings API — endpoint reference

Verified live on 2026-08-04 against the `palantir` site (301 postings).

Official docs: <https://github.com/lever/postings-api>

## Endpoints

| Purpose | Method | URL |
|---------|--------|-----|
| List postings | GET | `https://api.lever.co/v0/postings/{site}?mode=json` |
| Posting detail | GET | `https://api.lever.co/v0/postings/{site}/{uuid}?mode=json` |

No authentication or API key. Responses are JSON.

The list endpoint returns a **bare JSON array**, not an object wrapper — unlike
Greenhouse's `{ "jobs": [...] }`.

## The site slug

There is **no cross-company search**. Every request is scoped to one company's
site slug — the segment in `jobs.lever.co/<slug>`.

- An unknown slug returns **404** → `jsonFetch` maps to `null` → reported as a per-site error.
- A **valid** slug with no open roles returns `[]`. This is not an error. (`plaid` returned `200` with an empty array during recon while `palantir` returned 301 postings.)

## Search parameters

Probed on 2026-08-04:

| Param | Works? | Notes |
|-------|--------|-------|
| `mode=json` | yes | Required for JSON. **Must appear exactly once** — passing it twice returns **HTTP 406**. |
| `limit` | yes | `limit=5` → 5 results. |
| `skip` | yes | `skip=5&limit=5` → 5 results. |
| `team` | yes | `team=Engineering` → 6 results. Exact match. |
| `commitment` | yes | `commitment=Full-time` → 257 results. Exact match. |
| `location` | **technically, but brittle** | `location=New York, NY` matches; `location=New York` returns **0**. Requires the exact stored string, so this CLI filters location client-side instead. |

`--query` has no server-side equivalent at all and is always client-side.

This CLI fetches the whole site list and paginates client-side (25/page) rather
than using `skip`/`limit`, so that client-side filters apply across the full set
rather than only the current server page.

## Per-result field paths

Anchors that `helpers.ts:normalizeJob` depends on.

| Contract field | API path | Notes |
|----------------|----------|-------|
| `id` | `id` | **UUID**, site-scoped |
| `title` | `text` | not `title` |
| `company` | *(none)* | API returns no display name — the parser uses the site slug |
| `location` | `categories.allLocations[]` → `categories.location` | joined with `"; "` |
| `date` | `createdAt` | **epoch milliseconds** → converted to ISO by `toIsoDate` |
| `url` | `hostedUrl` | |
| `applyUrl` (detail) | `applyUrl` | falls back to `hostedUrl + "/apply"` |
| `team` | `categories.team` | |
| `commitment` | `categories.commitment` | |
| `workplaceType` | `workplaceType` | `remote` \| `hybrid` \| `onsite` |
| `country` | `country` | ISO-2, e.g. `GB` |
| `description` (detail) | `descriptionPlain` + `lists[]` + `additionalPlain` | see quirk |

Observed key set on a posting:
`additional, additionalPlain, applyUrl, categories, country, createdAt,
description, descriptionBody, descriptionBodyPlain, descriptionPlain, hostedUrl,
id, lists, opening, openingPlain, text, workplaceType`

## Quirks

- **`text` is the job title**, not `title`. Easy to miss.
- **`createdAt` is epoch milliseconds.** Emitting it raw would put every posting at 1970 after a naive `Date.parse`.
- **The description is in three places.** `descriptionPlain` holds only the intro; the requirements and responsibilities live in `lists[]` as `{text: heading, content: "<li>…</li>"}` entries, and closing boilerplate is in `additionalPlain`. Reading only `descriptionPlain` silently drops the requirements — `buildDescription` concatenates all three.
- **Duplicate `mode=json` → HTTP 406.** Build the query string with a single `URLSearchParams.set`.
- `categories.allLocations` is the fuller list when a role spans offices; `categories.location` holds only the first.
- No company display name is available anywhere in the response.
