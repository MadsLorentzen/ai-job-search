# InfoJobs API Reference

Official REST API: <https://developer.infojobs.net>. The operations below were read from the published
documentation on 2026-10-18. **They have not been exercised against the live API by the author**
(credentials are required; an unauthenticated request returns HTTP 401
`{"error":"102","error_description":"Client credentials not valid"}`).

## Authentication

HTTP Basic: `Authorization: Basic base64(<client_id>:<client_secret>)` using the credentials of a
registered InfoJobs developer application. The CLI builds it from `INFOJOBS_API_TOKEN`
(`client_id:client_secret`) and never accepts or prints it. The documentation pages list the offer
operations as "public / no scope", i.e. they need the application credentials but no end-user login.

## Search

```
GET https://api.infojobs.net/api/9/offer
```

Parameters used by the CLI:

| Parameter | CLI flag | Notes |
|-----------|----------|-------|
| `q` | `--query` | Keywords |
| `province` | `--location` | Dictionary key (`/dictionary/province`): lowercase, accent-free, hyphenated (`ciudad-real`). The CLI derives it from the text; unverified for every province |
| `city` | `--city` | City name, centre of a geosearch |
| `sinceDate` | `--jobage` | `_24_HOURS`, `_7_DAYS`, `_15_DAYS` or `ANY` (omitted) |
| `maxResults` | `--limit` | Default 20; the docs recommend ≤ 50 |
| `page` | `--page` | 1-indexed; omitted for page 1 |

Documented but deliberately not exposed: `category`, `subcategory`, `salaryMin`, `salaryMax`,
`salaryPeriod`, `study`, `contractType`, `experienceMin`, `workday`, `teleworking`, `employerId`,
`order` (default `updated-desc`), `facets`, `countryIds`, `provinceIds`, `cityIds`.

### Response (documented)

Top level: `offers[]`, `totalResults`, `currentResults`, `totalPages`, `currentPage`, `pageSize`,
`sortBy`, `sinceDate`, `queryParameters`. (The documentation's example also shows `items`; the CLI
accepts either spelling.)

Per offer → CLI field:

| API field | CLI |
|-----------|-----|
| `id` | `id` |
| `title` | `title` |
| `author.name` | `company` |
| `city` + `province.value` | `location` |
| `published` (RFC 3339), else `updated` | `date` |
| `link` | `url` (falls back to `https://www.infojobs.net/of-i<id>`) |
| `salaryDescription` | `salary` |
| `contractType.value` | `contract` |
| `workDay.value` | `workday` (note the response spells it `workDay`; the request parameter is `workday`) |
| `experienceMin.value` | `experience` |
| `teleworking.value` | `teleworking` |
| `requirementMin` | `summary` |

## Detail

```
GET https://api.infojobs.net/api/7/offer/{offerId}
```

`offerId` is the offer's `id` (a ~30-character hex string); error code `313` means the id is not valid.

| API field | CLI |
|-----------|-----|
| `title` | `title` |
| `profile.name` | `company` |
| `city` + `province.value` | `location` |
| `creationDate`, else `updateDate` | `date` |
| `link` | `url` |
| `description` (≤ 3500 chars) | `description` |
| `minRequirements`, `desiredRequirements` | `minRequirements`, `desiredRequirements` |
| `minPay` / `maxPay` (`amountValue`, `periodValue`), gated by `showPay` | `salary` |
| `contractType.value`, `journey.value` | `contract`, `workday` |
| `experienceMin.value`, `studiesMin.value` | `experience`, `studies` |
| `skillsList[].skill` | `skills` |
| `active` | `active` |

No field in the documented response carries an application deadline, so `deadline` is always `null`.

## Known documentation inconsistencies (check these first if a field is empty)

- The list resource is `/api/9/offer` but the page's example request uses `/api/7/offer`.
- `workday` (request) vs `workDay` (response).
- Facet items are described as `facet` but the example uses `values` (facets are not used here).
- The detail example's `skillsList` repeats the `skill` key, so the real shape is probably an array of `{skill}`.
- Some example strings show encoding damage (`Ingenier�a`); the real API is expected to return UTF-8.
