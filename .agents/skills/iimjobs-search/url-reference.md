# iimjobs.com API reference

iimjobs.com is a Next.js front-end; job data is served client-side by a public JSON API
on `https://gladiator.iimjobs.com`. No authentication is required for search or detail.
The site's `robots.txt` sets `Crawl-delay: 10`, blocks only `/components/`, `/media/`,
`/templates/` etc. (none of the endpoints below), fully disallows Yandex, and does **not**
name any AI/Claude bot.

## Search

```
GET https://gladiator.iimjobs.com/job/search
```

Headers used: browser `User-Agent`, `Referer: https://www.iimjobs.com/`.

| Param | Type | Notes |
|-------|------|-------|
| `query` | string | Free-text keywords (title / skill / company). |
| `page` | int | **0-indexed** page. 50 results per page. |
| `loc` | int | Location id (see map below). Multi-city inclusive. |
| `posting` | int | Posted within N days. |
| `minexp` | int | Minimum experience (years). |
| `maxexp` | int | Maximum experience (years). |

### Response
```json
{
  "data": [ { /* job */ } ],
  "page": 0,
  "limit": 50,
  "count": 50,
  "totalJobs": 900,
  "count1Year": 0,
  "totalPages": 18,
  "hasMore": true
}
```

### Job object (fields consumed)
| Field | Meaning |
|-------|---------|
| `id` | Job id |
| `title` | Job title |
| `jobdesignation` | Short designation |
| `jobDetailUrl` | Full `iimjobs.com/j/<slug>-<id>` URL |
| `applyUrl` | External apply URL |
| `companyData.companyName` | Company name (empty when `confidential=1`) |
| `confidential` | `1` = confidential posting |
| `locations[] {id,name}` | City/region list (authoritative id→name source) |
| `min` / `max` | Experience band (years) |
| `createdTime` | Posting time (epoch ms) |
| `tags[] {id,name}` | Skill/function tags |
| `industry`, `functionalArea` | Numeric category codes |
| `minSal` / `maxSal` / `hideSal` | Salary (usually hidden, `hideSal=1`) |

## Detail

```
GET https://gladiator.iimjobs.com/job/detail?jobcode=<id>
```
Requires the `Referer: https://www.iimjobs.com/` header. Returns `{ "data": { ...job } }`
with the same fields as a search item plus `introText` — the full job description as HTML.

## Keyword suggestion (optional, unused by the CLI)

```
GET https://gladiator.iimjobs.com/job/search/keyword?query=<text>
```
Returns canonical tag names, e.g. `["Business Intelligence"]`. Handy for normalising a
free-text query; the CLI passes the raw query straight to `/job/search` instead.

## Category tags (reference)

```
GET https://gladiator.iimjobs.com/job/tags?query=<text>
```
Returns categories with `{id,name,count}` tags (e.g. Analytics=190). Not required for
keyword search but documents the tag id space.

## Location id map (authoritative — API `loc` filter)

These are the ids the `loc` filter uses, derived from the API's own `locations` objects.
**They differ from the id list embedded in the site's JS bundle — use these.**

| id | name | | id | name |
|----|------|-|----|------|
| 0 | Any Location | | 37 | Gurgaon/Gurugram |
| 1 | Delhi NCR | | 38 | Noida |
| 2 | Mumbai | | 39 | Greater Noida |
| 3 | Bangalore | | 40 | Faridabad |
| 4 | Hyderabad | | 53 | Ahmedabad |
| 5 | Kolkata | | 55 | Gandhinagar |
| 6 | Chennai | | 56 | Vadodara/Baroda |
| 7 | Pune | | 57 | Haridwar |
| 8 | Gujarat | | 59 | Uttarakhand |
| 9 | Maharashtra | | 60 | Lucknow |
| 10 | MP | | 64 | Chhattisgarh |
| 11 | Jaipur | | 68 | Navi Mumbai |
| 12 | Guwahati | | 69 | Thane |
| 14 | Chandigarh | | 70 | Cochin/Kochi |
| 15 | Punjab | | 71 | Hosur |
| 16 | Haryana | | 74 | Raipur |
| 17 | Kerala | | 76 | Vijayawada |
| 20 | Jharkhand | | 78 | Vishakhapatnam/Vizag |
| 21 | UP | | 84 | Coimbatore |
| 22 | US | | 85 | Pondicherry |
| 24 | Singapore | | 87 | Metros |
| 25 | Middle East | | 88 | Anywhere in India/Multiple |
| 26 | Africa | | 89 | Overseas/International |
| 28 | EU | | 94 | Nigeria |
| 31 | Karnataka | | 101 | Saudi Arabia |
| 32 | Tamil Nadu | | 116 | Tanzania |
| 33 | Rajasthan | | 121 | Bhopal |
| 34 | Andhra Pradesh | | 123 | Assam |
| 35 | Telangana | | 130 | Indore |
| 36 | Delhi | | 131 | Mohali |
|    |      | | 132 | Remote |
|    |      | | 138 | Manesar |
